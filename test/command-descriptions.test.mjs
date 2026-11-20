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
  for (const member of ["alternate", "dropped"]) assert.match(session.description, new RegExp(member), member);
});

// The process list of core docs/spec/process-list.md: terminal.session declares the foreground program and the background jobs
// in the form of a process, and terminal.process.list returns both.
const PROCESS_MEMBERS = ["group", "pid", "command", "arguments", "cwd", "started", "error"];
test("terminal.session and terminal.process.list declare the foreground program and the background jobs", () => {
  const session = manifest.exposes.status.find((entry) => entry.name === "terminal.session");
  const { properties } = session.schema;
  assert.deepEqual(Object.keys(properties.foreground.properties), PROCESS_MEMBERS);
  assert.deepEqual(Object.keys(properties.background.items.properties), [...PROCESS_MEMBERS, "state"]);
  assert.deepEqual(properties.background.items.properties.state, { type: "string", enum: ["running", "stopped"] });
  for (const member of ["foreground", "background", "terminal.process.list"]) assert.match(session.description, new RegExp(member), member);
  const list = command("terminal.process.list");
  assert.deepEqual(list.params, { type: "object", properties: {} });
  assert.deepEqual(list.result.properties.foreground, properties.foreground);
  assert.deepEqual(list.result.properties.background, { ...properties.background, type: "array" }, "the command always returns the jobs");
  for (const text of [/foreground program/, /background jobs/, /arguments/, /group/]) assert.match(list.description, text, list.description);
});

// The program scroll of core docs/spec/terminal-read.md#program-scroll: the description states the mode, that input reaches the
// program, the restore, and the modes to take first.
const params = (entry) => entry.params.properties;
test("terminal.screen.scroll.read states the read mode Program scroll and declares by and the quiet setting", () => {
  const scroll = command("terminal.screen.scroll.read");
  assert.match(scroll.description, /Read mode Program scroll/, scroll.description);
  assert.match(scroll.description, /input reaches the program/, scroll.description);
  assert.match(scroll.description, /restored/, scroll.description);
  assert.match(scroll.description, /terminal\.screen\.rows/, scroll.description);
  assert.deepEqual(params(scroll), { by: { type: "integer" } });
  // The schema form of a manifest has no required list and no bounds, so the description states them.
  assert.match(scroll.description, /by is required, an integer from -1000 to 1000 other than 0/, scroll.description);
  const quiet = manifest.settings.scrollReadQuiet;
  assert.deepEqual({ type: quiet.type, default: quiet.default, minimum: quiet.minimum, maximum: quiet.maximum },
    { type: "integer", default: 6, minimum: 1, maximum: 120 });
  assert.match(command("terminal.screen.rows").description, /terminal\.screen\.scroll\.read/);
});
