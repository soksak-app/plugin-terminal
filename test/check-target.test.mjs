import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const make = (...args) => execFileSync("make", args, { cwd: root, encoding: "utf8" });

test("test runs plugin tests only", () => {
  const output = make("-n", "test");
  assert.ok(output.includes("pnpm test"));
  for (const command of ["soksak-exposure", "soksak-engines", "soksak-events", "soksak-records"]) {
    assert.equal(output.includes(command), false, "test runs " + command);
  }
});

test("check runs the SDK validation subset without running plugin tests", () => {
  const output = make("-n", "check");
  for (const command of ["view-check.js", "exposure-check.js", "engines-check.js", "events-check.js", "records-check.js"]) {
    assert.ok(output.includes(`node \"node_modules/@soksak/plugin-api/${command}\"`), "check omits " + command);
  }
  assert.ok(output.includes("--census census.json --catalog events.json"));
  assert.equal(output.includes("pnpm test"), false);
});

test("check validates the view literal against its copied screen vector", () => {
  const output = make("-n", "check");
  assert.match(output, /(?:soksak-view-check|view-check\.js).*view-check\.json.*test\/fixtures\/screen-message\.json/);
});

test("check uses the declared local SDK source override for the view checker", () => {
  const output = make("-n", "check", "CORE_PLUGIN_API_DIR=/tmp/core-plugin-api");
  assert.match(output, /node "\/tmp\/core-plugin-api\/view-check\.js" view-check\.json test\/fixtures\/screen-message\.json/);
});

test("check runs every validator from the selected SDK directory", () => {
  const temporary = mkdtempSync(join(tmpdir(), "terminal-sdk-check-"));
  const sdk = join(temporary, "plugin-api");
  const trace = join(temporary, "tools.jsonl");
  const bin = join(temporary, "bin");
  const table = JSON.parse(readFileSync(join(root, "scripts", "test-sdk-cases.json"), "utf8"));
  try {
    const files = [];
    for (const module of table.modules) {
      const contractPath = join(sdk, module.contractFile);
      mkdirSync(resolve(contractPath, ".."), { recursive: true });
      writeFileSync(contractPath, JSON.stringify({ cases: module.caseCopies }));
      files.push(module.contractFile);
    }
    mkdirSync(sdk, { recursive: true });
    writeFileSync(join(sdk, "package.json"), JSON.stringify({ type: "module", files }));
    for (const tool of ["view-check.js", "exposure-check.js", "engines-check.js", "events-check.js", "records-check.js"]) {
      writeFileSync(join(sdk, tool), `import { appendFileSync } from "node:fs";\nappendFileSync(process.env.SDK_TOOL_TRACE, JSON.stringify({ tool: ${JSON.stringify(tool)}, args: process.argv.slice(2) }) + "\\n");\n`);
    }
    mkdirSync(bin);
    const fakePnpm = join(bin, "pnpm");
    writeFileSync(fakePnpm, `#!/usr/bin/env node\nconst { appendFileSync } = require("node:fs");\nappendFileSync(process.env.SDK_TOOL_TRACE, JSON.stringify({ tool: "pinned-pnpm", args: process.argv.slice(2) }) + "\\n");\n`);
    chmodSync(fakePnpm, 0o755);

    execFileSync("make", ["check", `CORE_PLUGIN_API_DIR=${sdk}`], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, SDK_TOOL_TRACE: trace },
    });
    const calls = readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(calls.map((call) => call.tool), ["view-check.js", "exposure-check.js", "engines-check.js", "events-check.js", "records-check.js"]);
    assert.deepEqual(calls[3].args, ["--census", "census.json", "--catalog", "events.json"]);

    rmSync(join(sdk, "engines-check.js"));
    const missing = spawnSync("make", ["check", `CORE_PLUGIN_API_DIR=${sdk}`], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, SDK_TOOL_TRACE: trace },
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, new RegExp(`missing SDK checker: ${sdk}/engines-check\\.js`));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("pack runs check before pnpm pack", () => {
  const output = make("-n", "pack", "OUT=/tmp/terminal-check-package");
  const check = output.indexOf("exposure-check.js");
  const pack = output.indexOf("pnpm pack --pack-destination /tmp/terminal-check-package");
  assert.ok(check >= 0, "pack omitted the check prerequisites");
  assert.ok(pack > check, "pack ran before check");
});
