import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildSource = fs.readFileSync(path.join(root, "scripts/build-test.mjs"), "utf8");
const table = fs.readFileSync(path.join(root, "scripts/test-sdk-cases.json"), "utf8");
function fixture(t, { testSource, uiFiles = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-build-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ["scripts", "test", "ui", "build/test/ui"]) fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/build-test.mjs"), buildSource);
  fs.writeFileSync(path.join(dir, "scripts/test-sdk-cases.json"), table);
  fs.writeFileSync(path.join(dir, "test/entry.test.mjs"), testSource);
  for (const [name, content] of Object.entries(uiFiles)) fs.writeFileSync(path.join(dir, "ui", name), content);
  if (!uiFiles["entry.js"]) fs.writeFileSync(path.join(dir, "ui/entry.js"), "export {};\n");
  return dir;
}
function runBuild(dir) {
  return spawnSync(process.execPath, [path.join(dir, "scripts/build-test.mjs")], { cwd: dir, encoding: "utf8" });
}
function staticImport(specifier) { return "im" + "port " + JSON.stringify(specifier) + ";\n"; }
function testImportEntry() { return staticImport("../build/test/ui/entry.js"); }
function packageFixture(dir, manifest) {
  const pkg = path.join(dir, "node_modules", "fixture-package");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "fixture-package", ...manifest }));
  fs.writeFileSync(path.join(pkg, "index.js"), "export {};\n");
}

test("build fails when a required test dependency is unresolved", (t) => {
  const dir = fixture(t, { testSource: staticImport("@missing" + "/required") + testImportEntry() });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted unresolved required dependency @missing/required");
  assert.match(result.stderr, /@missing\/required/);
});

test("build fails when a required transitive peer dependency is unresolved", (t) => {
  const dir = fixture(t, { testSource: staticImport("fixture-package") + testImportEntry() });
  packageFixture(dir, { peerDependencies: { "@missing/peer": "*" } });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted unresolved required peer @missing/peer");
  assert.match(result.stderr, /@missing\/peer/);
});

test("build permits an absent peer marked optional", (t) => {
  const dir = fixture(t, { testSource: staticImport("fixture-package") + testImportEntry() });
  packageFixture(dir, { peerDependencies: { "@missing/peer": "*" }, peerDependenciesMeta: { "@missing/peer": { optional: true } } });
  const result = runBuild(dir);
  assert.equal(result.status, 0, result.stderr);
});

test("build rejects an SDK import in a relative helper outside copied UI", (t) => {
  const dir = fixture(t, { testSource: testImportEntry(), uiFiles: { "entry.js": staticImport("../../outside/helper.js") } });
  fs.mkdirSync(path.join(dir, "outside"), { recursive: true });
  fs.writeFileSync(path.join(dir, "outside/helper.js"), staticImport("@soksak" + "/plugin-api/screen-hash") + "export { screenHash };\n");
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted SDK import in helper outside copied UI");
  assert.match(result.stderr, /outside\/helper\.js/);
});
