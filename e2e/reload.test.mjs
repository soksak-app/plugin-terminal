// The window check of terminal tabs across a reload of the main page (core F1109 and F1107): each tab shows a distinct line, the main
// page reloads, and each tab must read, draw and take input for the session of its own surface. The waits end on statuses; no timer
// judges the check.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { APPS, open } from "@soksak/window-check/app.mjs";
import { fresh } from "@soksak/window-check/start.mjs";

const PLUGIN = "terminal";
const PROMPT = "sh-3.2$";
const CHECK_SHELL = fileURLToPath(new URL("./check-shell", import.meta.url));
const COUNT = 3;

/** The text of the rows that terminal.screen reports, one line for each row without its trailing spaces. */
const screenLines = (rows) => rows.map((row) => row.map((cell) => (cell.ch === undefined ? " ".repeat(cell.width) : cell.ch)).join("").trimEnd());

for (const app of Object.values(APPS)) {
  test(`${app.name}: each terminal tab reads and takes input for its own session after a reload of the main page`, { timeout: 180000 }, async (t) => {
    const s = await open(t, app);
    await fresh(s, { settings: { [`${PLUGIN}.shell`]: CHECK_SHELL } });
    const grid = await s.get("core.grid");
    const focused = grid.cards.find((card) => card.focused);
    assert.ok(focused, `the window has no focused card: ${JSON.stringify(grid.cards)}`);
    const until = async (tab, holds, message) => screenLines(await s.until(`${PLUGIN}.screen`, (rows) => holds(screenLines(rows)), message, { surface: tab }));
    const tabs = [];
    for (let index = 0; index < COUNT; index += 1) {
      const { tab } = await s.run("core.card.add-tab", { card: focused.id, plugin: PLUGIN });
      await until(tab, (lines) => lines.some((line) => line.startsWith(PROMPT)), `${PLUGIN} tab ${tab} did not display its shell prompt`);
      await s.run(`${PLUGIN}.input`, { bytes: `echo before-${index}\r` }, tab);
      await until(tab, (lines) => lines.includes(`before-${index}`), `${PLUGIN} tab ${tab} did not show before-${index}`);
      tabs.push(tab);
    }

    const { start } = await s.get("core.window.workbench");
    await s.run("host.window.reload", {});
    await s.until("core.window.workbench", (value) => value.start !== start && value.readyState === "complete", "the workbench did not start again");

    for (const [index, tab] of tabs.entries()) {
      // A tab that is not the active tab of its card has no surface after a reload until it is selected, so each tab is selected first.
      await s.run("core.layout.select", { tab });
      const lines = await until(tab, (current) => current.includes(`before-${index}`), `${PLUGIN} tab ${tab} does not show before-${index} after the reload`);
      for (const other of tabs.keys()) {
        if (other !== index) assert.ok(!lines.includes(`before-${other}`), `${PLUGIN} tab ${tab} shows the line of tab ${tabs[other]}:\n${lines.join("\n")}`);
      }
      await s.run(`${PLUGIN}.input`, { bytes: `echo after-${index}\r` }, tab);
      await until(tab, (current) => current.includes(`after-${index}`), `${PLUGIN} tab ${tab} did not show after-${index} after the reload`);
    }
  });
}
