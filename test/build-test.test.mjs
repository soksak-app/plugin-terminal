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
  for (const name of ["scripts", "test", "ui", "build/test/ui", "node_modules"]) fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.cpSync(path.join(root, "node_modules/acorn"), path.join(dir, "node_modules/acorn"), { recursive: true });
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

test("build rewrites SDK imports with Unicode-escaped module specifiers", (t) => {
  const dir = fixture(t, {
    testSource: testImportEntry(),
    uiFiles: {
      "entry.js": "im" + "port { screenHash } from \"\\u0040soksak/plugin-api/screen-hash\";\nexport { screenHash };\n"
    }
  });
  const result = runBuild(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(dir, "build/test/ui/entry.js"), "utf8"), /fakes\/sdk-\d+\.mjs/);
});

test("build rejects dynamic imports with computed specifiers", (t) => {
  const dir = fixture(t, {
    testSource: testImportEntry(),
    uiFiles: { "entry.js": "const dependency = \"./helper.js\";\n" + "im" + "port(dependency);\n" }
  });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build ignored a dynamic import with an unresolved computed specifier");
  assert.match(result.stderr, /non-literal module specifier/);
});

test("build rejects an SDK import in a relative helper outside copied UI", (t) => {
  const dir = fixture(t, { testSource: testImportEntry(), uiFiles: { "entry.js": staticImport("../../outside/helper.js") } });
  const helper = path.join(dir, "build/outside/helper.js");
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  const specifier = "@soksak" + "/plugin-api/screen-hash";
  fs.writeFileSync(helper, "im" + "port { screenHash } from " + JSON.stringify(specifier) + ";\nexport { screenHash };\n");
  assert.equal(fs.existsSync(helper), true, "escaped import target fixture was not created");
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted SDK import in helper outside copied UI");
  assert.match(result.stderr, /outside\/helper\.js/);
});
