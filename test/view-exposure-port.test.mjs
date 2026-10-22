import assert from "node:assert/strict";
import test from "node:test";
import { createExposurePort } from "../build/test/ui/view-exposure-port.js";

test("the exposure port of the view reports a refused reply through the page report", async () => {
  const records = [];
  const requests = [];
  const bridge = {
    calls: { request: async (command, params) => { requests.push([command, params]); return null; } },
    exposure: { register: async () => null, reply: async () => { throw new Error("the host refused the reply"); } },
  };
  const port = createExposurePort({
    bridge, runtime: { native: { on: () => () => {} } }, releaseOf: () => {}, report: (text) => records.push(text),
  });
  assert.equal(typeof port.report, "function", "core createExpose requires the port report function");
  await port.report("exposure reply 4: the host refused the reply");
  assert.deepEqual(records, ["exposure: exposure reply 4: the host refused the reply"]);
  await port.register("command", "terminal.write");
  assert.deepEqual(requests, [["runtime.command.register", { name: "terminal.write" }]]);
});
