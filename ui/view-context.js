// The surface context of the terminal view page (core docs/spec/plugins.md#view-surfaces). The page module view.js runs host calls when it
// is imported, so the assembly of the context is in this module, which a test can import.
import { createExpose } from "@soksak/plugin-api";
import { createExposurePort } from "./view-exposure-port.js";
import { createViewLog } from "./view-log.js";
import { viewClipboard } from "./view-clipboard.js";
import { SIDECAR, viewSidecar } from "./view-sidecar.js";
import { viewExposes } from "./view-exposes.js";

/** The release of a subscription that the route registers asynchronously: the release runs once the subscription is registered. */
function releaseOf(pending) {
  let stop = null;
  let released = false;
  // default: a refused subscription is recorded by the bridge, which forgets it, so the release of a refusal ends nothing.
  pending.then((end) => { stop = end; if (released) stop(); }, () => {});
  return () => { released = true; stop?.(); };
}

/**
 * The surface context of the view of one page, over the view bridge: the sidecar session of the surface, the tab reports,
 * the exposure, the composition and the event records run through the call route of the view (core
 * docs/spec/native-surfaces.md#view-surfaces, view calls).
 *
 *     bridge       createViewBridge() of @soksak/plugin-api/view over the sok-view handler of the view
 *     start        the frozen start values {surface, params, origin, project, declarations}
 *     report       report(text): writes one record to the application log
 *     diagnostics  the diagnostics module of the plugin in a diagnostic build, and null otherwise
 *     scale        the text scale of the surface, read from the route before the page starts
 *     settings     the values of the settings of the plugin, read from the route before the page starts
 */
export function createViewContext({ bridge, start, report, diagnostics = null, scale = 1, settings = {} }) {
  const { calls, runtime } = bridge;
  // The fire-and-forget calls of the context: a refusal of the route is a record, not a lost report.
  const send = (command, params) => calls.request(command, params)
    .then(undefined, (error) => report(`view call ${command}: ${error?.message ?? error}`));
  let values = settings;
  let factor = scale;
  return {
    context: {
      surfaceId: start.surface,
      // The view of a surface ends with it, so the page has no signal of the removal; the default of the terminal never aborts.
      closing: new AbortController().signal,
      composition: { create: (elements) => bridge.composition.create(elements) },
      exposure: createExpose(createExposurePort({ bridge, runtime, releaseOf, report }), () => viewExposes(start)),
      diagnostics,
      // The state of the surface is the state that the workbench keeps, so the page reports no phase; a failed terminal is
      // the error of the tab (core docs/spec/native-surfaces.md#view-surfaces, view calls).
      status: { report: (phase, error) => {
        if (phase === "ready") return;
        if (phase !== "error") throw new Error(`invalid surface phase: ${String(phase)}`);
        send("tab.error", error instanceof Error ? error.message : String(error));
      } },
      tab: {
        params: start.params ?? null,
        title: (text) => send("tab.title", text),
        footer: (text) => send("tab.footer", text),
        directory: (path) => send("tab.directory", path),
        notify: (text, policy) => send("tab.notify", { text, policy }),
      },
      origin: start.origin,
      project: start.project,
      runtime: {
        sidecar: (name) => {
          if (name !== SIDECAR) throw new Error(`runtime.sidecar of the terminal view takes ${SIDECAR}, got ${String(name)}`);
          return viewSidecar(calls, runtime);
        },
        theme: runtime.theme,
        // The terminal reads the values and the scale synchronously when it starts, so the page reads both from the route
        // before it starts, and each change arrives through the subscription of the view.
        settings: {
          read: () => values,
          on: (listener) => releaseOf(runtime.settings.on((next) => { values = next; listener(next); })),
        },
        textSize: {
          read: () => factor,
          on: (listener) => {
            let last = factor;
            return releaseOf(runtime.textSize.on((next) => {
              if (next === last) return;
              last = next;
              factor = next;
              listener(next);
            }));
          },
        },
        links: { open: (url) => calls.request("runtime.links.open", url) },
        clipboard: viewClipboard(calls),
        log: createViewLog(calls),
      },
    },
  };
}
