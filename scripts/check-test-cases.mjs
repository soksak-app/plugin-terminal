import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.resolve(process.env.CORE_PLUGIN_API_DIR || path.join(root, "node_modules", "@soksak", "plugin-api"));
const table = JSON.parse(fs.readFileSync(path.join(root, "scripts", "test-sdk-cases.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(apiDir, "package.json"), "utf8"));
const packagedFiles = new Set(packageJson.files || []);
let caseCount = 0;
let exportCount = 0;

if (!Array.isArray(table.modules) || table.modules.length === 0) throw new Error("test contract table has no modules");
for (const module of table.modules) {
  if (!module.specifier || !module.contractFile || !Array.isArray(module.caseCopies) || !module.exports) {
    throw new Error("malformed test contract table module");
  }
  if (!packagedFiles.has(module.contractFile)) throw new Error("API package does not publish contract file " + module.contractFile);
  const contractPath = path.join(apiDir, module.contractFile);
  if (!fs.existsSync(contractPath)) throw new Error("published API contract is missing: " + contractPath);
  const published = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const publishedById = new Map(published.cases.map((testCase) => [testCase.id, testCase]));
  const copiedById = new Map();
  for (const copied of module.caseCopies) {
    if (copiedById.has(copied.id)) throw new Error("duplicate case copy " + copied.id + " for " + module.specifier);
    const actual = publishedById.get(copied.id);
    if (!actual) throw new Error("no published case for fake " + module.specifier + "#" + copied.id);
    assert.deepEqual(copied, actual, "published contract drift: " + module.contractFile + "#" + copied.id);
    if (copied.steps.length !== 1) throw new Error("test fake cases must be one-call published instances: " + copied.id);
    copiedById.set(copied.id, copied);
    caseCount += 1;
  }
  for (const [name, operation] of Object.entries(module.exports)) {
    exportCount += 1;
    const inputs = [];
    for (const testCase of module.caseCopies) {
      const step = testCase.steps[0];
      if (!Object.hasOwn(step, operation)) continue;
      const expected = step[operation];
      const input = operation === "quote" ? expected.path : operation === "message" ? expected.value : expected.screen;
      if (inputs.some((seen) => isDeepStrictEqual(seen, input))) throw new Error("ambiguous copied cases for fake export " + module.specifier + "#" + name);
      inputs.push(input);
    }
    if (inputs.length === 0) throw new Error("fake export has no published example: " + module.specifier + "#" + name);
  }
}
console.log("Test contract table checks passed: " + exportCount + " exports, " + caseCount + " copied cases");
