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
  for (const command of ["soksak-events", "soksak-records"]) {
    assert.equal(output.includes(command), false, "test runs " + command);
  }
});

test("check runs the census check of the events kit and the record check of the records kit without running plugin tests", () => {
  const output = make("-n", "check");
  assert.ok(output.includes("pnpm exec soksak-events --census census.json --catalog events.json"));
  assert.ok(output.includes("pnpm exec soksak-records"));
  assert.equal(output.includes("pnpm test"), false);
});

test("pack runs check before pnpm pack", () => {
  const output = make("-n", "pack", "OUT=/tmp/terminal-check-package");
  const check = output.indexOf("soksak-records");
  const pack = output.indexOf("pnpm pack --pack-destination /tmp/terminal-check-package");
  assert.ok(check >= 0, "pack omitted the check prerequisites");
  assert.ok(pack > check, "pack ran before check");
});
