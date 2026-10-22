// The sidecar port of the terminal view page (core docs/spec/native-surfaces.md#view-surfaces, view calls and view events).
// The port names its sidecar in each call and subscription, as the call runtime.sidecar.send and the bridge require. The module
// imports no SDK module, so the page and its tests share it.

/** The sidecar of the terminal, which is the only dependency of plugin.json. */
export const SIDECAR = "@soksak/sidecar-vt-alacritty";

/** The sidecar port of the view: send is the call runtime.sidecar.send, and on and onFailure are the subscriptions of the bridge. */
export function viewSidecar(calls, runtime) {
  return {
    send: (surface, body, cids) => calls.request("runtime.sidecar.send", { id: surface, sidecar: SIDECAR, body, cids }),
    on: (surface, fn) => runtime.sidecar(SIDECAR).on(surface, fn),
    onFailure: (surface, fn) => runtime.sidecar(SIDECAR).onFailure(surface, fn),
  };
}
