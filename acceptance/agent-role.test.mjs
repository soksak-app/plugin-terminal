// The acceptance of the agent roles of the terminal plugin (core docs/spec/agent-roles.md#acceptance). It runs the real Claude Code
// and Codex in a terminal tab that core.layout.open opens with the start parameters program, args and role (core
// docs/spec/agent-roles.md#start-parameters). It judges the role state only: the status core.tab.role and the fingerprint that the
// target computes from roles.json. It runs only locally, with `make test-app-agent-role`, which needs a display and a person's
// computer. It stays outside e2e/, so `make test-app` does not run it.
//
// The project folder that the CLI already trusts is named by SOKSAK_AGENT_ROLE_FOLDER. No check is skipped: a missing CLI command
// fails its test with `command not found: <program>`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { recordCatalog } from "@soksak/window-check/catalog.mjs";
import { currentEventOffsets, untilEventLine } from "@soksak/window-check/event-log.mjs";
import { APPS, open, prepareFixture } from "@soksak/window-check/app.mjs";
import { fresh, reading } from "@soksak/window-check/start.mjs";

const PLUGIN = "terminal";
const ROLE = "acceptance-role";
const LIMIT = 300000;
const PROGRAMS = ["claude", "codex"];
// The record that the page writes when it injects the first message of a program launched with a role (plugin ui/terminal.js).
const FIRST_MESSAGE_RECORD = "plugin.terminal.messages.delivered";

/** The fingerprint of a role: the first 16 lowercase hexadecimal characters of SHA-256 over the identifier, a line feed and the text. */
const fingerprintOf = (role, text) => createHash("sha256").update(`${role}\n${text}`, "utf8").digest("hex").slice(0, 16);

/** Whether an event line is the record of the first message of a role, the event line format of window-check event-log.mjs. */
const isFirstMessage = (line) => line.includes(` ${FIRST_MESSAGE_RECORD}: `) && line.includes('"kind":"first"');

/** The definition of the role with a nonce of the run, which the agent can read only from the role file. */
const definition = (nonce) => `Acceptance nonce ${nonce}. Answer every request with the words of the role file.`;
/** The Korean translation of the definition, the member `ko` that format 2 of roles.json requires. */
const definitionKo = (nonce) => `수용 검사 nonce ${nonce}. 모든 요청에 role 파일의 말로 답한다.`;

/**
 * Writes roles.json of the configuration directory with the role, its text and its Korean translation, in format 2 of core
 * docs/spec/agent-roles.md#role-definitions.
 */
function writeRoles(configDir, text, ko) {
  writeFileSync(join(configDir, "roles.json"), `${JSON.stringify({ format: 2, roles: { [ROLE]: { text, ko } } })}\n`);
}

/** Fails with `command not found: <program>` when the program is not on the PATH of the check. */
function requireProgram(program) {
  try {
    execFileSync("which", [program], { encoding: "utf8", stdio: "pipe" });
  } catch {
    throw new Error(`command not found: ${program}`);
  }
}

/** Opens the window of the check, the project folder that the CLI trusts, and returns the window session and its project window. */
async function projectWindow(t, app) {
  const folder = process.env.SOKSAK_AGENT_ROLE_FOLDER;
  if (folder === undefined || folder === "") {
    throw new Error("SOKSAK_AGENT_ROLE_FOLDER names no project folder that the agent CLI already trusts");
  }
  const root = realpathSync(folder);
  const s = await open(t, app);
  await fresh(s, {});
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
  // The record of the first message is stored at the level info, which the default log policy does not store.
  await prepareFixture(s, { log: { io: "info" }, reads: [FIRST_MESSAGE_RECORD], catalog: recordCatalog(app.configDir) });
  await s.run("core.settings.set", { patch: { projectOpening: "windows" }, scope: "common" });
  await s.run("core.project.open", { root, color: "#7db4ff" });
  const windows = await s.windows(2, "the project window did not open");
  const p = s.on(windows.find((w) => w.window !== s.window).window);
  const grid = await p.get("core.grid");
  const focused = grid.cards.find((card) => card.focused);
  if (!focused) throw new Error(`the project window has no focused card: ${JSON.stringify(grid.cards)}`);
  return { s, p, root, card: focused.id };
}

for (const program of PROGRAMS) {
  for (const app of Object.values(APPS)) {
    test(`${app.name}: ${program} reads its role file, confirms the fingerprint of the file and takes a changed role`, { timeout: LIMIT }, async (t) => {
      requireProgram(program);
      const { p, root, card } = await projectWindow(t, app);
      const offsets = currentEventOffsets(app.configDir);

      // 1. The first role, with a nonce that the agent can read only from its file. The tab opens with the CLI and the role.
      const first = randomUUID();
      writeRoles(app.configDir, definition(first), definitionKo(first));
      const { tab } = await p.run("core.layout.open", { card, plugin: PLUGIN, params: { program, args: [], role: ROLE } });
      // Every program launched with a role gets the identity as its first message: the page writes the record once it injects it.
      await untilEventLine(app.configDir, offsets, isFirstMessage, reading(app, [FIRST_MESSAGE_RECORD]));
      const expected = fingerprintOf(ROLE, definition(first));
      const ready = await p.until("core.tab.role", (value) => value !== null && value.state !== "pending",
        `${program} did not settle the role of tab ${tab}`, { surface: tab });
      assert.equal(ready.state, "ready", `${program} ended with state ${ready.state}; the target never reports a pass for it`);
      assert.equal(ready.generation, 1, "the first role is generation 1");
      assert.equal(ready.fingerprint, expected, "the confirmed fingerprint is not the fingerprint of roles.json");

      // 2. A changed definition with a new nonce: one new generation, which the agent confirms.
      const second = randomUUID();
      writeRoles(app.configDir, definition(second), definitionKo(second));
      const changed = await p.run("core.tab.role", { tab, role: ROLE });
      assert.equal(changed.generation, 2, "the changed role is generation 2");
      const confirmed = await p.until("core.tab.role", (value) => value !== null && value.generation === 2 && value.state !== "pending",
        `${program} did not settle the changed role of tab ${tab}`, { surface: tab });
      assert.equal(confirmed.state, "ready", `${program} ended the changed role with state ${confirmed.state}`);
      assert.equal(confirmed.fingerprint, fingerprintOf(ROLE, definition(second)), "the changed fingerprint is not the one of roles.json");

      // 3. The nonce of the run is in no file of the project folder that the CLI reads as its memory.
      for (const file of ["AGENTS.md", "CLAUDE.md"]) {
        const path = join(root, file);
        if (existsSync(path)) {
          assert.ok(!readFileSync(path, "utf8").includes(first) && !readFileSync(path, "utf8").includes(second),
            `${file} of the project folder holds a nonce of the run`);
        }
      }
    });
  }
}
