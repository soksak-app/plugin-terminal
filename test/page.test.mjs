import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the view page delegates through the terminal-view module", () => {
  assert.equal(existsSync(new URL("../ui/terminal-module.js", import.meta.url)), false, "the page-mount module is removed");
  assert.ok(pkg.files.includes(manifest.surface.composition.page));
  assert.ok(pkg.files.includes("ui/view.js"));
  assert.ok(pkg.files.includes("ui/view-log.js"));
  assert.ok(pkg.files.includes("ui/terminal-view.js"));
  const view = readFileSync(new URL("../ui/view.js", import.meta.url), "utf8");
  assert.doesNotMatch(view, /export async function mount/);
  assert.match(view, /await mountPage\(context, report\)/);
  assert.match(view, /createViewBridge/);
  assert.match(view, /sokSurface/);
  assert.match(view, /log: createViewLog\(calls, report\)/);
  const terminalView = readFileSync(new URL("../ui/terminal-view.js", import.meta.url), "utf8");
  assert.match(terminalView, /export async function mount/);
  assert.match(terminalView, /export async function mountPage/);
});
