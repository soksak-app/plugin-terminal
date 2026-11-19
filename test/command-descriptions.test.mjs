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

// The read modes of core docs/spec/terminal-read.md: each read command states its mode, what it is used for and what it cannot
// see, and the next mode, so that an agent takes the first mode that holds the text that it needs.
test("the read commands state their read mode, its use and what it cannot see", () => {
  const read = command("terminal.screen.read").description;
  assert.match(read, /Read mode Visible/, read);
  assert.match(read, /cannot see the rows above the viewport/, read);
  assert.match(read, /terminal\.screen\.rows/, read);
  const rows = command("terminal.screen.rows").description;
  assert.match(rows, /Read mode Kept rows/, rows);
  assert.match(rows, /screen is primary or alternate/, rows);
  assert.match(rows, /no input reaches the program/, rows);
  assert.match(rows, /cannot see the rows that the program never drew/, rows);
  assert.match(rows, /alternate\.active/, rows);
});

test("terminal.screen.rows declares screen as a parameter of two values that it requires", () => {
  const { params } = command("terminal.screen.rows");
  assert.deepEqual(params.properties.screen, { type: "string", enum: ["primary", "alternate"] });
  // The schema form of a manifest has no required list, so the description states that screen is required.
  assert.match(command("terminal.screen.rows").description, /screen is required/);
});

test("terminal.session declares the members that choose a read mode", () => {
  const session = manifest.exposes.status.find((entry) => entry.name === "terminal.session");
  const { properties } = session.schema;
  assert.deepEqual(Object.keys(properties.scrollback.properties), ["offset", "history", "dropped"]);
  assert.deepEqual(Object.keys(properties.alternate.properties), ["active", "history", "dropped"]);
  assert.deepEqual(Object.keys(properties.foreground.properties), ["pid", "command", "cwd", "error"]);
  for (const member of ["alternate", "dropped", "foreground"]) assert.match(session.description, new RegExp(member), member);
});
