// The window check of an owned session that a terminal tab shows (docs/spec/owned-sessions.md#tab-attachment and
// docs/spec/tab-title.md). An owner tab of the plugin opens an owned session that runs `e2e/program-state`, which reports the program
// states working and idle with OSC 7501, and a second tab attaches to it with the tab parameters session and title. The check judges
// the state that core.sessions reports from the event session.program of the owner, the title of the attached tab in core.grid and
// terminal.session of both tabs, whose list unsupported names each sidecar event that the view does not handle. Every wait ends on
// the status that it names; no timer judges the check.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { APPS, open } from "@soksak/window-check/app.mjs";
import { fresh } from "@soksak/window-check/start.mjs";

const PLUGIN = "terminal";
const CHECK_SHELL = fileURLToPath(new URL("./check-shell", import.meta.url));
const PROGRAM_STATE = fileURLToPath(new URL("./program-state", import.meta.url));
const TITLE = "member one";

/** The text of the rows that terminal.screen reports, one line for each row without its trailing spaces. */
const screenLines = (rows) => rows.map((row) => row.map((cell) => (cell.ch === undefined ? " ".repeat(cell.width) : cell.ch)).join("").trimEnd());

for (const app of Object.values(APPS)) {
  test(`${app.name}: a ${PLUGIN} tab shows an owned session by its title, and no view lists session.program as unsupported`, { timeout: 180000 }, async (t) => {
    const s = await open(t, app);
    await fresh(s, { settings: { [`${PLUGIN}.shell`]: CHECK_SHELL } });
    const grid = await s.get("core.grid");
    const focused = grid.cards.find((card) => card.focused);
    assert.ok(focused, `the window has no focused card: ${JSON.stringify(grid.cards)}`);
    const { tab: owner } = await s.run("core.card.add-tab", { card: focused.id, plugin: PLUGIN });
    await s.until(`${PLUGIN}.session`, (value) => typeof value?.sessionId === "string" && value.sessionId !== "",
      `${PLUGIN} tab ${owner} opened no session`, { surface: owner });

    const { session } = await s.run("core.session.open",
      { plugin: PLUGIN, params: { program: PROGRAM_STATE, args: [] }, size: { width: 640, height: 400, scale: 2 } }, owner);
    s.cleanup(async () => {
      if ((await s.get("core.sessions")).some((entry) => entry.session === session)) await s.run("core.session.end", { session }, owner);
    });
    const { tab: member } = await s.run("core.layout.open", { card: focused.id, plugin: PLUGIN, params: { session, title: TITLE } });
    await s.until(`${PLUGIN}.screen`, (rows) => screenLines(rows).includes("state working"),
      `${PLUGIN} tab ${member} did not show the owned session ${session}`, { surface: member });
    await s.until("core.sessions", (list) => list.some((entry) => entry.session === session && entry.program?.state === "working"),
      `core.sessions did not report the state working of ${session}`);
    const shown = (await s.get("core.grid")).cards.flatMap((card) => card.tabs).find((entry) => entry.tab === member);
    assert.equal(shown?.label, TITLE, `the attached tab did not show its title: ${JSON.stringify(shown)}`);

    await s.run("core.session.input", { session, text: "\r" }, owner);
    await s.until("core.sessions", (list) => list.some((entry) => entry.session === session && entry.program?.state === "idle"),
      `core.sessions did not report the state idle of ${session}`);
    await s.until(`${PLUGIN}.screen`, (rows) => screenLines(rows).includes("state idle"),
      `${PLUGIN} tab ${member} did not show the idle line of ${session}`, { surface: member });
    for (const surface of [owner, member]) {
      const { unsupported } = await s.get(`${PLUGIN}.session`, surface);
      assert.deepEqual(unsupported, [], `${PLUGIN} tab ${surface} lists sidecar events that it does not handle`);
    }
  });
}
