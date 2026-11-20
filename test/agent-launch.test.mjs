import assert from "node:assert/strict";
import test from "node:test";
import { launchOf } from "../ui/agent-role.js";

// The start parameters of a terminal tab that runs an agent CLI (core docs/spec/agent-roles.md#start-parameters).
test("absent parameters start the shell", () => {
  assert.deepEqual(launchOf(null), { program: null, args: [], role: null });
  assert.deepEqual(launchOf({}), { program: null, args: [], role: null });
});

test("a program with its arguments and a role is read as given", () => {
  assert.deepEqual(launchOf({ program: "claude", args: ["--model", "haiku"], role: "reviewer" }),
    { program: "claude", args: ["--model", "haiku"], role: "reviewer" });
  assert.deepEqual(launchOf({ program: "/usr/local/bin/codex", args: [], role: null }),
    { program: "/usr/local/bin/codex", args: [], role: null });
});

test("args without a program are refused with args require program", () => {
  assert.throws(() => launchOf({ args: ["x"] }), /^Error: args require program$/);
});

test("a role without a program is refused with role requires program", () => {
  assert.throws(() => launchOf({ role: "reviewer" }), /^Error: role requires program$/);
});

test("a program that is not a non-empty text, or args that are not texts, are refused", () => {
  assert.throws(() => launchOf({ program: "" }), /launch program must be a non-empty text/);
  assert.throws(() => launchOf({ program: 3 }), /launch program must be a non-empty text/);
  assert.throws(() => launchOf({ program: "claude", args: "x" }), /launch args must be an array of texts/);
  assert.throws(() => launchOf({ program: "claude", args: ["a", 1] }), /launch args must be an array of texts/);
});

test("a role that is not an identifier is refused", () => {
  assert.throws(() => launchOf({ program: "claude", role: "Reviewer" }), /invalid role identifier "Reviewer"/);
});
