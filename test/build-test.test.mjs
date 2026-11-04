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
const copies = path.join(root, "test/fixtures/contract");
function fixture(t, { testSource, uiFiles = {}, tableSource = table }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-build-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ["scripts", "test", "ui", "build/test/ui", "node_modules"]) fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.cpSync(path.join(root, "node_modules/acorn"), path.join(dir, "node_modules/acorn"), { recursive: true });
  fs.cpSync(copies, path.join(dir, "test/fixtures/contract"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/build-test.mjs"), buildSource);
  fs.writeFileSync(path.join(dir, "scripts/test-sdk-cases.json"), tableSource);
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

test("build permits an SDK package key in manifest test data", (t) => {
  const manifest = `const manifest = { dependencies: { "@soksak/sidecar-vt-alacritty": "^0.0.12" } };\n`;
  const dir = fixture(t, { testSource: manifest + testImportEntry() });
  const result = runBuild(dir);
  assert.equal(result.status, 0, result.stderr);
});

test("build rejects actual SDK imports in test sources through the parsed graph", (t) => {
  const specifier = "@soksak" + "/plugin-api/screen-hash";
  const dir = fixture(t, { testSource: staticImport(specifier) + testImportEntry() });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted an SDK import from a test source");
  assert.match(result.stderr, /test source reaches an SDK package: @soksak\/plugin-api\/screen-hash/);
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

// The table with one module changed: the module of the specifier gets the fields of change.
function tableWith(specifier, change) {
  const parsed = JSON.parse(table);
  const module = parsed.modules.find((candidate) => candidate.specifier === specifier);
  Object.assign(module, change(module));
  return JSON.stringify(parsed);
}
const SCREEN_HASH = "@soksak" + "/plugin-api/screen-hash";
const withoutSkip = (skip, id) => Object.fromEntries(Object.entries(skip).filter(([key]) => key !== id));

test("build names every case of a listed copy that the fake neither replays nor skips", (t) => {
  const dir = fixture(t, { testSource: testImportEntry(), tableSource: tableWith(SCREEN_HASH, () => ({ skip: {} })) });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted the cases of screen-hash.json without a skip list");
  assert.match(result.stderr, /the fake neither replays nor skips /);
  for (const id of [
    "screen.bytes.canonical-order",
    "screen.message.projects-hashed-fields",
    "screen.refusal.names-invalid-member",
    "screen.message.empty-one-cell",
    "screen.message.empty-one-cell-attributes-change",
  ]) assert.match(result.stderr, new RegExp(id.replaceAll(".", "\\.") + " \\(screen-hash\\.json\\)"));
});

test("build fails when one case of a listed copy is neither replayed nor skipped", (t) => {
  const tableSource = tableWith(SCREEN_HASH, (module) => ({ skip: withoutSkip(module.skip, "screen.bytes.canonical-order") }));
  const dir = fixture(t, { testSource: testImportEntry(), tableSource });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted screen.bytes.canonical-order without replaying or skipping it");
  assert.match(result.stderr, /the fake neither replays nor skips screen\.bytes\.canonical-order \(screen-hash\.json\)$/m);
});

test("build fails when the skip list names a case that the fake replays", (t) => {
  const tableSource = tableWith(SCREEN_HASH, (module) => ({ skip: { ...module.skip, "screen.hash.two-rows.sha256": "a one-step hash case" } }));
  const dir = fixture(t, { testSource: testImportEntry(), tableSource });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted a skip of a case that the fake replays");
  assert.match(result.stderr, /the skip list of @soksak\/plugin-api\/screen-hash names a case that the fake replays: screen\.hash\.two-rows\.sha256/);
});

test("build fails when the skip list names a case that no listed copy holds", (t) => {
  const tableSource = tableWith(SCREEN_HASH, (module) => ({ skip: { ...module.skip, "screen.absent": "no such case" } }));
  const dir = fixture(t, { testSource: testImportEntry(), tableSource });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted a skip of a case that no listed copy holds");
  assert.match(result.stderr, /the skip list of @soksak\/plugin-api\/screen-hash names a case that no listed copy holds: screen\.absent/);
});

test("build fails when a module lists a copy that test/fixtures/contract does not hold", (t) => {
  const tableSource = tableWith(SCREEN_HASH, (module) => ({ cases: [...module.cases, "absent.json"] }));
  const dir = fixture(t, { testSource: testImportEntry(), tableSource });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, "build accepted a listed copy that does not exist");
  assert.match(result.stderr, /test\/fixtures\/contract\/absent\.json/);
});

// Each case that the fake replays, called through the exports that the UI imports in a separate process: the input of a
// quote is its path, of an apply its previous screen and message, and of a hash its screen; the result is the output, or
// the message of the thrown error is the error.
const replaySource = [
  "im" + "port { readFileSync } from \"node:fs\";",
  "im" + "port * as entry from \"./build/test/ui/entry.js\";",
  "const calls = {",
  "  quote: (input) => entry.shellQuotePath(input.path),",
  "  apply: (input) => entry.applyScreenMessage(input.previous, input.message),",
  "  hash: (input) => entry.screenHash(input.screen),",
  "};",
  "const results = [];",
  "for (const { id, operation, input } of JSON.parse(readFileSync(process.argv[2], \"utf8\"))) {",
  "  try { results.push({ id, value: await calls[operation](input) }); } catch (error) { results.push({ id, error: error.message }); }",
  "}",
  "process.stdout.write(JSON.stringify(results));",
].join("\n") + "\n";

test("the fakes replay every case of the listed copies that the skip lists do not name", (t) => {
  const dir = fixture(t, {
    testSource: testImportEntry(),
    uiFiles: {
      "entry.js": [
        "im" + "port { shellQuotePath } from \"@soksak/plugin-api\";",
        "im" + "port { applyScreenMessage, screenHash } from \"@soksak/plugin-api/screen-hash\";",
        "export { shellQuotePath, applyScreenMessage, screenHash };",
      ].join("\n") + "\n",
    },
  });
  const result = runBuild(dir);
  assert.equal(result.status, 0, result.stderr);
  const outputs = { quote: (output) => output.path, apply: (output) => output.applied, hash: (output) => output.hash };
  const calls = [];
  const expected = [];
  for (const module of JSON.parse(table).modules) {
    const operations = new Set(Object.values(module.exports));
    for (const name of module.cases) {
      for (const testCase of JSON.parse(fs.readFileSync(path.join(copies, name), "utf8")).cases) {
        if (Object.hasOwn(module.skip, testCase.id)) continue;
        assert.equal(testCase.steps.length, 1, testCase.id);
        const [step] = testCase.steps;
        const [operation] = Object.keys(step).filter((key) => operations.has(key));
        assert.ok(operation, testCase.id);
        calls.push({ id: testCase.id, operation, input: step[operation] });
        expected.push(Object.hasOwn(step.output, "error")
          ? { id: testCase.id, error: step.output.error }
          : { id: testCase.id, value: outputs[operation](step.output) });
      }
    }
  }
  fs.writeFileSync(path.join(dir, "replay.mjs"), replaySource);
  fs.writeFileSync(path.join(dir, "calls.json"), JSON.stringify(calls));
  const replay = spawnSync(process.execPath, [path.join(dir, "replay.mjs"), path.join(dir, "calls.json")], { cwd: dir, encoding: "utf8" });
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(JSON.parse(replay.stdout), expected);
  assert.equal(expected.length, 4 + 53);
});
