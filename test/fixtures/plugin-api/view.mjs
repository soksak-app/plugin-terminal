// The fixture of @soksak/plugin-api/view, the bridge that the view page creates. Each method of the bridge records its call with its
// arguments, and answers with the value that the test arranges. A subscription keeps its listener, and the test delivers an event to
// the listeners of that event with push (the host side of the bridge; core docs/spec/native-surfaces.md#view-surfaces). A command
// registered with commands.register is run by runCommand, as core sends a command request of the view. The fixture computes no answer.
import { createRecorder } from "./record.mjs";

/** The methods that the page calls for their effect; their answer is undefined unless the test arranges another. */
const EFFECTS = ["runtime.log.debug", "runtime.log.info", "runtime.log.warn", "runtime.log.error", "runtime.log.trace",
  "runtime.error", "runtime.clipboard.writeText", "runtime.links.open", "exposure.register", "exposure.reply", "exposure.changed",
  "commands.register"];

/** The function that the test installs to arrange each bridge when the page creates it (the page creates its bridge while it loads). */
let arrangement = null;

/** Installs the arrangement of the bridges created next; null removes it. */
export function arrangeBridges(arrange) {
  arrangement = arrange;
}

/** The bridges created in this process, in order: the page creates one per load. */
export const bridges = [];

/**
 * Creates the bridge of a view page. Options: handler (the sok-view handler of the view, which the bridge uses only as its channel
 * and the fixture does not call) and report (the error reporter of the page, which the fixture keeps for the test).
 */
export function createViewBridge({ handler, report } = {}) {
  const rec = createRecorder("createViewBridge", { effects: EFFECTS });
  /** The subscriptions: each entry is {key, arg, fn}, where arg filters the events of a surface or a native event name. */
  const subscriptions = [];
  const commands = new Map();
  const subscribe = (key, arg, fn, name) => {
    rec.record(name, [arg, fn]);
    const entry = { key, arg, fn };
    subscriptions.push(entry);
    return () => {
      const index = subscriptions.indexOf(entry);
      if (index !== -1) subscriptions.splice(index, 1);
    };
  };
  // The subscriptions that the route registers asynchronously answer with a promise of their release function.
  const subscribeAsync = (key, arg, fn, name) => Promise.resolve(subscribe(key, arg, fn, name));
  const bridge = {
    handler,
    report,
    rec,
    runtime: {
      theme: (fn) => subscribe("theme", null, fn, "runtime.theme"),
      textSize: {
        read: (...args) => rec.answer("runtime.textSize.read", args),
        on: (fn) => subscribeAsync("textSize", null, fn, "runtime.textSize.on"),
      },
      settings: {
        read: (...args) => rec.answer("runtime.settings.read", args),
        on: (fn) => subscribeAsync("settings", null, fn, "runtime.settings.on"),
      },
      log: {
        debug: (...args) => rec.answer("runtime.log.debug", args),
        info: (...args) => rec.answer("runtime.log.info", args),
        warn: (...args) => rec.answer("runtime.log.warn", args),
        error: (...args) => rec.answer("runtime.log.error", args),
        trace: (...args) => rec.answer("runtime.log.trace", args),
        levels: (...args) => rec.answer("runtime.log.levels", args),
      },
      error: (...args) => rec.answer("runtime.error", args),
      clipboard: {
        read: (...args) => rec.answer("runtime.clipboard.read", args),
        writeText: (...args) => rec.answer("runtime.clipboard.writeText", args),
        persistPNG: (...args) => rec.answer("runtime.clipboard.persistPNG", args),
      },
      links: { open: (...args) => rec.answer("runtime.links.open", args) },
      native: { on: (event, fn) => subscribeAsync("native", event, fn, "runtime.native.on") },
      sidecar: (name) => ({
        on: (surface, fn) => subscribe("sidecar.message", surface, fn, `runtime.sidecar(${name}).on`),
        onFailure: (surface, fn) => subscribe("sidecar.failure", surface, fn, `runtime.sidecar(${name}).onFailure`),
      }),
    },
    calls: {
      request: (...args) => rec.answer("calls.request", args),
    },
    composition: {
      create: (...args) => rec.answer("composition.create", args),
    },
    exposure: {
      register: (...args) => rec.answer("exposure.register", args),
      reply: (...args) => rec.answer("exposure.reply", args),
      changed: (...args) => rec.answer("exposure.changed", args),
    },
    commands: {
      register: async (name, run) => {
        rec.answer("commands.register", [name, run]);
        commands.set(name, run);
      },
    },
    /** Delivers an event to the listeners of its key; a surface or native event name filters the listeners that take it. */
    push(key, arg, ...args) {
      for (const entry of [...subscriptions]) {
        if (entry.key === key && (entry.arg === null || arg === undefined || entry.arg === arg)) entry.fn(...args);
      }
    },
    /** Runs a command that the page registered, as core sends its command request to the view. */
    runCommand(name, params) {
      const run = commands.get(name);
      if (run === undefined) throw new Error(`plugin API fixture: command ${name} is not registered by the page`);
      return Promise.resolve(run(params));
    },
  };
  bridges.push(bridge);
  arrangement?.(bridge);
  return bridge;
}
