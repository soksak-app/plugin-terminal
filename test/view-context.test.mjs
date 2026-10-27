import assert from "node:assert/strict";
import test from "node:test";
import { createViewContext, createViewErrorReporter } from "../build/test/ui/view-context.js";

function bridgeWith({ log, error }) {
  const requests = [];
  const bridge = {
    calls: { request(command, params) { requests.push({ command, params }); return Promise.resolve(null); } },
    runtime: {
      log,
      theme() {},
      settings: { read() {}, on() {} },
      textSize: { read() {}, on() {} },
      sidecar() {},
      links: { open() {} },
      clipboard: {},
      error,
    },
    composition: { create() {} },
    exposure: { register() {}, reply() {} },
  };
  return { bridge, requests };
}

function contextFor(bridge) {
  return createViewContext({
    bridge,
    start: { surface: "terminal-1", params: null, origin: { directory: null }, project: null, declarations: {} },
  });
}

test("the view context uses the bridge logger instead of requesting runtime.log itself", { timeout: 5000 }, () => {
  const records = [];
  const logger = Object.fromEntries(["error", "warn", "info", "debug", "trace"].map((level) => [level,
    (...args) => { records.push({ level, args }); }]));
  const { bridge, requests } = bridgeWith({ log: logger, error: () => Promise.resolve() });
  const { context } = contextFor(bridge);
  const fields = { sequence: 4 };
  const options = { cids: ["input-4"] };

  context.runtime.log.debug("view.content_frame", fields, options);

  assert.deepEqual({ records, runtimeLogRequests: requests.filter(({ command }) => command === "runtime.log") }, {
    records: [{ level: "debug", args: ["view.content_frame", fields, options] }],
    runtimeLogRequests: [],
  }, "the view logger records the event without a terminal-owned runtime.log request");
  assert.equal(context.runtime.log, logger, "the bridge logger is the view logger");
});

test("view error reports use runtime.error and report a rejected error route", { timeout: 5000 }, async () => {
  const errors = [];
  const logger = Object.fromEntries(["error", "warn", "info", "debug", "trace"].map((level) => [level,
    () => { throw new Error(`unexpected runtime.log.${level}`); }]));
  const { bridge } = bridgeWith({
    log: logger,
    error(where, text) { errors.push({ where, text }); return Promise.reject(new Error("error route refused")); },
  });
  const report = createViewErrorReporter(bridge.runtime);
  const lines = [];
  const originalError = console.error;
  console.error = (line) => lines.push(line);
  try {
    assert.equal(report("view terminal: page failed"), undefined, "reporting does not depend on a logger promise");
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(errors, [{ where: "view", text: "view terminal: page failed" }]);
  assert.deepEqual(lines, ["runtime.error view error route refused"]);
});
