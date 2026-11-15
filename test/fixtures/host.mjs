// The host side of a view page for the plugin tests. The view is a jsdom window at soksak://<plugin id>/, and this module plays the
// part of the host at the sok-view boundary (docs/spec/native-surfaces.md#view-surfaces): it injects the start values and the theme,
// runs the view channel script (the document-start script of the view), answers each view call by the wire contract, delivers host
// messages to the page, and records what the page sends. The page modules of this plugin run unchanged in the window; nothing here
// imports the implementation of the host.
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";

/** The error code of a call that failed, as the view wire of the host states it (docs/spec/native-surfaces.md#view-surfaces). */
const FAILED = -32000;

/**
 * The globals of Node that the page keeps: the window does not replace them. Each other own property of the window becomes a global
 * while the view is open, so the page modules read the DOM of the window as they do in the view. The performance of the window stays
 * a Node global, because the Performance of jsdom recurses when it is installed as the global of a process.
 */
const NODE_GLOBALS = new Set(["console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate",
  "queueMicrotask", "structuredClone", "performance", "crypto", "fetch", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController",
  "AbortSignal", "Blob", "File", "FormData", "Headers", "Request", "Response", "WebSocket", "process", "Buffer", "global", "globalThis"]);

/** The one view that is open in this process: the globals of the window are installed for it and restored when it closes. */
let openWindow = null;

/** The loads of page modules in this process: each load of a page is a module of its own, because a module evaluates once per URL. */
let pageLoads = 0;

/** The entries of the document that the core declares for each view: the page registers them, so the start values declare them too. */
const CORE_DECLARATIONS = {
  status: [{ name: "core.surface.document" }, { name: "core.surface.input" }],
  commands: [{ name: "core.surface.hit" }, { name: "core.surface.clock" }],
};

/** A call that the host refuses or fails: its message is the message of the reply (docs/spec/native-surfaces.md#view-surfaces). */
class CallError extends Error {
  constructor(message, code = FAILED) {
    super(message);
    this.code = code;
  }
}

/** Installs the own properties of the window as globals and returns the restore function of the previous globals. */
function installGlobals(window) {
  const previous = new Map();
  // The own properties of the window replace the globals; the members of its prototypes (addEventListener, for one) fill the names that
  // no global of Node has, so a bare call of them in a page module reaches the window.
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
    // An accessor of the window stays an accessor: reading it here would run it, and the storage accessors throw for the opaque origin
    // of a view. A method of the window is bound to it, so a page calls addEventListener or getComputedStyle as a bare name, as the view does.
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
 * The ResizeObserver of the view window. jsdom has no layout observer, so the observer records its targets, and the test delivers each
 * size change to its callback through notify(entries). The page observes through the constructor of the window.
 */
class ViewResizeObserver {
  constructor(callback) {
    if (typeof callback !== "function") throw new TypeError("ResizeObserver requires a callback");
    this.callback = callback;
    this.targets = [];
    openWindow?.observers.push(this);
  }

  // Each call that changes the targets is recorded in the observations of the view with their observer, so a test reads the start and the stop of each observer.
  observe(target) {
    openWindow?.observations.push({ observer: this, call: "observe", target });
    if (!this.targets.includes(target)) this.targets.push(target);
  }

  unobserve(target) {
    openWindow?.observations.push({ observer: this, call: "unobserve", target });
    this.targets = this.targets.filter((observed) => observed !== target);
  }

  disconnect() {
    openWindow?.observations.push({ observer: this, call: "disconnect", target: null });
    this.targets = [];
  }

  notify(entries) {
    this.callback(entries, this);
  }
}

/**
 * Opens the window of a view page and returns the host of the view. Options:
 *
 *     plugin        the plugin id, which is the host of the view origin
 *     surface       the surface of the view
 *     start         the start values of the surface (window.sokSurface), or undefined for a view without start values
 *     theme         the theme of the window (window.sokTheme)
 *     declarations  the exposure declarations of the plugin: {status, commands, element}
 *     sidecars      the sidecars that plugin.json declares, as names
 *     composition   the composition declaration of the view (plugin.json surface.composition)
 *     sidecar       function(body, {id}) that answers each runtime.sidecar.send: its return value is the result, a throw is the error
  *     image         {attach, focus, caret, text, detach}: functions of the params and the host of each image call of the composition
 *     native        {name: function(payload)} that answers runtime.native.call beyond the registrations and the exposure reply
 *     clipboard     {read(type), writeText(text)} that answer the clipboard calls; a clipboard with no payload reads null
 *     faults        {route: message} for routes that reject with the message; an image call routes as composition.<call>
 *     settings      the settings values that runtime.settings.read answers
 *     textSize      the text scale that runtime.textSize.read answers
 *     levels        the log levels of the start values (window.sokSurface.levels)
 *
 * Returns the host: window, calls, sent, observed {errors, sidecar}, events, observers, registered(kind), request(command, params),
 * push(event, data), sidecarMessage(sidecar, surface, message), sidecarFailure(sidecar, surface, reason), settled(), load(url), close().
 */
export function openViewWindow(options) {
  if (openWindow !== null) throw new Error("a view window is already open in this test process; close it before opening another");
  const { plugin, surface, start, theme, declarations, sidecars, composition, sidecar = () => null, image = {}, native = {},
    clipboard = {}, faults = {}, settings = {}, textSize = 1, levels } = options;
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: `soksak://${plugin}/ui/terminal.html`,
    pretendToBeVisual: true,
  });
  const window = dom.window;
  const host = {
    window,
    calls: [],
    sent: [],
    observed: { errors: [], sidecar: [] },
    events: [],
    observers: [],
    observations: [],
    registered: (kind) => host.calls
      .filter(({ command, params }) => command === "runtime.native.call" && params.name === "registered" && params.payload.kind === kind)
      .map(({ params }) => params.payload.name).filter((name) => !name.startsWith("core.")),
    request,
    push,
    sidecarMessage,
    sidecarFailure,
    settled,
    load,
    close,
  };
  // The routes that the page has open: the sidecar sessions that route messages and failures to the view.
  const sidecarRoutes = new Set();
  const failureRoutes = new Set();
  // The host calls that wait for the page: a call of the page answered by the host, or a request of the host answered by the page.
  let inFlight = 0;
  const idle = [];
  const pending = new Map();
  let nextRequest = 0;
  let closed = false;

  const restoreGlobals = installGlobals(window);
  // The start values carry the declarations of the plugin with the core entries of the view document, which the page checks its registrations against.
  if (start !== undefined) {
    window.sokSurface = start === null ? null : { ...start, levels, declarations: withCoreDeclarations(start.declarations) };
  }
  // The start script of the view runs before any page script: it posts the ready message, checks each host message, and keeps
  // the messages until the page attaches its listener (docs/spec/native-surfaces.md#view-surfaces, view channel).
  const queue = [];
  let listener = null;
  const refuse = (reason) => host.observed.errors.push(`error view channel: ${reason}`);
  window.sokView = Object.freeze({
    page: randomUUID(),
    timeOrigin: window.performance.timeOrigin,
    attach(next) {
      if (typeof next !== "function") throw new TypeError("attach requires a listener function");
      listener = next;
      while (queue.length > 0 && listener === next) next(queue.shift());
    },
  });
  window.addEventListener("message", (event) => {
    if (event.source !== window) return refuse("message from another source");
    const data = event.data;
    if (typeof data !== "object" || data === null || data.sok !== 1) return refuse("message without the sok marker");
    if (listener === null) queue.push(data);
    else listener(data);
  });
  window.webkit = { messageHandlers: { "sok-view": { postMessage: (message) => receive(message) } } };
  window.sokTheme = theme;
  window.ResizeObserver = ViewResizeObserver;
  // jsdom has no visual viewport. The view of the page reads its resize events, and the frame of the view is the window, so the viewport is
  // the window itself at its own size and scale.
  Object.defineProperty(window, "visualViewport", {
    value: Object.assign(new window.EventTarget(), { width: window.innerWidth, height: window.innerHeight, scale: 1, offsetLeft: 0, offsetTop: 0 }),
    configurable: true,
  });
  openWindow = host;

  /** Posts a host message to the window of the view, as the host posts the events and replies of the view. */
  function hostMessage(message) {
    window.dispatchEvent(new window.MessageEvent("message", { data: { sok: 1, ...message }, source: window }));
  }

  /** Waits until the page has no call in flight and sends nothing more after one turn of the event loop. */
  async function settled() {
    for (;;) {
      while (inFlight > 0) await new Promise((resolve) => idle.push(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      if (inFlight === 0) return;
    }
  }

  function finish() {
    inFlight -= 1;
    if (inFlight === 0) for (const resolve of idle.splice(0)) resolve();
  }

  /** Receives one message that the page posts through sok-view: a ready or error report, a call, or a reply to a host request. */
  function receive(message) {
    if (message?.event === "view.ready") return;
    if (message?.event === "view.error") {
      host.observed.errors.push(`view ${plugin} ${surface}: ${message.reason}`);
      return;
    }
    host.sent.push(message);
    if (typeof message?.reply === "number") {
      const waiting = pending.get(message.reply);
      if (waiting === undefined) throw new Error(`the page replied to the request ${message.reply}, which is not pending`);
      pending.delete(message.reply);
      if (message.error !== undefined) waiting.reject(new CallError(message.error.message, message.error.code));
      else waiting.resolve(message.result);
      finish();
      return;
    }
    if (!Number.isInteger(message?.id) || typeof message?.command !== "string") {
      throw new Error(`the page posted a message that is neither a call nor a reply: ${JSON.stringify(message)}`);
    }
    const call = { command: message.command, params: message.params, id: message.id };
    host.calls.push(call);
    inFlight += 1;
    // A reply comes after the call is posted, as the host answers a call through its own queue.
    setImmediate(() => answer(call));
  }

  /** Answers one call of the page, and posts its result or its error to the window. */
  async function answer(call) {
    try {
      const result = await route(call.command, call.params);
      hostMessage({ id: call.id, result: result ?? null });
    } catch (error) {
      hostMessage({ id: call.id, error: { code: error instanceof CallError ? error.code : FAILED, message: errorText(error) } });
    } finally {
      finish();
    }
  }

  /** The answer of one call by its route. A route with a fault rejects with the message of the fault. */
  async function route(command, params) {
    const name = command.startsWith("image.") ? `composition.${command}` : command;
    if (Object.hasOwn(faults, name)) throw new CallError(faults[name]);
    if (command.startsWith("image.")) {
      const operation = image[command.slice("image.".length)];
      if (typeof operation !== "function") throw new Error(`the view host has no answer for ${command}`);
      return operation(params, host);
    }
    switch (command) {
      case "composition.declaration": return composition;
      case "composition.place":
      case "composition.report":
      case "tab.focus":
      case "tab.title":
      case "tab.footer":
      case "tab.directory":
      case "tab.modified":
      case "tab.error":
      case "tab.notify":
      case "tab.keep":
      case "runtime.command.register":
      case "runtime.native.on":
      case "runtime.sidecar.on":
      case "runtime.sidecar.onFailure":
      case "runtime.textSize.on":
      case "runtime.settings.on":
      case "runtime.log.levels.on":
      case "runtime.status.watch":
      case "runtime.status.unwatch":
      case "runtime.contributions.fail":
      case "runtime.links.open":
      case "runtime.clipboard.writeText":
      case "runtime.data.set":
        return subscribe(command, params);
      case "runtime.error":
        host.observed.errors.push(`error workbench surface ${surface} ${params.where}: ${params.text}`);
        return null;
      case "runtime.log":
        return logCall(params);
      case "runtime.native.call":
        return nativeCall(params);
      case "runtime.sidecar.send":
        return sidecarSend(params);
      case "runtime.textSize.read": return textSize;
      case "runtime.settings.read": return settings;
      case "runtime.clipboard.read": return clipboardRead(params);
      case "surface.menu": return false;
      case "runtime.contributions": return [];
      default:
        throw new Error(`the view host has no answer for ${command}`);
    }
  }

  /** The subscriptions and registrations of the page: each records its route and replies null. */
  function subscribe(command, params) {
    if (command === "runtime.sidecar.on" || command === "runtime.sidecar.onFailure") {
      checkSidecar(params.sidecar);
      (command === "runtime.sidecar.on" ? sidecarRoutes : failureRoutes).add(`${params.sidecar}\u0000${params.id}`);
    }
    if (command === "runtime.command.register" && !params.name.startsWith("core.")) {
      if (!(declarations.commands ?? []).some(({ name }) => name === params.name)) {
        throw new CallError(`command ${params.name} is not declared by ${plugin}`);
      }
    }
    return null;
  }

  function checkSidecar(name) {
    if (!sidecars.includes(name)) throw new CallError(`${plugin} declares no sidecar ${name}`);
  }

  function logCall(params) {
    if (params.action === "clock") {
      return { ts_us: Math.round(Date.now() * 1000), mono_ns: Number(process.hrtime.bigint()) };
    }
    if (params.action !== "batch") throw new CallError(`runtime.log has no action ${String(params.action)}`);
    host.events.push(...params.events);
    return null;
  }

  function nativeCall({ name, payload }) {
    if (name === "registered") {
      const { kind, name: entry } = payload;
      if (!entry.startsWith("core.")) {
        const list = kind === "element" ? declarations.element : declarations[kind === "command" ? "commands" : kind];
        if (!Array.isArray(list) || !list.some((declared) => declared.name === entry)) {
          throw new CallError(`registered: ${entry} is not declared as ${kind} by ${plugin}`);
        }
      }
      return null;
    }
    if (name === "changed" || name === "exposureReply") return null;
    if (Object.hasOwn(native, name)) return native[name](payload);
    throw new Error(`the view host has no native call ${name}`);
  }

  function sidecarSend({ id, sidecar: name, body, cids }) {
    checkSidecar(name);
    const entry = { sidecar: name, id, body, cids };
    host.observed.sidecar.push(entry);
    return sidecar(body, { id });
  }

  function clipboardRead(type) {
    if (type === "png") return clipboard.readPNG ? clipboard.readPNG() : null;
    return clipboard.read ? clipboard.read(type) : null;
  }

  /** Sends a host message {sok: 1, event, data} to the page: the event of a subscription that the page registered. */
  function push(event, data) {
    hostMessage({ event, data });
  }

  /** Delivers a sidecar message of a session to the view when the view subscribed to that session (docs/spec/native-surfaces.md). */
  function sidecarMessage(name, id, { body, cids }) {
    if (!sidecarRoutes.has(`${name}\u0000${id}`)) return;
    hostMessage({ event: "sidecar.message", data: { id, cids, body } });
  }

  /** Delivers a sidecar failure of a session to the view when the view subscribed to that session under the failure route. */
  function sidecarFailure(name, id, reason) {
    if (!failureRoutes.has(`${name}\u0000${id}`)) return;
    hostMessage({ event: "sidecar.failure", data: { id, reason } });
  }

  /** Sends a request of the host to the page, as the host sends a command request of the view: the page answers with its reply. */
  function request(command, params) {
    const id = ++nextRequest;
    inFlight += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      hostMessage({ id, command, params });
    });
  }

  /** Loads a page module into the window, as the view loads its page: the module evaluates against the globals of this window. */
  async function load(url) {
    pageLoads += 1;
    return import(`${url.href}?view=${pageLoads}`);
  }

  /** Ends the view: the page is hidden, its calls settle, and the window and the globals are released. Closing twice is a no-op. */
  async function close() {
    if (closed) return;
    closed = true;
    try {
      window.dispatchEvent(new window.Event("pagehide"));
      await settled();
    } finally {
      window.close();
      restoreGlobals();
      openWindow = null;
    }
  }

  return host;
}

/** The declarations of the view with the entries of the core document added: the status and command lists of the plugin come first. */
function withCoreDeclarations(declarations) {
  return {
    ...declarations,
    status: [...declarations.status ?? [], ...CORE_DECLARATIONS.status],
    commands: [...declarations.commands ?? [], ...CORE_DECLARATIONS.commands],
  };
}

/** The text of an error that a call reports: the message of an Error, or the text of any other value. */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
