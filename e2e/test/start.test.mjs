// Unit checks of the start state of the window checks (e2e/start.mjs): the shell fixtures and the placeholder tabs of the start layout.
import assert from "node:assert/strict";
import { accessSync, constants, readFileSync } from "node:fs";
import test from "node:test";
import { placeholderTabs, terminalCheckShell } from "../start.mjs";

test("the shell of a terminal view is a check shell of this repository", { timeout: 5000 }, () => {
  for (const [shell, file, command] of [["check", "check-shell", "exec /bin/sh"], ["zsh", "check-zsh", "exec /bin/zsh -f"]]) {
    const path = terminalCheckShell(shell);
    assert.ok(path.endsWith(`/e2e/${file}`), `${shell} is ${path}`);
    accessSync(path, constants.X_OK);
    assert.ok(readFileSync(path, "utf8").split("\n").includes(command), `${file} does not run ${command}`);
  }
  assert.equal(terminalCheckShell(), terminalCheckShell("check"));
  assert.throws(() => terminalCheckShell("bash"), new Error('unsupported terminal check shell "bash"'));
});

test("the placeholder tabs of the start layout are the tabs that core.surfaces reports as placeholders", { timeout: 5000 }, () => {
  const grid = { cards: [
    { id: "left" },
    { id: "terminal", tabs: [{ id: "tab-1", plugin: "terminal" }] },
    { id: "browser", tabs: [{ id: "tab-2", plugin: "browser" }] },
  ] };
  const surfaces = [
    { surface: "tab-1", kind: "tab", placeholder: null },
    { surface: "tab-2", kind: "tab", placeholder: { reason: "not installed" } },
  ];
  assert.deepEqual(placeholderTabs(grid, surfaces), [{ card: "browser", tab: "tab-2", plugin: "browser" }]);
  assert.deepEqual(placeholderTabs(null, surfaces), []);
});
