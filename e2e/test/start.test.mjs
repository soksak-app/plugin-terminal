// Unit checks of the start state of the window checks (e2e/start.mjs): the shell fixtures and the readiness of the start terminal tab.
import assert from "node:assert/strict";
import { accessSync, constants, readFileSync } from "node:fs";
import test from "node:test";
import { TERMINAL_ENTRIES, terminalCheckShell, terminalThemed } from "../start.mjs";

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

test("the start terminal tab has registered its document, session and view and waits for its theme", { timeout: 5000 }, async () => {
  assert.deepEqual(TERMINAL_ENTRIES, ["status core.surface.document", "status terminal.session", "element terminal.view"]);
  const calls = [];
  const s = {
    async until(name, predicate, message, options) {
      calls.push({ name, options });
      assert.equal(predicate({ readyState: "complete", themed: true }), true);
      assert.equal(predicate({ readyState: "complete", themed: false }), false);
      assert.equal(predicate(null), false);
    },
  };
  await terminalThemed(s, "tab-3");
  assert.deepEqual(calls, [{ name: "core.surface.document", options: { surface: "tab-3" } }]);
});
