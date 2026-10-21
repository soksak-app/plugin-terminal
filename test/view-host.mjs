// The host side of the view channel for the tests of the view page: it installs the view channel of the core wire in a
// fresh window, serves the call route of a view (core docs/spec/native-surfaces.md#view-surfaces, view calls, in the forms
// that core main serves), and delivers the messages of the sidecar. The page imports with a distinct query per case, so
// each case mounts a fresh page into its own window.
import { createWindow, useWindow } from "./dom.mjs";

const read = async (url) => JSON.parse(await (await import("node:fs/promises")).readFile(new URL(url, import.meta.url), "utf8"));
const manifest = await read("../plugin.json");
// The declaration of the diagnostic entries, which a diagnostic build adds to the surface declaration of the plugin.
const diagnosticManifest = await read("../diagnostics.json");

// The view channel of the core wire (docs/spec/native-surfaces.md#view-surfaces): the global window.sokView, the ready
// message {event: "view.ready", plugin, document} through the sok-view handler, and the queue of the host messages until
// the page attaches its listener. A message without the marker sok: 1 is answered with view.error. This is a literal fake
// of the wire; it reads no file of @soksak/plugin-api.
function installViewChannel(window, handler) {
  const plugin = window.location.host;
  const queue = [];
  let listener = null;
  window.addEventListener("message", (event) => {
    if (event.data?.sok !== 1) {
      handler.postMessage({ event: "view.error", plugin, reason: `message without the sok marker for ${plugin}` });
      return;
    }
    if (listener) listener(event.data);
    else queue.push(event.data);
  });
  handler.postMessage({ event: "view.ready", plugin, document: "document-1" });
  window.sokView = Object.freeze({
    attach(next) {
      if (listener) throw new Error(`view channel for ${plugin} already has a message listener`);
      listener = next;
      while (queue.length > 0) next(queue.shift());
    },
  });
}

const settle = (rounds = 6) => {
  let done = Promise.resolve();
  for (let i = 0; i < rounds; i += 1) done = done.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return done;
};

// A VT sidecar of one surface: the sends carry the surface id that the page named, and each event travels to the
// listeners of that id, as the sidecar messages of a session do.
function fakeSidecar(openError = null) {
  const listeners = new Map();
  const sent = [];
  return {
    sent,
    trigger(id, body) {
      for (const fn of listeners.get(id) ?? []) fn(body);
    },
    on: async (id, fn) => {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(fn);
      return () => listeners.get(id)?.delete(fn);
    },
    onFailure: async () => () => {},
    async send(id, body, cids) {
      sent.push({ id, body, cids });
      if (body.operation === "open") {
        if (openError !== null) throw new Error(openError);
        return null;
      }
      if (body.operation === "screen.read") return { rows: [] };
      return null;
    },
  };
}

// The start values in the form that the host injects (core docs/spec/native-surfaces.md#view-surfaces, start values): the
// host freezes the origin and the project, and the declarations are the exposes of the plugin.
export const START = Object.freeze({
  surface: "terminal-1",
  params: null,
  origin: Object.freeze({ directory: null }),
  project: null,
  declarations: Object.freeze(manifest.exposes),
});

// The composition that the view page creates: the declared image region and the five overlays (plugin.json).
export const DECLARATION = Object.freeze({
  kind: manifest.surface.composition.kind,
  regions: manifest.surface.composition.regions,
  overlays: manifest.surface.composition.overlays,
});

/**
 * Creates one window with the view page of one case mounted: the start values, the injected view-start script, the host
 * side of the sok-view channel, and the theme. The globals of the test process serve the window. The fetch of the page is
 * the fake of the core file route: it serves diagnostics.json of the repository, and answers not found for any other file,
 * as a build without a diagnostic declaration does.
 *
 * Returns { window, sidecar, registrations, commands, regionCalls, places, reports, logs, post, exposureRequest, settle }.
 */
export function createViewPage(t, caseId, { scheme = "dark", start = START, diagnostic = true, openError = null } = {}) {
  const { window } = createWindow(`sok://terminal/ui/terminal.html?case=${caseId}`);
  useWindow(window);
  // The composition controller of the view observes its elements (core docs/spec/native-surfaces.md#view-surfaces, regions).
  const observers = [];
  window.ResizeObserver = class FakeResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observers.push(this); }
    unobserve() {}
    disconnect() {}
  };
  window.visualViewport = { width: 640, height: 400, addEventListener() {}, removeEventListener() {} };
  const sidecar = fakeSidecar(openError);
  const registrations = [];
  const commands = [];
  const regionCalls = [];
  const places = [];
  const reports = [];
  const logs = [];
  const subscriptions = new Set();
  const requests = new Map();
  const received = [];
  const pending = new Map();
  const post = (message) => window.dispatchEvent(new window.MessageEvent("message", { source: window, origin: "", data: message }));
  const handler = { postMessage: (message) => { const wire = JSON.parse(JSON.stringify(message)); received.push(wire); deliver(wire); } };
  window.webkit = { messageHandlers: { "sok-view": handler } };

  const reply = (id, payload) => post({ sok: 1, id, ...payload });
  const deliver = (message) => {
    if (message?.event !== undefined) return;
    if (message?.reply !== undefined) {
      const request = pending.get(message.reply);
      if (!request) throw new Error(`the page replied to unknown host request ${message.reply}`);
      pending.delete(message.reply);
      if (message.error !== undefined) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    if (Number.isInteger(message?.id) && typeof message?.command === "string") {
      serve(message.id, message.command, message.params);
      return;
    }
    throw new Error(`the page sent an unexpected message ${JSON.stringify(message)}`);
  };
  const serve = (id, command, params) => {
    Promise.resolve().then(async () => {
      switch (command) {
        case "runtime.log":
          if (params === null || typeof params !== "object") throw new TypeError("view call runtime.log params must be an object");
          if (!["error", "warn", "info", "debug", "trace"].includes(params.level)) {
            throw new TypeError("view call runtime.log log level must be one of error, warn, info, debug, trace");
          }
          logs.push(params);
          return null;
        case "runtime.sidecar.send":
          return sidecar.send(params.id, params.body, params.cids ?? []);
        case "runtime.sidecar.on":
          await sidecar.on(params.id, (body) => post({ sok: 1, event: "sidecar.message", data: { id: params.id, body } }));
          return null;
        case "runtime.sidecar.onFailure":
          await sidecar.onFailure(params.id, (reason) => post({ sok: 1, event: "sidecar.failure", data: { id: params.id, reason } }));
          return null;
        case "runtime.native.on":
          subscriptions.add(params.name);
          return null;
        case "runtime.command.register": {
          // A diagnostic build adds the entries of diagnostics.json to the surface declaration of the plugin.
          const declared = [...(start.declarations.commands ?? []), ...(diagnostic ? diagnosticManifest.exposes.commands : [])]
            .some((entry) => entry.name === params.name);
          if (!declared) throw new Error(`command ${params.name} is not declared`);
          commands.push(params.name);
          return null;
        }
        case "runtime.native.call": {
          const { name, payload } = params;
          if (name === "registered") {
            const group = { status: "status", dom: "dom" }[payload.kind];
            const declared = [...((group !== undefined ? start.declarations[group] : undefined) ?? []),
              ...((diagnostic && group !== undefined ? diagnosticManifest.exposes[group] : undefined) ?? [])]
              .some((entry) => entry.name === payload.name);
            if (!declared) throw new Error(`${payload.kind} ${payload.name} is not declared`);
            registrations.push(payload);
            return null;
          }
          if (name === "exposureReply") {
            const request = requests.get(payload.id);
            if (!request) throw new Error(`exposure reply ${payload.id} has no matching request`);
            requests.delete(payload.id);
            if (payload.error !== undefined) request.reject(new Error(payload.error.message));
            else request.resolve(payload.result);
            return null;
          }
          throw new Error(`the page called the native ${name}`);
        }
        case "runtime.textSize.read": return 1;
        case "runtime.textSize.on": return null;
        case "runtime.settings.read":
          return { ...Object.fromEntries(Object.entries(manifest.settings).map(([key, { default: value }]) => [key, value])), shell: "/bin/sh" };
        case "runtime.settings.on": return null;
        case "runtime.links.open":
          reports.push(["runtime.links.open", params]);
          return null;
        case "runtime.clipboard.read": return null;
        case "runtime.clipboard.writeText": return null;
        case "tab.title":
        case "tab.footer":
        case "tab.directory":
          reports.push([command, params]);
          return null;
        case "tab.error":
          reports.push([command, params]);
          return null;
        case "tab.notify":
          reports.push([command, params]);
          return null;
        case "composition.declaration": return JSON.parse(JSON.stringify(DECLARATION));
        case "composition.place":
          places.push(params);
          return null;
        case "composition.report":
          reports.push(["composition.report", params]);
          return null;
        case "image.attach":
        case "image.focus":
        case "image.caret":
        case "image.text":
        case "image.detach":
          regionCalls.push([command, params]);
          return null;
        default:
          throw new Error(`the page called ${command}, which is served by no route of the test host`);
      }
    }).then((result) => reply(id, { result: result ?? null }), (error) => reply(id, { error: { code: -32000, message: String(error?.message ?? error) } }));
  };
  // The forwarded request of the exposure (core docs/spec/exposure.md#relay): the page answers through the call
  // exposureReply, which the host resolves as the answer of the request.
  const exposureRequest = (id, method, params) => new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    post({ sok: 1, event: "exposure-request", data: { id, surface: start.surface, method, params } });
  });

  // The file route of the view: diagnostics.json of the plugin in a diagnostic build, and no other file, as a build
  // without a diagnostic declaration serves none.
  globalThis.fetch = async (url) => {
    if (diagnostic && String(url).endsWith("diagnostics.json")) {
      const text = await (await import("node:fs/promises")).readFile(new URL("../diagnostics.json", import.meta.url), "utf8");
      return { ok: true, json: async () => JSON.parse(text) };
    }
    return { ok: false, json: async () => { throw new Error("not found"); } };
  };
  t.after(() => { delete globalThis.fetch; });

  window.sokSurface = start;
  installViewChannel(window, handler);
  // The theme script of the view ran before the page, and the host sends the current theme after the ready message; the
  // test posts it before the page attaches, so it arrives through the queue of the injected script (the first messages).
  post({ sok: 1, event: "theme", data: { scheme, tokens: { "--card": "#ffffff", "--fg": "#252735", "--edge": "#d8dbe4", "--rail": "#5962e8" } } });

  return { window, sidecar, registrations, commands, regionCalls, places, reports, logs, subscriptions, received, post, exposureRequest, settle };
}
