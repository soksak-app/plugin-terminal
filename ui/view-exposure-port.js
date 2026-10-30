// The exposure port of the terminal view, which core createExpose takes (core docs/spec/native-surfaces.md#view-surfaces, view exposure).

/**
 * Returns the port {register, onRequest, reply, report} of the view.
 *
 *     bridge     createViewBridge() of @soksak/plugin-api/view
 *     runtime    the runtime of the bridge, whose native.on delivers the exposure requests
 *     releaseOf  releaseOf(stop) keeps the stop function of a subscription until the view ends
 *     report     report(text): writes one record to the application log
 */
export function createExposurePort({ bridge, runtime, releaseOf, report }) {
  return {
    // A command is declared by commands.register of the bridge (withBridgeCommands), which keeps its handler for the command
    // requests of core, so the port sends no declaration of its own; statuses and dom names are declared by the registered
    // call of the exposure relay.
    register: (kind, name) => kind === "command" ? Promise.resolve() : bridge.exposure.register(kind, name),
    onRequest: (fn) => { releaseOf(runtime.native.on("exposure-request", (data) => fn(data))); },
    reply: (id, payload) => bridge.exposure.reply(id, payload),
    // A reply that the host refuses is written to the application log.
    report: (text) => report(`exposure: ${text}`),
  };
}

/**
 * Returns the exposure whose command(name, run) also registers run through commands.register of the view bridge. Core sends a
 * forwarded command.run of a registered view command to the view as a command request, which the bridge answers from those
 * handlers (core docs/spec/native-surfaces.md#view-surfaces, view exposure).
 *
 *     exposure  the exposure of createExpose
 *     commands  the commands of createViewBridge()
 */
export function withBridgeCommands(exposure, commands) {
  return {
    ...exposure,
    command: (name, run) => Promise.all([exposure.command(name, run), commands.register(name, run)]).then(() => undefined),
  };
}
