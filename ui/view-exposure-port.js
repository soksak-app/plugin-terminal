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
    // A view declares its commands by the call runtime.command.register, and its statuses and dom names by the
    // registered call of the exposure relay.
    register: (kind, name) => kind === "command"
      ? bridge.calls.request("runtime.command.register", { name })
      : bridge.exposure.register(kind, name),
    onRequest: (fn) => { releaseOf(runtime.native.on("exposure-request", (data) => fn(data))); },
    reply: (id, payload) => bridge.exposure.reply(id, payload),
    // A reply that the host refuses is written to the application log.
    report: (text) => report(`exposure: ${text}`),
  };
}
