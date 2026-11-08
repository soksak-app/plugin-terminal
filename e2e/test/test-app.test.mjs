// Unit checks of the names and the registry entries of the window-check run (scripts/test-app.mjs).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applicationZip, bundleExecutables, CHECKS, packFileName, pluginEntry, repositoryAddress, sidecarFileName, tierOf }
  from "../../scripts/test-app.mjs";

test("the run names the published application zip and the executables of its bundle as core releases them", () => {
  assert.deepEqual(applicationZip("0.0.40", "wailsv3"), { name: "soksak-0.0.40-darwin-arm64-wailsv3.zip",
    url: "https://github.com/soksak-app/core/releases/download/v0.0.40/soksak-0.0.40-darwin-arm64-wailsv3.zip" });
  assert.deepEqual(bundleExecutables("/cache/soksak.app", "mygo"),
    { application: "/cache/soksak.app/Contents/MacOS/sok-mygo", sok: "/cache/soksak.app/Contents/MacOS/sok" });
  assert.equal(packFileName("@soksak/plugin-terminal", "0.0.25"), "soksak-plugin-terminal-0.0.25.tgz");
  assert.equal(sidecarFileName("@soksak/sidecar-files"), "soksak-sidecar-files");
  assert.equal(repositoryAddress({ url: "git+https://github.com/soksak-app/plugin-terminal.git" }), "https://github.com/soksak-app/plugin-terminal");
});

test("the registry entry of a plugin release lists the address and digest of its pack file and only the sidecars of the registry", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "test-app-entry-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const release = join(folder, "release.tgz");
  writeFileSync(release, "release");
  const entry = pluginEntry({ id: "probe", name: "Probe", dependencies: { "@soksak/sidecar-files": ">=0.0.9", "@soksak/plugin-other": "^1.0.0" } },
    { name: "@soksak/plugin-probe", version: "1.2.3", description: "Probe.", license: "MIT", repository: "https://github.com/soksak-app/probe",
      engines: { soksak: "^0.0.40" } }, release, new Set(["@soksak/sidecar-files"]));
  assert.deepEqual(entry, {
    id: "probe", package: "@soksak/plugin-probe", name: "Probe", description: "Probe.", license: "MIT",
    repository: "https://github.com/soksak-app/probe",
    versions: [{ version: "1.2.3", release: { url: pathToFileURL(release).href, sha256: createHash("sha256").update("release").digest("hex") },
      engines: { soksak: "^0.0.40" }, sidecars: { "@soksak/sidecar-files": ">=0.0.9" } }],
  });
});

test("every check file under e2e/ belongs to exactly one tier, and only --real selects the checks of real input", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const files = (directory) => readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? files(`${directory}/${entry.name}`) : entry.name.endsWith(".test.mjs") ? [`${directory}/${entry.name}`] : []);
  const tiers = (file) => Object.keys(CHECKS).filter((tier) => CHECKS[tier].some((pattern) => matchesGlob(file, pattern)));
  const checks = files("e2e");
  assert.ok(checks.includes("e2e/real/terminal.test.mjs"));
  assert.deepEqual(checks.filter((file) => tiers(file).length !== 1), [], "a check file runs in no tier or in two tiers");
  assert.deepEqual(checks.filter((file) => tiers(file)[0] === "real"), checks.filter((file) => file.startsWith("e2e/real/")));
  assert.equal(tierOf([]), "app");
  assert.equal(tierOf(["--real"]), "real");
  assert.throws(() => tierOf(["--person"]), /--person/);
});
