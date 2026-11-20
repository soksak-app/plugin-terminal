// The window check of terminal.submit (docs/spec/submit.md): a program that takes fast typed text as a paste, as an agent does,
// receives the submitted text as an input line and the Enter as its submit. The program `e2e/paste-burst` reads its terminal in raw
// mode with bracketed paste mode on, prints `submitted: <input>` for a carriage return that submits and `newline-in-input: <input>`
// for a carriage return that follows typed text within its burst window, and the check judges which line it printed. The wait ends
// on the screen; no timer judges the check.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { APPS, open } from "@soksak/window-check/app.mjs";
import { fresh } from "@soksak/window-check/start.mjs";

const PLUGIN = "terminal";
const PROMPT = "sh-3.2$";
const CHECK_SHELL = fileURLToPath(new URL("./check-shell", import.meta.url));
const PASTE_BURST = fileURLToPath(new URL("./paste-burst", import.meta.url));
const TEXT = "hello from submit";

/** The text of the rows that terminal.screen reports, one line for each row without its trailing spaces. */
const screenLines = (rows) => rows.map((row) => row.map((cell) => (cell.ch === undefined ? " ".repeat(cell.width) : cell.ch)).join("").trimEnd());

for (const app of Object.values(APPS)) {
  test(`${app.name}: terminal.submit submits its text to a program that takes fast typed text as a paste`, { timeout: 180000 }, async (t) => {
    const s = await open(t, app);
    await fresh(s, { settings: { [`${PLUGIN}.shell`]: CHECK_SHELL } });
    const grid = await s.get("core.grid");
    const focused = grid.cards.find((card) => card.focused);
    assert.ok(focused, `the window has no focused card: ${JSON.stringify(grid.cards)}`);
    const { tab } = await s.run("core.card.add-tab", { card: focused.id, plugin: PLUGIN });
    const until = async (holds, message) => screenLines(await s.until(`${PLUGIN}.screen`, (rows) => holds(screenLines(rows)), message, { surface: tab }));
    await until((lines) => lines.some((line) => line.startsWith(PROMPT)), `${PLUGIN} tab ${tab} did not display its shell prompt`);
    await s.run(`${PLUGIN}.input`, { bytes: `'${PASTE_BURST}'\r` }, tab);
    await until((lines) => lines.includes("ready>"), `the program of ${PLUGIN} tab ${tab} did not start`);

    await s.run(`${PLUGIN}.submit`, { text: TEXT }, tab);
    const lines = await until((current) => current.some((line) => line.startsWith("submitted: ") || line.startsWith("newline-in-input: ")),
      `the program of ${PLUGIN} tab ${tab} received no carriage return`);
    assert.ok(lines.includes(`submitted: ${TEXT}`), `the program did not take the Enter as the submit of the text:\n${lines.join("\n")}`);
  });
}
