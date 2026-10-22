import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { viewSidecar } from "../ui/view-sidecar.js";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
// The sidecar of the view is the only dependency of plugin.json (core docs/spec/native-surfaces.md, view calls).
const [SIDECAR] = Object.keys(manifest.dependencies);

/** A call route and a bridge that record each call and each sidecar name that the bridge receives. */
function fakeView() {
  const requests = [];
  const sidecarNames = [];
  const subscriptions = [];
  const sidecar = (name) => {
    sidecarNames.push(name);
    return {
      on: async (id) => { subscriptions.push({ kind: "message", id }); return () => {}; },
      onFailure: async (id) => { subscriptions.push({ kind: "failure", id }); return () => {}; },
    };
  };
  return {
    requests,
    sidecarNames,
    subscriptions,
    calls: { request: async (command, params) => { requests.push({ command, params }); return "probe-answer"; } },
    runtime: { sidecar },
  };
}

test("a sidecar send names the declared sidecar in the call runtime.sidecar.send", async () => {
  const view = fakeView();
  const port = viewSidecar(view.calls, view.runtime);
  const cids = ["c-1"];
  assert.equal(await port.send("probe-surface", { operation: "probe" }, cids), "probe-answer");
  assert.deepEqual(view.requests, [{
    command: "runtime.sidecar.send",
    params: { id: "probe-surface", sidecar: SIDECAR, body: { operation: "probe" }, cids },
  }]);
});

test("the sidecar subscriptions of a session name the declared sidecar", async () => {
  const view = fakeView();
  const port = viewSidecar(view.calls, view.runtime);
  await port.on("probe-surface", () => {});
  await port.onFailure("probe-surface", () => {});
  assert.deepEqual(view.sidecarNames, [SIDECAR, SIDECAR]);
  assert.deepEqual(view.subscriptions, [{ kind: "message", id: "probe-surface" }, { kind: "failure", id: "probe-surface" }]);
});
