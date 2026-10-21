// The terminal view page (core docs/spec/plugins.md#view-surfaces): the host serves it at sok://terminal/ui/terminal.html in
// the web view of the surface, and injects the view channel script, the theme script and the start values before this page
// runs. The page builds the surface context of its view over the view bridge (@soksak/plugin-api/view), registers the
// declared exposure entries through the view exposure relay, and starts the terminal in a shadow root of the page. It reads
// the start values {surface, params, origin, project, declarations} from window.sokSurface, addresses the sidecar session of
// the surface with the surface identifier, and writes its records and its errors as the call runtime.log.
import { createExpose, declarationMap } from "@soksak/plugin-api";
import { createViewBridge } from "@soksak/plugin-api/view";
import { startTerminal } from "./terminal.js";

const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value !== "";

// The form of each start value (core docs/spec/native-surfaces.md#view-surfaces, start values): params are the tab
// parameters or null, origin is {directory} with a directory or null, project is {root} or null, and declarations are the
// exposes of the plugin.
const START_FORM = {
  params: (value) => value !== undefined,
  origin: (value) => value === null || (isRecord(value) && (value.directory === null || isText(value.directory))),
  project: (value) => value === null || (isRecord(value) && isText(value.root)),
  declarations: isRecord,
};

/** The frozen start values of the surface, which the host of the view injects before the page runs. */
export function startValues(windowRef = window) {
  const start = windowRef.sokSurface;
  if (start === null || typeof start !== "object" || !isText(start.surface)) {
    throw new Error(`the view of ${windowRef.location.host} has no start values: the host provides window.sokSurface {surface, params, origin, project, declarations} before the page runs`);
  }
  for (const [name, valid] of Object.entries(START_FORM)) {
    if (!valid(start[name])) {
      throw new Error(`the start values of the view of ${windowRef.location.host} are not {surface, params, origin, project, declarations}: ${name} is ${JSON.stringify(start[name]) ?? "undefined"}`);
    }
  }
  return start;
}

/** The reporter of this page: each record is written to the application log through the call runtime.log (core docs/spec/logging.md). */
function createReporter(calls) {
  return (text) => calls.request("runtime.log", { level: "error", event: "plugin.terminal.report", fields: { text } })
    .then(undefined, (error) => Promise.reject(new Error(`report of a page record failed: ${error?.message ?? error}`)))
    .catch((error) => console.error(error.message));
}

/** The release of a subscription that the route registers asynchronously: the release runs once the subscription is registered. */
function releaseOf(pending) {
  let stop = null;
  let released = false;
  // default: a refused subscription is recorded by the bridge, which forgets it, so the release of a refusal ends nothing.
  pending.then((end) => { stop = end; if (released) stop(); }, () => {});
  return () => { released = true; stop?.(); };
}

/**
 * The diagnostics module of this plugin, which is staged only in a diagnostic build: the declaration file decides, as the
 * workbench reads the declaration of diagnostics.json for each plugin. In a build without it the route serves no file, and
 * the page registers no diagnostic entry. Returns {declaration, attach}, or null without a diagnostic declaration.
 */
export async function loadDiagnostics() {
  let response;
  try {
    response = await fetch(new URL("../diagnostics.json", window.location.href).href);
  } catch (error) {
    throw new Error(`the diagnostics declaration of the terminal view cannot be read: ${error?.message ?? error}`);
  }
  // default: a build that stages no diagnostics.json serves the request as not found, so the page has no diagnostic entry.
  if (!response.ok) return null;
  const declaration = await response.json();
  return { declaration, attach: (await import("./terminal-diagnostics.js")).attach };
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
        sidecar: () => ({
          send: (surface, body, cids) => calls.request("runtime.sidecar.send", { id: surface, body, cids }),
          on: (surface, fn) => runtime.sidecar().on(surface, fn),
          onFailure: (surface, fn) => runtime.sidecar().onFailure(surface, fn),
        }),
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
        clipboard: {
          read: (type) => calls.request("runtime.clipboard.read", type),
          writeText: (text) => calls.request("runtime.clipboard.writeText", text),
        },
        // The fields are built before the send, because a call carries values and not builders. The level gate of core
        // applies at delivery. The route of a view carries no cids (P49.5), so a record that names cids stores without its
        // chain join until core serves them.
        log: Object.fromEntries(LOG_LEVELS.map((level) => [level,
          (event, fields) => send("runtime.log", { level, event, fields: typeof fields === "function" ? fields() : fields })])),
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

// 스크롤바는 네이티브 그림 위의 DOM overlay 다. 뷰 오른쪽 가장자리에 놓는다. 네이티브 영역의 조상은 배경을 가질 수
// 없으므로(docs/spec/surface-composition.md) padding 은 변마다 overlay 띠로 칠한다. 크기는 터미널 설정이 정한다.
const css = `:host{display:block;height:100%;background:transparent;color:var(--fg);position:relative}#view{position:absolute;inset:0;outline:0;cursor:text}
#scrollbar{position:absolute;top:0;right:0;bottom:0}#scrollbar[hidden]{display:none}
.padding{position:absolute}.padding[hidden]{display:none}
#thumb{position:absolute;left:2px;right:2px;cursor:grab}#thumb[data-dragging]{cursor:grabbing}`;

/** Mounts the terminal of one view into root: the composition of the declared region and overlays, and the terminal session. */
export async function mount(root, context) {
  root.innerHTML = `<style>${css}</style><div id="view" data-expose="terminal.view" tabindex="0"></div>` +
    `<div id="scrollbar" hidden><div id="thumb"></div></div>` +
    ["top", "right", "bottom", "left"].map((side) => `<div id="padding-${side}" class="padding" hidden></div>`).join("");
  const view = root.querySelector("#view");
  const scrollbar = { track: root.querySelector("#scrollbar"), thumb: root.querySelector("#thumb") };
  const padding = Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, root.querySelector(`#padding-${side}`)]));
  const composition = await context.composition.create({ regions: { view }, overlays: { scrollbar: scrollbar.track,
    "padding-top": padding.top, "padding-right": padding.right, "padding-bottom": padding.bottom, "padding-left": padding.left } });
  const image = composition.region("view");
  const sidecar = context.runtime.sidecar();
  let controller;
  try {
    controller = await startTerminal({ id: context.surfaceId, closing: context.closing, view, padding, attachImage: () => image,
      detachRegions: () => composition.dispose(), sidecar, scrollbar,
      expose: context.exposure, window, theme: context.runtime.theme, settings: context.runtime.settings,
      textSize: context.runtime.textSize, tab: context.tab, origin: context.origin, project: context.project,
      links: context.runtime.links,
      reportSurfaceError: (error) => context.status.report("error", error),
      diagnostics: context.diagnostics,
      clipboard: context.runtime.clipboard,
      runtime: { log: context.runtime.log } });
    if (!controller || typeof controller.dispose !== "function") {
      throw new TypeError("startTerminal must return { dispose() }");
    }
  } catch (error) {
    try {
      await composition.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "terminal mount and composition cleanup failed");
    }
    throw error;
  }
  context.status.report("ready");
  // controller 의 dispose 는 composition 을 해제한 뒤 사이드카 세션을 끝낸다.
  return { focus: controller.focus, async dispose() {
    await controller.dispose();
    await context.exposure.dispose();
    root.replaceChildren();
  } };
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
const host = document.body.appendChild(document.createElement("div"));
host.style.cssText = "height:100%";
try {
  await mount(host.attachShadow({ mode: "open" }), context);
} catch (error) {
  report(`view terminal: mount failed: ${error?.message ?? error}`);
}
