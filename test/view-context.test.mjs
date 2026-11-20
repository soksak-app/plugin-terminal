import assert from "node:assert/strict";
import test from "node:test";
import { createViewContext, createViewErrorReporter } from "../ui/view-context.js";

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
    exposure: { register() {}, reply() {}, changed() {} },
  };
  return { bridge, requests };
}

function contextFor(bridge) {
  return createViewContext({
    bridge,
    closing: new AbortController().signal,
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

test("the view context follows a status through the status watch of the bridge runtime", { timeout: 5000 }, () => {
  const { bridge } = bridgeWith({ log: {}, error: () => Promise.resolve() });
  const status = { watch() {} };
  bridge.runtime.status = status;
  const { context } = contextFor(bridge);

  // The page follows core.grid for the title of the sender of a message (core docs/spec/messaging.md#injected-message).
  assert.equal(context.runtime.status, status, "the page status watch is the status watch of the view runtime");
});

test("the view context uses the clipboard of the bridge runtime instead of a copy of it (P142.4)", { timeout: 5000 }, () => {
  const logger = Object.fromEntries(["error", "warn", "info", "debug", "trace"].map((level) => [level, () => {}]));
  const clipboard = { read() {}, writeText() {}, persistPNG() {} };
  const { bridge, requests } = bridgeWith({ log: logger, error: () => Promise.resolve() });
  bridge.runtime.clipboard = clipboard;
  const { context } = contextFor(bridge);

  assert.equal(context.runtime.clipboard, clipboard, "the page clipboard is the clipboard of the view runtime");
  assert.deepEqual(requests, [], "the context makes no clipboard call of its own");
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
  // The refused error route writes the line of the console, which is the last event of the report.
  const logged = Promise.withResolvers();
  console.error = (line) => { lines.push(line); logged.resolve(); };
  try {
    assert.equal(report("view terminal: page failed"), undefined, "reporting does not depend on a logger promise");
    await logged.promise;
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(errors, [{ where: "view", text: "view terminal: page failed" }]);
  assert.deepEqual(lines, ["runtime.error view error route refused"]);
});

test("the view context runs a core command on a surface with the view call runtime.command.run", async () => {
  const { bridge, requests } = bridgeWith({ log() {}, error: () => Promise.resolve() });
  const { context } = contextFor(bridge);
  await context.runtime.command.run("core.tab.role.confirm", { fingerprint: "33796c71bac2615d" }, "terminal-1");
  assert.deepEqual(requests, [{ command: "runtime.command.run", params: {
    name: "core.tab.role.confirm", params: { fingerprint: "33796c71bac2615d" }, surface: "terminal-1" } }]);
});
