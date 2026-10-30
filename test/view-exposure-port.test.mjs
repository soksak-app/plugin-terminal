import assert from "node:assert/strict";
import test from "node:test";
import * as port from "../build/test/ui/view-exposure-port.js";

const { createExposurePort } = port;

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
});

test("the exposure port sends no declaration of a command, and a command of the view registers its handler in the bridge", async () => {
  const requests = [];
  const bridge = {
    calls: { request: async (command, params) => { requests.push([command, params]); return null; } },
    exposure: { register: async () => null, reply: async () => null },
  };
  const exposurePort = createExposurePort({ bridge, runtime: { native: { on: () => () => {} } }, releaseOf: () => {}, report: () => {} });
  // Core sends a forwarded command.run of a registered view command to the view as a command request, which the bridge answers
  // from the handlers of commands.register (core docs/spec/native-surfaces.md#view-surfaces, view exposure).
  await exposurePort.register("command", "terminal.write");
  assert.deepEqual(requests, [], "the exposure port declared the command besides the bridge");
  const { withBridgeCommands } = port;
  const calls = [];
  const exposure = { status: () => "status", command: async (name, run) => { calls.push(["exposure", name, run]); } };
  const commands = { register: async (name, run) => { calls.push(["bridge", name, run]); } };
  const run = async () => null;
  const wrapped = withBridgeCommands(exposure, commands);
  await wrapped.command("terminal.write", run);
  assert.deepEqual(calls, [["exposure", "terminal.write", run], ["bridge", "terminal.write", run]]);
  assert.equal(wrapped.status(), "status", "the other members of the exposure are kept");
});
