// The census of core (docs/spec/logging.md#census in core) applies to this repository: its sources pass with census.json, and a
// source of occurrences that a test adds without an event or a reason fails. The command is soksak-events of the
// @soksak/plugin-api that package.json names; SOKSAK_EVENTS names another command (a path to events-check.js of a checkout of
// core), because the pinned release has no soksak-events (P32.2).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const command = process.env.SOKSAK_EVENTS ?? join(root, "node_modules/.bin/soksak-events");

/** Runs the census in `directory` with the declaration census.json there and returns the exit status and the output. */
function census(directory) {
  const args = ["--census", "census.json", "."];
  const run = command.endsWith(".js") ? spawnSync("node", [command, ...args], { cwd: directory, encoding: "utf8" })
    : spawnSync(command, args, { cwd: directory, encoding: "utf8" });
  assert.equal(run.error, undefined, `${command}: ${run.error}`);
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test("the sources of this repository pass the census", () => {
  const { status, output } = census(root);
  assert.equal(status, 0, output);
});

test("a source without an event or a reason fails the census, and a reason makes it pass", () => {
  const directory = mkdtempSync(join(tmpdir(), "terminal-census-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: directory });
    cpSync(join(root, "census.json"), join(directory, "census.json"));
    mkdirSync(join(directory, "ui"));
    const source = join(directory, "ui/probe.js");
    writeFileSync(source, "export function read(value) {\n  try {\n    return JSON.parse(value);\n  } catch {}\n}\n");
    execFileSync("git", ["add", "ui/probe.js", "census.json"], { cwd: directory });
    const failed = census(directory);
    assert.equal(failed.status, 1, failed.output);
    assert.match(failed.output, /ui\/probe\.js:4: js\.empty-catch has neither an event nor a stated reason/);
    writeFileSync(source, "export function read(value) {\n  try {\n    return JSON.parse(value);\n    // silent: a value that is not JSON reads as nothing, as the contract of the probe states.\n  } catch {}\n}\n");
    const passed = census(directory);
    assert.equal(passed.status, 0, passed.output);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
