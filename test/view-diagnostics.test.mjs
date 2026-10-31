import assert from "node:assert/strict";
import test from "node:test";

import { attach } from "../build/test/ui/terminal-diagnostics.js";
import { loadDiagnostics, startViewDocumentFrames } from "../build/test/ui/view-diagnostics.js";
import { createViewPage } from "./view-host.mjs";
import { mountPage } from "../build/test/ui/terminal-view.js";

function fixture() {
  const commands = new Map();
  const statuses = new Map();
  const records = [];
  const exposed = {
    async command(name, handler) { commands.set(name, handler); },
    async status(name, read, watch) { statuses.set(name, { read, watch }); },
  };
  return { commands, statuses, records, exposed };
}

test("a release view has no diagnostic declaration in its start values and requests no file", { timeout: 5000 }, async () => {
  const fetched = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url) => { requests.push(String(url)); return { ok: false, status: 404 }; };
    assert.equal(await loadDiagnostics({ surface: "terminal-1", diagnostics: null }), null);
  } finally {
    globalThis.fetch = fetched;
  }
  assert.deepEqual(requests, []);
});

test("a diagnostic view loads the declaration of its start values and its attach function", { timeout: 5000 }, async () => {
  const declaration = { module: "ui/terminal-diagnostics.js", exposes: {} };
  const loaded = await loadDiagnostics({ surface: "terminal-1", diagnostics: declaration });
  assert.deepEqual(loaded.declaration, declaration);
  assert.equal(loaded.attach, attach);
});

test("start values without a diagnostic declaration are refused with an error that names them", { timeout: 5000 }, async () => {
  await assert.rejects(loadDiagnostics({ surface: "terminal-1" }),
    /^Error: the start values of the terminal view have no diagnostics: window\.sokSurface \{surface, params, origin, project, declarations, diagnostics\} carries it$/);
});

test("view frame start anchors the clock of the observed view document", { timeout: 5000 }, () => {
  const order = [];
  let nowMs = 12.5;
  const viewWindow = {
    document: {},
    performance: {
      timeOrigin: 1234,
      now() { order.push("now"); return nowMs; },
    },
    ResizeObserver: function ResizeObserver() {},
    requestAnimationFrame(callback) { return callback; },
    cancelAnimationFrame() {},
  };
  let observed;
  const stop = () => {};
  const started = startViewDocumentFrames({
    viewWindow,
    log: {},
    observe(options) { order.push("observe"); observed = options; return stop; },
  });

  assert.equal(started.stop, stop);
  assert.equal(typeof started.readSourceClock, "function");
  assert.deepEqual(started.sourceClock,
    { documentTimeOriginMs: 1234, sourceNowMs: 12.5, sourceResolutionMs: 1 });
  assert.deepEqual(order, ["now", "observe"]);
  assert.equal(observed.document, viewWindow.document);
  assert.equal(observed.timeOriginMs, viewWindow.performance.timeOrigin);
  nowMs = 16.75;
  assert.deepEqual(started.readSourceClock(), {
    documentTimeOriginMs: 1234, sourceNowMs: 16.75, sourceResolutionMs: 1,
  });
});

async function attachViewDiagnostics(f, options = {}) {
  await attach({
    expose: f.exposed,
    updateCompose: async () => null,
    onInput: () => () => {},
    onPointer: () => () => {},
    readPtyPending: async () => ({ pending: 0, written: 0 }),
    alterNextScreen() {},
    reportError(error) { f.records.push({ kind: "error", error }); },
    resolveError() {},
    ...options,
  });
}

test("terminal view history diagnostics reads the live document history length", { timeout: 5000 }, async () => {
  const f = fixture();
  let length = 1;
  await attachViewDiagnostics(f, { readViewHistory: () => length });
  const read = f.commands.get("terminal.view.history");
  assert.equal(typeof read, "function", "the terminal view history command is registered");
  assert.deepEqual(await read({}), { length: 1 });
  length = 3;
  assert.deepEqual(await read({}), { length: 3 }, "the command reads current document history instead of a saved snapshot");
  length = 0;
  await assert.rejects(read({}), /terminal view document history length is invalid: 0/);
});

test("terminal view content-frame diagnostics start and stop the source observer on request", { timeout: 5000 }, async () => {
  const f = fixture();
  const output = [];
  let starts = 0;
  let stops = 0;
  let sourceNowMs = 8.25;
  const readSourceClock = () => ({ documentTimeOriginMs: 1000, sourceNowMs, sourceResolutionMs: 1 });
  await attachViewDiagnostics(f, {
    readViewHistory: () => 1,
    startViewFrames({ log }) {
      starts += 1;
      log.trace("view.content_frame", {
        sequence: 0,
        width: 320,
        height: 200,
        documentTimeOriginMs: 100,
        firstResizeAtMs: 8,
        resizeAtMs: 10,
        resizeCount: 2,
        frameTimeMs: 16,
      });
      return { stop: () => { stops += 1; }, sourceClock: readSourceClock(), readSourceClock };
    },
    viewLog: { trace: (event, fields) => output.push({ event, fields }) },
  });
  const measure = f.commands.get("terminal.view.frames");
  assert.equal(typeof measure, "function", "the terminal view frame command is registered");
  assert.deepEqual(await measure({ action: "stop" }), { enabled: false });
  assert.equal(starts, 0, "view-frame observation is disabled by default");
  assert.deepEqual(await measure({ action: "start" }), { enabled: true, sourceClock: readSourceClock() });
  sourceNowMs = 12.5;
  assert.deepEqual(await measure({ action: "start" }), { enabled: true, sourceClock: readSourceClock() });
  assert.equal(starts, 1, "starting an active observer is idempotent");
  assert.deepEqual(output, [{
    event: "view.content_frame",
    fields: { sequence: 0, width: 320, height: 200, documentTimeOriginMs: 100,
      firstResizeAtMs: 8, resizeAtMs: 10, resizeCount: 2, frameTimeMs: 16 },
  }]);
  assert.deepEqual(await measure({ action: "stop" }), { enabled: false });
  assert.deepEqual(await measure({ action: "stop" }), { enabled: false });
  assert.equal(stops, 1, "stopping an observer more than once does not stop it twice");
});

test("terminal view content-frame diagnostics reject invalid resize timing and counts", { timeout: 5000 }, async () => {
  for (const [name, values] of [
    ["first resize after latest resize", { firstResizeAtMs: 11, resizeAtMs: 10, resizeCount: 2, frameTimeMs: 16 }],
    ["latest resize after frame", { firstResizeAtMs: 8, resizeAtMs: 17, resizeCount: 2, frameTimeMs: 16 }],
    ["single resize with different first and latest times", { firstResizeAtMs: 8, resizeAtMs: 10, resizeCount: 1, frameTimeMs: 16 }],
    ["missing first resize", { resizeAtMs: 10, resizeCount: 2, frameTimeMs: 16 }],
    ["zero resize count", { firstResizeAtMs: 8, resizeAtMs: 10, resizeCount: 0, frameTimeMs: 16 }],
    ["fractional resize count", { firstResizeAtMs: 8, resizeAtMs: 10, resizeCount: 1.5, frameTimeMs: 16 }],
  ]) {
    const f = fixture();
    await attachViewDiagnostics(f, {
      readViewHistory: () => 1,
      startViewFrames({ log }) {
        log.trace("view.content_frame", {
          sequence: 0, width: 320, height: 200, documentTimeOriginMs: 100, ...values,
        });
        return () => {};
      },
      viewLog: { trace() {} },
    });
    await assert.rejects(f.commands.get("terminal.view.frames")({ action: "start" }),
      /terminal view content-frame resize timing is invalid/, name);
  }
});

test("terminal view frame diagnostics reject invalid actions and incomplete source adapters", { timeout: 5000 }, async () => {
  const f = fixture();
  await attachViewDiagnostics(f, { readViewHistory: () => 1, startViewFrames: () => () => {} });
  const measure = f.commands.get("terminal.view.frames");
  await assert.rejects(measure({ action: "pause" }), /terminal.view.frames action must be start or stop/);

  const missingAdapter = fixture();
  await attachViewDiagnostics(missingAdapter, { readViewHistory: () => 1 });
  await assert.rejects(missingAdapter.commands.get("terminal.view.frames")({ action: "start" }),
    /view frame observation adapter is unavailable/);
});

test("closing the terminal view stops an explicitly started content-frame observer", { timeout: 5000 }, async () => {
  const f = fixture();
  const closing = new AbortController();
  let stops = 0;
  await attachViewDiagnostics(f, {
    readViewHistory: () => 1,
    startViewFrames: () => ({
      stop: () => { stops += 1; },
      sourceClock: { documentTimeOriginMs: 1000, sourceNowMs: 8.25, sourceResolutionMs: 1 },
      readSourceClock: () => ({ documentTimeOriginMs: 1000, sourceNowMs: 8.25, sourceResolutionMs: 1 }),
    }),
    viewLog: { trace() {} },
    closing: closing.signal,
  });
  assert.deepEqual(await f.commands.get("terminal.view.frames")({ action: "start" }), {
    enabled: true,
    sourceClock: { documentTimeOriginMs: 1000, sourceNowMs: 8.25, sourceResolutionMs: 1 },
  });
  closing.abort();
  assert.equal(stops, 1);
  assert.deepEqual(await f.statuses.get("terminal.view.frames").read(), { enabled: false });
});

test("the mounted terminal view reads its live history and emits source content-frame events only when requested",
  { timeout: 5000 }, async (t) => {
  const host = createViewPage(t, "view-frame-diagnostics");
  await mountPage(host.context, host.report, host.window.document);
  await host.settle();
  const history = (params = {}) => host.exposureRequest(9001, "command.run", {
    name: "terminal.view.history", params,
  });
  const frames = (action) => host.exposureRequest(9001, "command.run", {
    name: "terminal.view.frames", params: { action },
  });

  const initialLength = host.window.history.length;
  assert.deepEqual(await history(), { length: initialLength });
  host.window.history.pushState({}, "", "#second");
  assert.deepEqual(await history(), { length: host.window.history.length });
  assert.deepEqual(await host.statuses.get("terminal.view.frames").read(), { enabled: false });
  const sourceNowBefore = host.window.performance.now();
  const startedFrames = await frames("start");
  const sourceNowAfter = host.window.performance.now();
  assert.equal(startedFrames.enabled, true);
  assert.equal(startedFrames.sourceClock.documentTimeOriginMs, host.window.performance.timeOrigin);
  assert.equal(startedFrames.sourceClock.sourceResolutionMs, 1);
  assert.ok(startedFrames.sourceClock.sourceNowMs >= sourceNowBefore
    && startedFrames.sourceClock.sourceNowMs <= sourceNowAfter,
  `sourceNowMs ${startedFrames.sourceClock.sourceNowMs} is outside the view-clock observation interval`);
  assert.equal(host.frameObserver.starts, 1);
  assert.equal(host.logs.filter(({ event }) => event === "plugin.terminal.view.content_frame").length, 1);
  assert.deepEqual(await host.statuses.get("terminal.view.frames").read(), { enabled: true });
  assert.deepEqual(await frames("stop"), { enabled: false });
  assert.equal(host.frameObserver.stops, 1);
  assert.deepEqual(await host.statuses.get("terminal.view.frames").read(), { enabled: false });
  assert.equal(host.logs.filter(({ event }) => event === "plugin.terminal.view.content_frame").length, 1,
    "stopping observation produces no later frame record");
});
