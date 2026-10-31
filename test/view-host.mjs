// Plugin-side view fixture: a literal start context and local host capabilities; core bridge behavior stays in core tests.
import { readFileSync } from "node:fs";
import { createWindow, useWindow } from "./dom.mjs";
import * as terminalDiagnostics from "../build/test/ui/terminal-diagnostics.js";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const diagnosticManifest = JSON.parse(readFileSync(new URL("../diagnostics.json", import.meta.url), "utf8"));
const SIDECAR = Object.keys(manifest.dependencies)[0];

export const START = Object.freeze({
  surface: "terminal-1",
  params: null,
  origin: Object.freeze({ directory: null }),
  project: null,
  declarations: Object.freeze(manifest.exposes),
  diagnostics: null,
});

const settingsValues = () => ({
  ...Object.fromEntries(Object.entries(manifest.settings).map(([key, { default: value }]) => [key, value])),
  shell: "/bin/sh",
});

function fakeSidecar(openError = null) {
  const listeners = new Map();
  const sent = [];
  return {
    sent,
    trigger(id, body) { for (const fn of listeners.get(id) ?? []) fn(body); },
    async on(id, fn) {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(fn);
      return () => listeners.get(id)?.delete(fn);
    },
    async onFailure() { return () => {}; },
    async send(id, body, cids) {
      sent.push({ id, body, cids });
      if (body.operation === "open" && openError !== null) throw new Error(openError);
      if (body.operation === "screen.read") return { rows: [] };
      return null;
    },
  };
}

function fakeRegion() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    async focus() {},
    async setCaret() {},
    trigger(event, value) { for (const fn of listeners.get(event) ?? []) fn(value); },
  };
}

const settle = (rounds = 6) => {
  let done = Promise.resolve();
  for (let i = 0; i < rounds; i += 1) done = done.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return done;
};

export function createViewPage(_t, caseId, { scheme = "dark", start = START, diagnostic = true, openError = null, bindError = null } = {}) {
  const { window } = createWindow("sok://terminal/ui/terminal.html?case=" + caseId);
  useWindow(window);
  window.sokSurface = start;
  window.ResizeObserver = class FakeResizeObserver { constructor(callback) { this.callback = callback; } observe() {} unobserve() {} disconnect() {} };
  window.visualViewport = { width: 640, height: 400, addEventListener() {}, removeEventListener() {} };
  const sidecar = fakeSidecar(openError);
  const registrations = [];
  const commands = new Set();
  const commandHandlers = new Map();
  const statuses = new Map();
  const doms = new Map();
  const regionCalls = [];
  const places = [];
  const reports = [];
  const logs = [];
  const received = [];
  const commandRuns = [];
  const bindings = [];
  const releaseBindings = [];
  const frameObserver = { starts: 0, stops: 0 };

  const exposure = {
    async status(name, read, watch) { registrations.push({ kind: "status", name }); statuses.set(name, { read, watch }); },
    async command(name, handler) { commands.add(name); commandHandlers.set(name, handler); },
    async dom(name, element) { registrations.push({ kind: "dom", name }); doms.set(name, element); },
    async run(name, params = {}) {
      commandRuns.push({ name, params });
      const handler = commandHandlers.get(name);
      if (!handler) throw new Error("terminal command is not registered: " + name);
      return handler(params);
    },
    async mark(element, name) { element.dataset.command = name; return element; },
    async bind(element, name, params, options) {
      if (bindError) throw bindError;
      if (!commandHandlers.has(name)) throw new Error("binding command is not registered: " + name);
      bindings.push({ element, name, params, options });
      element.dataset.command = name;
      const listener = (event) => {
        if (options.when && !options.when(event)) return;
        Promise.resolve(exposure.run(name, params)).catch((error) => {
          if (!options.failed) throw error;
          options.failed(error);
        });
      };
      element.addEventListener(options.event, listener);
      releaseBindings.push(() => element.removeEventListener(options.event, listener));
      return element;
    },
    async dispose() { for (const release of releaseBindings.splice(0)) release(); },
    getCommand: (name) => commandHandlers.get(name),
    getStatus: (name) => statuses.get(name),
    getDom: (name) => doms.get(name),
  };

  const region = fakeRegion();
  region.focus = async () => {
    regionCalls.push(["image.focus", { name: "view" }]);
    region.trigger("focus", { focused: true });
  };
  const context = {
    surfaceId: start.surface,
    closing: new AbortController().signal,
    composition: {
      async create(elements) {
        const attachment = { name: "view", sidecar: manifest.surface.composition.regions[0].sidecar };
        regionCalls.push(["image.attach", attachment]);
        received.push({ command: "image.attach", params: attachment });
        places.push({ regions: Object.keys(elements.regions).map((name) => ({ name })), overlays: Object.keys(elements.overlays) });
        return {
          region(name) { if (name !== "view") throw new Error("unknown terminal image region: " + name); return region; },
          async dispose() {
            const params = { name: "view" };
            regionCalls.push(["image.detach", params]);
            received.push({ command: "image.detach", params });
          },
        };
      },
    },
    exposure,
    status: { report: (phase, error) => reports.push(["status", phase, error]) },
    diagnostics: diagnostic ? {
      declaration: diagnosticManifest,
      attach: terminalDiagnostics.attach,
      startViewFrames({ log }) {
        frameObserver.starts += 1;
        log.trace("view.content_frame", {
          sequence: 0, width: 640, height: 400, documentTimeOriginMs: 100,
          firstResizeAtMs: 10, resizeAtMs: 10, resizeCount: 1, frameTimeMs: 16,
        });
        const readSourceClock = () => ({
          documentTimeOriginMs: window.performance.timeOrigin,
          sourceNowMs: window.performance.now(),
          sourceResolutionMs: 1,
        });
        return {
          stop: () => { frameObserver.stops += 1; },
          sourceClock: readSourceClock(),
          readSourceClock,
        };
      },
    } : null,
    tab: Object.fromEntries(["title", "footer", "directory", "notify"].map((name) => [name, (...args) => reports.push([name, ...args])])),
    origin: start.origin,
    project: start.project,
    runtime: {
      // The page names its sidecar, which plugin.json lists as its only dependency.
      sidecar: (name) => {
        if (name !== SIDECAR) throw new Error(`runtime.sidecar requires the declared sidecar ${SIDECAR}, got ${String(name)}`);
        return {
          send: async (id, body, cids) => {
            const params = { id, sidecar: name, body, cids };
            received.push({ command: "runtime.sidecar.send", params });
            return sidecar.send(id, body, cids);
          },
          on: (id, fn) => sidecar.on(id, fn),
          onFailure: (id, fn) => sidecar.onFailure(id, fn),
        };
      },
      theme: (listener) => {
        const value = { scheme, tokens: { "--card": "#ffffff", "--fg": "#252735", "--edge": "#d8dbe4", "--rail": "#5962e8" } };
        return { ready: Promise.resolve().then(() => listener(value)), dispose() {} };
      },
      settings: { read: settingsValues, on: () => () => {} },
      textSize: { read: () => 1, on: () => () => {} },
      links: { open: async (url) => reports.push(["runtime.links.open", url]) },
      clipboard: { read: async () => null, writeText: async () => {} },
      log: Object.fromEntries(["error", "warn", "info", "debug", "trace"].map((level) => [level,
        (event, fields) => logs.push({ event: "plugin.terminal." + event, fields: typeof fields === "function" ? fields() : fields })])),
    },
  };
  const report = (text) => logs.push({ event: "plugin.terminal.report", fields: { text } });
  const exposureRequest = async (_id, method, params) => {
    if (method !== "command.run") throw new Error("unsupported test exposure method: " + method);
    const handler = commandHandlers.get(params.name);
    if (!handler) throw new Error("terminal command is not registered: " + params.name);
    return (await handler(params.params)) ?? null;
  };
  return { window, context, report, sidecar, region, registrations, commands, regionCalls, places, reports, logs, received,
    statuses, commandRuns, bindings, frameObserver, exposureRequest, settle };
}
