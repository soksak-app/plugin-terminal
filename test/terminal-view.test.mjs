import assert from "node:assert/strict";
import test from "node:test";
import { startValues } from "../build/test/ui/terminal-view.js";

const windowWith = (start) => ({ sokSurface: start, location: { host: "terminal" } });
const START = { surface: "terminal-1", params: null, project: null, declarations: {} };

test("the start values refuse a project that has no id, and accept a project with its id", () => {
  const origin = { directory: null };
  assert.throws(() => startValues(windowWith({ ...START, origin, project: { root: "/work/app" } })), /project is \{"root":"\/work\/app"\}/);
  assert.doesNotThrow(() => startValues(windowWith({ ...START, origin, project: { id: "prj-app", root: "/work/app" } })));
});

test("the start values refuse an origin that is null, and accept {directory} with a path or null", () => {
  assert.throws(() => startValues(windowWith({ ...START, origin: null })), /origin/);
  assert.equal(startValues(windowWith({ ...START, origin: { directory: null } })).origin.directory, null);
  assert.equal(startValues(windowWith({ ...START, origin: { directory: "/work" } })).origin.directory, "/work");
});
