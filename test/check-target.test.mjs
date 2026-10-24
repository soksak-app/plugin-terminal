import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  for (const command of ["soksak-exposure", "soksak-engines", "soksak-events", "soksak-records"]) {
    assert.ok(output.includes(command), "check omits " + command);
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

test("pack runs check before the plugin pack command", () => {
  const output = make("-n", "pack", "OUT=/tmp/terminal-check-package");
  const check = output.indexOf("soksak-exposure");
  const pack = output.indexOf("plugin pack . /tmp/terminal-check-package");
  assert.ok(check >= 0, "pack omitted the check prerequisites");
  assert.ok(pack > check, "pack ran before check");
});
