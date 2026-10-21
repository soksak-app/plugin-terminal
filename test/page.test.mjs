import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the view page replaces the page-mount module", () => {
  assert.equal(existsSync(new URL("../ui/terminal-module.js", import.meta.url)), false, "the page-mount module is removed");
  assert.ok(pkg.files.includes(manifest.surface.composition.page));
  assert.ok(pkg.files.includes("ui/view.js"));
  const view = readFileSync(new URL("../ui/view.js", import.meta.url), "utf8");
  assert.match(view, /export async function mount/);
  assert.match(view, /createViewBridge/);
  assert.match(view, /sokSurface/);
});
