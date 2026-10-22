// The terminal view page (core docs/spec/plugins.md#view-surfaces): the host serves it at sok://terminal/ui/terminal.html in
// the web view of the surface, and injects the view channel script, the theme script and the start values before this page
// runs. The page builds the surface context of its view over the view bridge (@soksak/plugin-api/view), registers the
// declared exposure entries through the view exposure relay, and starts the terminal in a shadow root of the page. It reads
// the start values {surface, params, origin, project, declarations} from window.sokSurface, addresses the sidecar session of
// the surface with the surface identifier, and writes its records and its errors as the call runtime.log.
import { createExpose, declarationMap } from "@soksak/plugin-api";
import { createViewBridge } from "@soksak/plugin-api/view";
import { mountPage, startValues } from "./terminal-view.js";

import { createReporter, createViewLog } from "./view-log.js";
import { loadDiagnostics } from "./view-diagnostics.js";
import { viewClipboard } from "./view-clipboard.js";
import { SIDECAR, viewSidecar } from "./view-sidecar.js";

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
      exposure: createExpose({
        // A view declares its commands by the call runtime.command.register, and its statuses and dom names by the
        // registered call of the exposure relay (core docs/spec/native-surfaces.md#view-surfaces, view exposure).
        register: (kind, name) => kind === "command"
          ? calls.request("runtime.command.register", { name })
          : bridge.exposure.register(kind, name),
        onRequest: (fn) => { releaseOf(runtime.native.on("exposure-request", (data) => fn(data))); },
        reply: (id, payload) => bridge.exposure.reply(id, payload),
      }, () => diagnostics
        ? declarationMap(diagnostics.declaration.exposes, declarationMap(start.declarations))
        : start.declarations),
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

/** Sets the theme on the root of the page, as the theme script of the view and each later theme message carry it. */
function applyTheme(theme) {
  if (theme?.scheme !== "dark" && theme?.scheme !== "light") throw new Error("the theme must have scheme dark or light");
  document.documentElement.style.colorScheme = theme.scheme;
  for (const [token, value] of Object.entries(theme.tokens ?? {})) {
    document.documentElement.style.setProperty(token, value);
  }
}

/** The errors and unhandled rejections of this page are written to the application log when they occur. */
function installPageErrors(report) {
  for (const [type, pick] of [["error", (event) => event.error], ["unhandledrejection", (event) => event.reason]]) {
    addEventListener(type, (event) => {
      const error = pick(event);
      report(`view terminal: ${error?.message ?? String(error)}`);
    });
  }
}

// The page: the start values, the bridge over the injected channel, the theme of the document, and the terminal in the
// shadow root of the page body.
const start = startValues();
const losses = [];
const bridge = createViewBridge({ handler: window.webkit.messageHandlers["sok-view"], report: (event) => losses.push(event) });
const report = createReporter(bridge.calls);
for (const event of losses.splice(0)) {
  report(`view calls of terminal: ${event.kind} ${event.status}${event.reason === undefined ? "" : `: ${event.reason}`}`);
}
installPageErrors(report);
if (window.sokTheme) applyTheme(window.sokTheme);
bridge.runtime.theme(applyTheme);
// The terminal reads the scale and the settings at its start, and the diagnostic declaration decides the exposure entries of
// the page, so the page resolves all three before it starts anything.
const [scale, settings, diagnostics] = await Promise.all([
  bridge.runtime.textSize.read(), bridge.runtime.settings.read(), loadDiagnostics(),
]);
const { context } = createViewContext({ bridge, start, report, diagnostics, scale, settings });
await mountPage(context, report);
