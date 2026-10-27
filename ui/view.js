// The terminal view page (core docs/spec/plugins.md#view-surfaces): the host serves it at sok://terminal/ui/terminal.html in
// the web view of the surface, and injects the view channel script, the theme script and the start values before this page
// runs. The page builds the surface context of its view over the view bridge (@soksak/plugin-api/view), registers the
// declared exposure entries through the view exposure relay, and starts the terminal in a shadow root of the page. It reads
// the start values {surface, params, origin, project, declarations} from window.sokSurface, addresses the sidecar session of
// the surface with the surface identifier, and writes its records and its errors as the call runtime.log.
import { createViewBridge } from "@soksak/plugin-api/view";
import { mountPage, startValues } from "./terminal-view.js";

import { loadDiagnostics, startViewDocumentFrames } from "./view-diagnostics.js";
import { createViewContext, createViewErrorReporter } from "./view-context.js";

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
const pendingBridgeReports = [];
let reportBridgeEvent = (event) => pendingBridgeReports.push(event);
const bridge = createViewBridge({
  handler: window.webkit.messageHandlers["sok-view"],
  report: (event) => reportBridgeEvent(event),
});
const report = createViewErrorReporter(bridge.runtime);
installPageErrors(report);
const reportBridgeFailure = (event) => {
  const details = { ...event };
  if (details.error instanceof Error) details.error = { name: details.error.name, message: details.error.message };
  const text = `view bridge: ${JSON.stringify(details)}`;
  // runtime.error uses this callback only after its own call fails; logging through runtime.log here would recurse.
  if (event?.kind === "open-calls") console.debug(text);
  else console.error(text);
};
reportBridgeEvent = reportBridgeFailure;
for (const event of pendingBridgeReports.splice(0)) {
  reportBridgeFailure(event);
}
if (window.sokTheme) applyTheme(window.sokTheme);
bridge.runtime.theme(applyTheme);
// The terminal reads the scale and the settings at its start, and the diagnostic declaration decides the exposure entries of
// the page, so the page resolves all three before it starts anything.
const [scale, settings, loadedDiagnostics] = await Promise.all([
  bridge.runtime.textSize.read(), bridge.runtime.settings.read(), loadDiagnostics(),
]);
const observeViewDocumentFrames = loadedDiagnostics === null
  ? null
  : (await import("@soksak/plugin-api/diagnostic-view-frames")).observeViewDocumentFrames;
const diagnostics = loadedDiagnostics === null ? null : {
  ...loadedDiagnostics,
  startViewFrames({ log }) {
    return startViewDocumentFrames({
      viewWindow: window,
      observe: observeViewDocumentFrames,
      log,
    });
  },
};
const { context } = createViewContext({ bridge, start, report, diagnostics, scale, settings });
await mountPage(context, report);
