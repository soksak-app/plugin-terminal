import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The submit guidance sentence is copied from core, because this plugin cannot read core. Core checks the same sentence
// in its usage texts; the command name replaces the leading phrase here.
const SUBMIT_GUIDANCE = "terminal.submit sends its text as one input and Enter as a separate key input, refuses text that contains CR or LF, and returns only that the input was sent; confirm acceptance from the status of the input line and of the agent busy state, never by waiting with a timer.";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const command = (name) => manifest.exposes.commands.find((entry) => entry.name === name);

test("the terminal.submit description states the submit contract", () => {
  assert.ok(command("terminal.submit").description.includes(SUBMIT_GUIDANCE), command("terminal.submit").description);
});

test("the terminal.input description points programs that submit a line to terminal.submit", () => {
  assert.ok(command("terminal.input").description.includes("terminal.submit"), command("terminal.input").description);
});
