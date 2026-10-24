import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sok = process.env.SOK;
const registry = process.env.CANDIDATE_REGISTRY;
const expectedTerminalVersion = process.env.EXPECTED_TERMINAL_VERSION;

for (const [name, value] of Object.entries({ SOK: sok, CANDIDATE_REGISTRY: registry,
  EXPECTED_TERMINAL_VERSION: expectedTerminalVersion })) {
  if (!value) throw new Error(`${name} is required`);
}

const index = JSON.parse(readFileSync(path.join(registry, "index.json"), "utf8"));
const terminal = index.plugins.find(({ id }) => id === "terminal");
const vt = index.sidecars.find(({ name }) => name === "@soksak/sidecar-vt-alacritty");
assert.ok(terminal?.versions.some(({ version }) => version === expectedTerminalVersion),
  `registry does not list terminal ${expectedTerminalVersion}`);
assert.ok(vt?.versions.some(({ version }) => version === "0.0.15"),
  "registry must include prior VT 0.0.15 for the controlled selection check");
assert.ok(vt?.versions.some(({ version }) => version === "0.0.16"),
  "registry must include VT 0.0.16 for the controlled selection check");

const config = mkdtempSync(path.join(os.tmpdir(), "soksak-terminal-candidate-install-"));

const run = (name, args) => {
  const started = performance.now();
  process.stdout.write(`running ${name}\n`);
  const result = spawnSync(sok, args, { encoding: "utf8", timeout: 120000 });
  const elapsed = (performance.now() - started).toFixed(3);
  if (result.error) {
    process.stdout.write(`failed ${name} ${elapsed} ms: ${result.error.message}\n`);
    throw new Error(`sok ${args.join(" ")} could not start\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`, { cause: result.error });
  }
  if (result.status !== 0) {
    process.stdout.write(`failed ${name} ${elapsed} ms: exit ${result.status}\n`);
    throw new Error(`sok ${args.join(" ")} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  process.stdout.write(`finished ${name} ${elapsed} ms\n`);
  return result.stdout;
};

try {
  run("registry use", ["registry", "use", path.join(registry, "index.json"), "--config-dir", config]);
  run("plugin install", ["plugin", "install", "terminal", "--config-dir", config]);

  const installed = JSON.parse(readFileSync(path.join(config, "plugins", "installed.json"), "utf8"));
  process.stdout.write(`observed terminal ${installed.plugins.terminal.version}; VT ${installed.sidecars["@soksak/sidecar-vt-alacritty"].version}\n`);
  assert.equal(installed.format, 3, "installer writes the current installed manifest format");
  assert.equal(installed.plugins.terminal.version, expectedTerminalVersion,
    "installer selected the expected terminal package version");
  assert.equal(installed.sidecars["@soksak/sidecar-vt-alacritty"].version, "0.0.16",
    "candidate installation selects VT 0.0.16 for diagnostic frame rendering");
  const pluginDirectory = path.join(config, installed.plugins.terminal.path);
  const diagnosticsPath = path.join(pluginDirectory, "diagnostics.json");
  assert.ok(existsSync(diagnosticsPath), "installed diagnostic candidate includes diagnostics.json");
  const diagnostics = JSON.parse(readFileSync(diagnosticsPath, "utf8"));
  assert.equal(diagnostics.module, "ui/terminal-diagnostics.js",
    "diagnostics.json names the module loaded by the terminal view");
  const diagnosticsModule = path.join(pluginDirectory, diagnostics.module);
  assert.ok(existsSync(diagnosticsModule) && statSync(diagnosticsModule).isFile(),
    "installed diagnostic candidate includes the declared diagnostics module file");
  process.stdout.write(`observed diagnostic module ${diagnostics.module}\n`);
  process.stdout.write("candidate installation check passed\n");
} finally {
  rmSync(config, { recursive: true, force: true });
}
