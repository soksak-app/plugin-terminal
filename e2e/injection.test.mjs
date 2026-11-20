// The window checks of the injection of the messages of a terminal of the plugin terminal (core docs/spec/messaging.md#injected-message and
// #hold-for-the-person). The check writes each message with `sok message send` of the application for the surface of a sender tab,
// as a shell of that tab does, and judges the reply of the send, terminal.messages of the receiver and the screen of the receiver.
// The shell `e2e/check-shell` reports no OSC 133 mark, so the injected line, which no command of the shell names, is judged by
// the error line of the shell. Every wait ends on the status or the screen that it names; no timer judges the
// check, and no agent program takes part: the receiver runs a command that waits for a named pipe, or the program
// `e2e/blocked-prompt`, which reports a blocked record with OSC 7501 and reads one line. The report check answers a message with
// `sok message send --reply` for the surface of the receiver (core docs/spec/messaging.md#report-request).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { APPS, open } from "@soksak/window-check/app.mjs";
import { fresh } from "@soksak/window-check/start.mjs";

const PLUGIN = "terminal";
const PROMPT = "sh-3.2$";
const CHECK_SHELL = fileURLToPath(new URL("./check-shell", import.meta.url));
const BLOCKED_PROMPT = fileURLToPath(new URL("./blocked-prompt", import.meta.url));
const LIMIT = 180000;
// The line of the shell for the injected line `[soksak message from <title> (<folder>): <framing>] <text>`: the folder of the sender stands in
// parentheses, so the shell gives the syntax error of the parenthesis for a message and for a report.
const NOT_FOUND = /syntax error near unexpected token `\('/;

/** The text of the rows that the screen status reports, one line for each row without its trailing spaces. */
const screenLines = (rows) => rows.map((row) => row.map((cell) => (cell.ch === undefined ? " ".repeat(cell.width) : cell.ch)).join("").trimEnd());

/**
 * Opens a project window with a receiver tab and a sender tab beside it, both with the check shell at its prompt, and returns
 * the session of the window, the tabs and the folder of the receiver.
 */
async function projectTerminals(t, app) {
  const s = await open(t, app);
  await fresh(s, { settings: { [`${PLUGIN}.shell`]: CHECK_SHELL } });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "soksak-injection-")));
  s.cleanup(() => rmSync(root, { recursive: true, force: true }));
  s.cleanupSteps(
    async () => {
      for (const window of await s.get("host.windows")) {
        if (window.window !== s.window) await s.on(window.window).close();
      }
      await s.windows(1, "the check left an extra window");
    },
    async () => {
      for (const project of await s.get("core.projects")) {
        if (project.root === root) await s.run("core.project.close", { id: project.id });
      }
      await s.run("core.projects.flush");
    },
  );
  await s.run("core.settings.set", { patch: { projectOpening: "windows" }, scope: "common" });
  await s.run("core.project.open", { root, color: "#7db4ff" });
  const windows = await s.windows(2, "the project window did not open");
  const p = s.on(windows.find((w) => w.window !== s.window).window);
  const grid = await p.get("core.grid");
  const focused = grid.cards.find((card) => card.focused);
  assert.ok(focused, `the project window has no focused card: ${JSON.stringify(grid.cards)}`);
  const { tab: receiver } = await p.run("core.card.add-tab", { card: focused.id, plugin: PLUGIN });
  const { tab: sender } = await p.run("core.card.split", { card: focused.id, side: "right", plugin: PLUGIN });
  const folder = join(root, ".soksak", "messages", receiver);
  await p.until(`${PLUGIN}.messages`, (value) => value?.folder === folder && typeof value.registration === "string",
    `${PLUGIN} tab ${receiver} did not register the folder ${folder}`, { surface: receiver });
  for (const surface of [receiver, sender]) {
    await p.until(`${PLUGIN}.screen`, (rows) => screenLines(rows).some((line) => line.startsWith(PROMPT)),
      `${PLUGIN} tab ${surface} did not display its shell prompt`, { surface });
  }
  // Writes a message from the sender with `sok message send` of the application and returns its reply {path, receiver}.
  const send = (text) => JSON.parse(execFileSync(join(dirname(app.binary), "sok"), ["message", "send", folder, text], {
    env: { ...process.env, SOKSAK_CONFIG_DIR: app.configDir, SOKSAK_SURFACE: sender }, encoding: "utf8",
  }));
  const screen = async () => screenLines(await p.get(`${PLUGIN}.screen`, receiver));
  // Resolves with the lines of the screen of the receiver once they hold.
  const untilScreen = async (holds, message) => screenLines(await p.until(`${PLUGIN}.screen`, (rows) => holds(screenLines(rows)), message,
    { surface: receiver }));
  // Writes a report from the receiver to the folder of the sender with `sok message send --reply` and returns its reply {path, receiver}.
  const report = (text) => JSON.parse(execFileSync(join(dirname(app.binary), "sok"), ["message", "send", "--reply", join(root, ".soksak", "messages", sender), text], {
    env: { ...process.env, SOKSAK_CONFIG_DIR: app.configDir, SOKSAK_SURFACE: receiver }, encoding: "utf8",
  }));
  return { s, p, root, receiver, sender, folder, send, report, screen, untilScreen };
}

for (const app of Object.values(APPS)) {
  test(`${app.name}: a message to a ${PLUGIN} terminal that runs a command is injected and submitted after the command`, { timeout: LIMIT }, async (t) => {
    const { p, root, receiver, sender, send, untilScreen } = await projectTerminals(t, app);
    // The command of the receiver waits until the check writes the named pipe, so it runs while the message arrives.
    const pipe = join(root, "wait.fifo");
    execFileSync("mkfifo", [pipe]);
    await p.run(`${PLUGIN}.input`, { bytes: `cat '${pipe}' > /dev/null; echo command-ended\r` }, receiver);
    await untilScreen((lines) => lines.some((line) => line.includes("command-ended")), `${PLUGIN} tab ${receiver} did not echo its command`);

    // A running command without records and without a notice holds no injection: the page injects the message into the input of
    // the session, where it waits until the shell reads it.
    const reply = send("queued while a command runs");
    assert.deepEqual(reply.receiver, { surface: receiver, plugin: PLUGIN, held: null }, `the send reported a hold: ${JSON.stringify(reply)}`);
    const delivered = await p.until(`${PLUGIN}.messages`, (value) => value?.last?.path === reply.path,
      `${PLUGIN} tab ${receiver} decided no delivery of ${reply.path}`, { surface: receiver });
    assert.deepEqual(delivered.last, { seq: delivered.last.seq, path: reply.path, from: sender, state: "delivered", reason: null });

    writeFileSync(pipe, "end\n");
    const lines = await untilScreen((current) => current.some((line) => NOT_FOUND.test(line)),
      `${PLUGIN} tab ${receiver} did not submit the injected line after its command`);
    const ended = lines.findIndex((line) => line === "command-ended");
    const submitted = lines.findIndex((line) => NOT_FOUND.test(line));
    assert.ok(ended >= 0 && ended < submitted, `the injected line was not submitted after the command ended:\n${lines.join("\n")}`);
  });

  test(`${app.name}: a message to a ${PLUGIN} terminal whose program is blocked waits until the person answers`, { timeout: LIMIT }, async (t) => {
    const { p, receiver, sender, send, screen, untilScreen } = await projectTerminals(t, app);
    await p.run(`${PLUGIN}.input`, { bytes: `'${BLOCKED_PROMPT}'\r` }, receiver);
    await p.until(`${PLUGIN}.program`, (value) => value.records.some((record) => record.state === "blocked" && record.kind === "permission"),
      `${PLUGIN} tab ${receiver} reported no blocked record`, { surface: receiver });
    await untilScreen((lines) => lines.some((line) => line.startsWith("Proceed? [y/N]")), `${PLUGIN} tab ${receiver} showed no prompt`);

    // The send reports the hold of the receiver, and the page keeps the message waiting without input.
    const reply = send("held while the prompt waits");
    // The count of waiting messages depends on whether the page received the file event before the send read the status.
    assert.deepEqual([reply.receiver?.surface, reply.receiver?.plugin, reply.receiver?.held?.reason, reply.receiver?.held?.kind],
      [receiver, PLUGIN, "blocked", "permission"], `the send did not report the blocked hold: ${JSON.stringify(reply)}`);
    const held = await p.until(`${PLUGIN}.messages`, (value) => value?.held?.pending === 1,
      `${PLUGIN} tab ${receiver} did not hold the message`, { surface: receiver });
    assert.deepEqual(held.held, { reason: "blocked", kind: "permission", pending: 1 });
    assert.equal(held.last, null, "a held message has no decision");
    assert.ok(!(await screen()).some((line) => line.includes("soksak message")), "a byte of the held message reached the prompt");

    // The answer of the person ends the prompt; the program read only that line, and the page then injects the message.
    await p.run(`${PLUGIN}.input`, { bytes: "y\r" }, receiver);
    const delivered = await p.until(`${PLUGIN}.messages`, (value) => value?.last?.path === reply.path,
      `${PLUGIN} tab ${receiver} did not inject ${reply.path} after the answer`, { surface: receiver });
    assert.deepEqual(delivered.last, { seq: delivered.last.seq, path: reply.path, from: sender, state: "delivered", reason: null });
    assert.equal(delivered.held, null, "the hold did not end with the answer");
    const lines = await untilScreen((current) => current.some((line) => NOT_FOUND.test(line)),
      `${PLUGIN} tab ${receiver} did not submit the injected line after the answer`);
    assert.ok(lines.includes("answer=y"), `the prompt read another line than the answer of the person:\n${lines.join("\n")}`);
    assert.ok(lines.indexOf("answer=y") < lines.findIndex((line) => NOT_FOUND.test(line)), `the injected line came before the answer:\n${lines.join("\n")}`);
  });

  test(`${app.name}: a message to a ${PLUGIN} terminal asks for a report, and the report reaches the sender without a request`, { timeout: LIMIT }, async (t) => {
    const { p, root, receiver, sender, folder, send, report } = await projectTerminals(t, app);
    const senderFolder = join(root, ".soksak", "messages", sender);
    await p.until(`${PLUGIN}.messages`, (value) => value?.folder === senderFolder && typeof value.registration === "string",
      `${PLUGIN} tab ${sender} did not register the folder ${senderFolder}`, { surface: sender });

    // The send adds the request for a report to the folder of the sender, which the page injects with the text.
    const request = send("build the game");
    assert.equal(readFileSync(join(folder, request.path), "utf8"),
      `build the game (끝나면 결과를 sok message send --reply ${senderFolder} "<보고>"로 보고하라)`, "the message does not carry the report request");
    await p.until(`${PLUGIN}.messages`, (value) => value?.last?.path === request.path && value.last.state === "delivered",
      `${PLUGIN} tab ${receiver} did not inject ${request.path}`, { surface: receiver });

    // The report from --reply carries the text alone under a report name, and the page of the sender injects it.
    const answer = report("done");
    assert.match(answer.path, new RegExp(`^${receiver}\\.report-[^.]+\\.txt$`), `the report has no report name: ${answer.path}`);
    assert.deepEqual(answer.receiver, { surface: sender, plugin: PLUGIN, held: null }, `the report reported a hold: ${JSON.stringify(answer)}`);
    assert.equal(readFileSync(join(senderFolder, answer.path), "utf8"), "done", "the report carries a request");
    await p.until(`${PLUGIN}.messages`, (value) => value?.last?.path === answer.path && value.last.state === "delivered",
      `${PLUGIN} tab ${sender} did not inject the report ${answer.path}`, { surface: sender });
    await p.until(`${PLUGIN}.screen`, (rows) => screenLines(rows).some((line) => NOT_FOUND.test(line)),
      `${PLUGIN} tab ${sender} did not submit the injected report`, { surface: sender });
  });
}
