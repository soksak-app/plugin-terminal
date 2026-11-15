// The fixture of @soksak/plugin-api, the module the page imports for createExpose and shellQuotePath. It records each call with its
// arguments and gives the answer that the test arranges. It implements only what the interface states (core docs/spec/exposure.md):
// a registration is sent to the port, a request of the host runs the registered handler and is answered through the port, and a
// handler runs when the page drives it. It does not compute the answer of a helper.
import { createRecorder } from "./record.mjs";

const shellQuote = createRecorder("shellQuotePath");

/** The exposures created in this process, in order, so a test reads the registrations of the page. */
export const exposures = [];

/** Quotes a path for the shell; the answer is arranged by the test (shellQuotePath.arrange). */
export function shellQuotePath(...args) {
  return shellQuote.answer("shellQuotePath", args);
}
shellQuotePath.arrange = (answer) => shellQuote.arrange("shellQuotePath", answer);
shellQuotePath.calls = shellQuote.calls;
shellQuotePath.reset = shellQuote.reset;

/**
 * Creates the exposure of a view over its port {register, onRequest, reply, changed, report}. Each registration goes to the port. The
 * host asks the exposure through the request handler that the port subscribes with `status.get {name}` and `command.run {name, params}`
 * (core docs/spec/exposure.md#relay), and the result or the error goes to port.reply. A test drives the exposure itself through
 * run(name, params) and read(name), which call the command and the status that the page registered. bind(element, name, params,
 * {event, when, failed}) runs the registered command on the event of the element, as exposure.md states, until dispose.
 * Returns the methods that the page calls: status, command, element, bind, dispose.
 */
export function createExpose(port, getDeclarations) {
  const handlers = new Map();
  const statuses = new Map();
  const elements = new Map();
  const bound = [];
  // The port subscribes the requests of the host when the first entry is registered.
  let subscribed = false;
  const subscribe = () => {
    if (subscribed) return;
    subscribed = true;
    port.onRequest(async ({ id, method, params }) => {
      try {
        let result;
        if (method === "command.run") result = await exposure.run(params.name, params.params);
        else if (method === "status.get") result = await exposure.read(params.name);
        else throw new Error(`plugin API fixture: no answer for ${method}`);
        port.reply(id, { result: result ?? null });
      } catch (error) {
        port.reply(id, { error: { message: error instanceof Error ? error.message : String(error) } });
      }
    });
  };
  const exposure = {
    declarations: getDeclarations,
    async status(name, read, watch) {
      subscribe();
      await port.register("status", name);
      statuses.set(name, { read, watch });
    },
    async command(name, run) {
      subscribe();
      await port.register("command", name);
      handlers.set(name, run);
    },
    async element(name, element) {
      subscribe();
      await port.register("element", name);
      elements.set(name, element);
    },
    async bind(element, name, params, options = {}) {
      const { event = "click", when, failed } = options;
      const listener = (domEvent) => {
        if (when !== undefined && !when(domEvent)) return;
        const run = exposure.run(name, typeof params === "function" ? params(domEvent) : params);
        if (failed === undefined) run.catch((error) => queueMicrotask(() => { throw error; }));
        else run.catch(failed);
      };
      element.addEventListener(event, listener);
      bound.push({ element, name, params, options, event, listener });
    },
    /** Marks the element with its command: data-command, data-params (a fixed params object) and data-value (the name of the value). */
    async mark(element, name, params, valueName) {
      element.dataset.command = name;
      if (params !== undefined && typeof params !== "function") element.dataset.params = JSON.stringify(params);
      if (valueName !== undefined) element.dataset.value = valueName;
      return element;
    },
    /** Runs the commands of the marked descendants of root that bind has not connected, on their clicks. */
    async delegate(root) {
      const listener = (event) => {
        const marked = event.target.closest("[data-command]");
        if (marked === null || bound.some(({ element }) => element === marked)) return;
        const params = marked.dataset.params === undefined ? {} : JSON.parse(marked.dataset.params);
        exposure.run(marked.dataset.command, params).catch((error) => queueMicrotask(() => { throw error; }));
      };
      root.addEventListener("click", listener);
      bound.push({ element: root, name: null, params: null, options: {}, event: "click", listener });
    },
    /** Runs the command that the page registered under name with params, as the host does for command.run. */
    run(name, params) {
      const handler = handlers.get(name);
      if (handler === undefined) return Promise.reject(new Error(`plugin API fixture: command ${name} is not registered`));
      return Promise.resolve().then(() => handler(params));
    },
    /** Reads the status that the page registered under name, as the host does for status.get. */
    read(name) {
      const status = statuses.get(name);
      if (status === undefined) return Promise.reject(new Error(`plugin API fixture: status ${name} is not registered`));
      return Promise.resolve().then(() => status.read());
    },
    async dispose() {
      for (const { element, event, listener } of bound) element.removeEventListener(event, listener);
      handlers.clear();
      statuses.clear();
      elements.clear();
      bound.length = 0;
    },
  };
  exposures.push({ exposure, handlers, statuses, elements, bound });
  return exposure;
}
