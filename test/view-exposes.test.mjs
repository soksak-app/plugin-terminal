// The exposure bundle of the view declares each entry once. In a diagnostic build the start values already hold the diagnostics.json
// entries, because the workbench adds them to the surface declarations (core docs/spec/plugins.md, diagnostics).
import assert from "node:assert/strict";
import test from "node:test";
import { viewExposes } from "../build/test/ui/view-exposes.js";

const entry = (name) => ({ name, description: name, schema: { type: "object" } });

test("a diagnostic build declares each diagnostic entry once when the start values already hold it", () => {
  const start = { declarations: { status: [entry("terminal.screen"), entry("terminal.pointer.trace")] } };
  const names = viewExposes(start).status.map(({ name }) => name);
  assert.deepEqual(names, ["terminal.screen", "terminal.pointer.trace"], "the diagnostic entry is declared twice");
});

test("the view declares the start values as they are", () => {
  const start = { declarations: { status: [entry("terminal.screen")] } };
  assert.equal(viewExposes(start), start.declarations);
});
