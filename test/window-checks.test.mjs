// The declaration of the window checks of this repository (docs/operations/window-checks.md): the checks run through
// @soksak/window-check of the core release that package.json names, which the engines.soksak range admits, and `make test-app`
// runs them. The checks themselves need a display and run only locally, so no test here runs them.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const RELEASE = /^https:\/\/github\.com\/soksak-app\/core\/releases\/download\/v(\d+\.\d+\.\d+)\/soksak-window-check-\1\.tgz$/;

test("@soksak/window-check is a development dependency that names a core release file inside the engines.soksak range", { timeout: 1000 }, () => {
  const declared = PACKAGE.devDependencies?.["@soksak/window-check"];
  const version = RELEASE.exec(declared)?.[1];
  assert.ok(version, `devDependencies names no core release file of @soksak/window-check: ${JSON.stringify(declared)}`);
  const range = /^\^(0\.0\.)(\d+)$/.exec(PACKAGE.engines.soksak);
  assert.ok(range, `engines.soksak ${PACKAGE.engines.soksak} is not a range ^0.0.z`);
  const [, prefix, first] = range;
  assert.ok(version.startsWith(prefix) && Number(version.slice(prefix.length)) >= Number(first),
    `the window-check release ${version} is outside ${PACKAGE.engines.soksak}`);
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    assert.equal(PACKAGE[field]?.["@soksak/window-check"], undefined, `${field} must not name @soksak/window-check: it is not part of the release`);
  }
  assert.equal(PACKAGE.files.some((entry) => entry === "e2e" || entry.startsWith("e2e/")), false, "the release must not carry the window checks");
});

test("e2e holds the window checks of the injection and of the submit with their shell and programs, and every check file imports only node and window-check modules and its own folder", { timeout: 1000 }, () => {
  const folder = path.join(ROOT, "e2e");
  for (const file of ["injection.test.mjs", "submit.test.mjs"]) assert.ok(existsSync(path.join(folder, file)), `e2e/${file} is missing`);
  for (const file of ["check-shell", "blocked-prompt", "paste-burst"]) {
    assert.ok(statSync(path.join(folder, file)).mode & 0o111, `e2e/${file} is not executable`);
  }
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".mjs"))) {
    const source = readFileSync(path.join(folder, file), "utf8");
    for (const [, specifier] of source.matchAll(/^import[^"]*"([^"]+)"/gm)) {
      assert.ok(specifier.startsWith("node:") || specifier.startsWith("@soksak/window-check/") || specifier.startsWith("./"),
        `e2e/${file} imports ${specifier}, which is neither a node module, a window-check module nor a file of e2e`);
    }
  }
});

test("make test-app runs the window checks of the published core application and no workflow runs it", { timeout: 5000 }, () => {
  const output = execFileSync("make", ["-n", "test-app"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(output.trim(), "pnpm exec sok-test-app");
  const folder = path.join(ROOT, ".github", "workflows");
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".yml"))) {
    assert.doesNotMatch(readFileSync(path.join(folder, file), "utf8"), /test-app|sok-test-app/, `${file} runs the window checks`);
  }
});

test("make test-app-agent-role runs only the agent role acceptance, outside the window checks of make test-app", { timeout: 5000 }, () => {
  const output = execFileSync("make", ["-n", "test-app-agent-role"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(output.trim(), "pnpm exec sok-test-app acceptance/agent-role.test.mjs");
  assert.equal(existsSync(path.join(ROOT, "acceptance", "agent-role.test.mjs")), true);
  assert.equal(existsSync(path.join(ROOT, "e2e", "agent-role.test.mjs")), false, "the acceptance is not an e2e check of make test-app");
});
