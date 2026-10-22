// The sidecar port of the terminal view page (core docs/spec/native-surfaces.md#view-surfaces, view calls and view events).
// The port sends each request through the call route of the view and subscribes through the view bridge. The module imports
// no SDK module, so the page and its tests share it.

/** The sidecar port of the view: send is the call runtime.sidecar.send, and on and onFailure are the subscriptions of the bridge. */
export function viewSidecar(calls, runtime) {
  return {
    send: (surface, body, cids) => calls.request("runtime.sidecar.send", { id: surface, body, cids }),
    on: (surface, fn) => runtime.sidecar().on(surface, fn),
    onFailure: (surface, fn) => runtime.sidecar().onFailure(surface, fn),
  };
}
