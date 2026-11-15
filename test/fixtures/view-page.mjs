// The view page of the terminal for the plugin tests. The page is the real ui/view.js, which the test process loads into a jsdom
// window. The page imports @soksak/plugin-api through the fixtures of test/fixtures/plugin-api/, so each call that it makes on the
// plugin API is recorded there and answered as the test arranges. This module arranges the answers that a running view gives (the
// start values, the settings, the sidecar answers, the composition and its region) and gives the tests the records of those calls.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { arrangeBridges } from "./plugin-api/view.mjs";
import { exposures } from "./plugin-api/index.mjs";
import { observeViewDocumentFrames } from "./plugin-api/diagnostic-view-frames.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../plugin.json", import.meta.url), "utf8"));
const diagnostics = JSON.parse(readFileSync(new URL("../../diagnostics.json", import.meta.url), "utf8"));

/** The page module of the terminal view, which the application serves as ui/terminal.html. */
export const PAGE = new URL("../../ui/view.js", import.meta.url);
/** The surface of the views of these tests. */
export const SURFACE = "terminal-1";
/** The exposure declarations of the plugin. */
export const DECLARATIONS = manifest.exposes;
const DIAGNOSTIC_DECLARATIONS = {
  status: [...manifest.exposes.status, ...diagnostics.exposes.status],
  commands: [...manifest.exposes.commands, ...diagnostics.exposes.commands],
  element: manifest.exposes.element,
};

/** The log levels of the page: each category writes its records at trace. */
const LOG_LEVELS = { lifecycle: "trace", input: "trace", call: "trace", io: "trace", frame: "trace" };
/** The theme of the window: the card tokens of the plugin's page, which the session receives as its colors. */
const THEME = { scheme: "dark", tokens: { "--card": "#ffffff", "--fg": "#252735", "--edge": "#d8dbe4", "--rail": "#5962e8" } };

/** The settings of the plugin with their defaults, and the shell of the session. */
const settingsValues = () => ({
  ...Object.fromEntries(Object.entries(manifest.settings).map(([key, { default: value }]) => [key, value])),
  shell: "/bin/sh",
});

/**
 * The globals of Node that the page keeps: the window does not replace them. Each other own property of the window becomes a global
 * while the view is open, so the page modules read the DOM of the window as they do in the view. The performance of the window stays
 * a Node global, because the Performance of jsdom recurses when it is installed as the global of a process.
 */
const NODE_GLOBALS = new Set(["console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate",
  "queueMicrotask", "structuredClone", "performance", "crypto", "fetch", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController",
  "AbortSignal", "Blob", "File", "FormData", "Headers", "Request", "Response", "WebSocket", "process", "Buffer", "global", "globalThis"]);

/** The one view that is open in this process, and the number of page loads (a module evaluates once per URL). */
let open = false;
let pageLoads = 0;

/** Installs the own properties of the window as globals and returns the restore function of the previous globals. */
function installGlobals(window) {
  const previous = new Map();
  // The members of the prototypes of the window (addEventListener, for one) fill the names that no global of Node has, so a bare
  // call of them in a page module reaches the window.
  const inherited = [];
  for (let proto = Object.getPrototypeOf(window); proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name !== "constructor" && typeof Object.getOwnPropertyDescriptor(proto, name).value === "function" && !inherited.includes(name)) inherited.push(name);
    }
  }
  for (const name of inherited) {
    if (name in globalThis) continue;
    previous.set(name, undefined);
    Object.defineProperty(globalThis, name, { value: window[name].bind(window), configurable: true, writable: true });
  }
  for (const name of Object.getOwnPropertyNames(window)) {
    if (NODE_GLOBALS.has(name)) continue;
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    if (before !== undefined && before.configurable === false) continue;
    const own = Object.getOwnPropertyDescriptor(window, name);
    previous.set(name, before);
    // An accessor of the window stays an accessor: reading it here would run it, and the storage accessors throw for the opaque
    // origin of a view. A method of the window is bound to it, so a page calls addEventListener as a bare name, as the view does.
    if (own.get !== undefined) {
      Object.defineProperty(globalThis, name, { get: () => window[name], configurable: true, enumerable: false });
      continue;
    }
    const value = own.value;
    const bound = typeof value === "function" && /^[a-z]/.test(name) ? value.bind(window) : value;
    Object.defineProperty(globalThis, name, { value: bound, configurable: true, writable: true, enumerable: false });
  }
  return () => {
    for (const [name, before] of previous) {
      if (before === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, before);
    }
  };
}

/**
 * Opens the terminal view and loads its page. Options:
 *
 *     diagnostic    whether the build is a diagnostic build (the start values carry the diagnostic declaration)
 *     sidecar       function(body, {id}) that answers each runtime.sidecar.send: its return value is the result, a throw is the error
 *     region        the answers of the region of the composition: {focus, setCaret}; a function of the arguments, its value is the answer
 *     create        function(elements, view) that runs at each composition.create before it answers, as the host delivers the input
 *                   in the answer of the creation
 *     arrange       function(bridge) that the test runs after the standard answers, to arrange or replace any answer
 *
 * The view is closed when the test ends. Returns the view: window, bridge (its rec.calls are the calls of the page on the plugin
 * API, in order), exposure (the exposure the page created: run, read), composition (the input handler and the region listeners),
 * events (the records of runtime.log), settled(), push(key, arg, ...args), close().
 */
export async function openTerminal(t, { diagnostic = true, sidecar = () => null, region = {}, create, arrange } = {}) {
  if (open) throw new Error("a view is already open in this test process; close it before opening another");
  open = true;
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "soksak://terminal/ui/terminal.html", pretendToBeVisual: true });
  const window = dom.window;
  window.ResizeObserver = class ResizeObserver { observe() {} unobserve() {} disconnect() {} };
  const restoreGlobals = installGlobals(window);
  const declarations = diagnostic ? DIAGNOSTIC_DECLARATIONS : DECLARATIONS;
  window.sokSurface = { surface: SURFACE, params: null, origin: { directory: null }, project: null, declarations,
    diagnostics: diagnostic ? diagnostics : null };
  window.sokTheme = THEME;
  window.webkit = { messageHandlers: { "sok-view": { postMessage() { throw new Error("the plugin API fixture owns the sok-view channel"); } } } };

  let inFlight = 0;
  const idle = [];
  const track = (value) => {
    if (typeof value?.then !== "function") return value;
    inFlight += 1;
    const finish = () => {
      inFlight -= 1;
      if (inFlight === 0) for (const resolve of idle.splice(0)) resolve();
    };
    value.then(finish, finish);
    return value;
  };
  const view = {
    window,
    bridge: null,
    composition: { input: null, listeners: {} },
    events: [],
    settled,
    push: (key, arg, ...args) => view.bridge.push(key, arg, ...args),
    close,
  };
  const closing = { done: false };

  arrangeBridges((bridge) => {
    view.bridge = bridge;
    const { rec } = bridge;
    rec.arrange("runtime.textSize.read", 1);
    rec.arrange("runtime.settings.read", settingsValues());
    rec.arrange("runtime.log.levels", () => LOG_LEVELS);
    for (const level of ["debug", "info", "warn", "error", "trace"]) {
      rec.arrange(`runtime.log.${level}`, (event, fields, options) => {
        view.events.push({ level, event, fields: typeof fields === "function" ? fields() : fields, cids: options?.cids });
      });
    }
    rec.arrange("runtime.clipboard.read", () => null);
    rec.arrange("calls.request", (command, params) => track(Promise.resolve().then(() => {
      if (command === "runtime.sidecar.send") return sidecar(params.body, { id: params.id });
      if (["tab.title", "tab.footer", "tab.directory", "tab.notify", "tab.error", "runtime.links.open"].includes(command)) return null;
      throw new Error(`the plugin API fixture has no answer for the call ${command}`);
    })));
    rec.arrange("composition.create", (elements) => track(Promise.resolve().then(async () => {
      view.composition.input = elements.input.view;
      await create?.(elements, view);
      // The region and the composition record their calls in the list of the bridge, so the order of all calls is observable.
      const answer = (method) => (...args) => {
        rec.record(`region.${method}`, args);
        const arranged = region[method];
        return typeof arranged === "function" ? arranged(...args) : arranged ?? null;
      };
      return {
        region: () => ({
          on: (type, fn) => { rec.record("region.on", [type]); view.composition.listeners[type] = fn; },
          focus: answer("focus"),
          setCaret: answer("setCaret"),
        }),
        dispose: async () => { rec.record("composition.dispose", []); },
      };
    })));
    arrange?.(bridge);
  });
  observeViewDocumentFrames.reset();
  const exposuresBefore = exposures.length;
  async function close() {
    if (closing.done) return;
    closing.done = true;
    try {
      window.dispatchEvent(new window.Event("pagehide"));
      await settled();
    } finally {
      arrangeBridges(null);
      window.close();
      restoreGlobals();
      open = false;
    }
  }
  t.after(close);
  /** Waits until the calls of the page have answered and one turn of the event loop passes with nothing more in flight. */
  async function settled() {
    for (;;) {
      while (inFlight > 0) await new Promise((resolve) => idle.push(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      if (inFlight === 0) return;
    }
  }
  pageLoads += 1;
  await import(`${PAGE.href}?view=${pageLoads}`);
  ({ exposure: view.exposure, bound: view.bound } = exposures[exposuresBefore]);
  // The host sends the theme of the window after the page starts, and the page passes it to its listeners.
  view.push("theme", null, THEME);
  await settled();
  return view;
}

/** The calls of the page on a method of the bridge, as their argument lists, in order. */
export const callsOf = (view, method) => view.bridge.rec.calls.filter((call) => call.method === method).map(({ args }) => args);

/** The names that the page registered through the exposure of this kind (status or element) or through commands.register (command). */
export const registered = (view, kind) => kind === "command"
  ? callsOf(view, "commands.register").map(([name]) => name)
  : callsOf(view, "exposure.register").filter(([entry]) => entry === kind).map(([, name]) => name);

/** The element of the terminal that the page exposes as terminal.view, which the page mounts in the shadow root of its body. */
export function terminalElement(view) {
  const host = view.window.document.body.firstElementChild;
  return host.shadowRoot.querySelector('[data-expose="terminal.view"]');
}

/** The calls of the page on the composition and its region, in order: composition.create, region.* and composition.dispose. */
export const compositionCalls = (view) => view.bridge.rec.calls.filter(({ method }) => method === "composition.create" || method === "composition.dispose" || method.startsWith("region."))
  .map(({ method, args }) => [method, ...args]);

/** The sends of the terminal to its sidecar session, in order: {id, body, cids}. */
export const sidecarSends = (view) => callsOf(view, "calls.request").filter(([command]) => command === "runtime.sidecar.send")
  .map(([, { id, body, cids }]) => ({ id, body, cids }));

/** Delivers a sidecar message of the session of the surface to the view, and waits until the page has handled it. */
export async function sidecarState(view, body, cids) {
  view.push("sidecar.message", SURFACE, body, cids);
  await view.settled();
}

/** Delivers a region input event to the input handler that the page gave the composition, and waits until it has been handled. */
export async function regionInput(view, event) {
  await view.composition.input(event);
  await view.settled();
}

/** The view calls of the page with their names, for the tests that read what the page asked of the host. */
export const requests = (view, command) => callsOf(view, "calls.request").filter(([name]) => name === command).map(([, params]) => params);
