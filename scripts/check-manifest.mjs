// Checks plugin.json, diagnostics.json and the files of package.json with the readers of @soksak/plugin-api, which package.json
// pins to the release of the lowest core that engines.soksak admits: the installer of core refuses a release that these readers
// refuse. It runs without the fixture loader of the page tests (test/fixtures/plugin-api/register.mjs), so it imports the
// published plugin API itself.
import { readFileSync } from "node:fs";
import { validateDiagnostics, validateManifest, validateReleaseFiles } from "@soksak/plugin-api";

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const manifest = read("plugin.json");
const checks = [
  ["plugin.json", () => validateManifest(manifest)],
  ["diagnostics.json", () => validateDiagnostics(manifest, read("diagnostics.json"))],
  ["package.json files", () => validateReleaseFiles(read("package.json"))],
];

let failed = 0;
for (const [name, check] of checks) {
  const started = performance.now();
  process.stdout.write(`running ${name}\n`);
  try {
    check();
    process.stdout.write(`passed ${name} ${(performance.now() - started).toFixed(3)} ms\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`failed ${name} ${(performance.now() - started).toFixed(3)} ms: ${error.message}\n`);
  }
}
if (failed > 0) {
  process.stderr.write(`check-manifest: ${failed} of ${checks.length} checks failed\n`);
  process.exit(1);
}
