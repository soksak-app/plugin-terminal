// The fixtures of the terminal view. The page module is the real ui/view.js, which the test loads into the view window with view.load(PAGE).
// The view window and the sok-view boundary are the view host of test/fixtures/host.mjs: it answers each call of the page by the
// wire contract, and it answers the sidecar of the terminal, the image region and the surface composition, which are the host side of
// the view. The declarations and the composition come from the plugin manifest, and the diagnostic declaration from diagnostics.json.
import { readFileSync } from "node:fs";
import { openViewWindow } from "./host.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../plugin.json", import.meta.url), "utf8"));
const diagnostics = JSON.parse(readFileSync(new URL("../../diagnostics.json", import.meta.url), "utf8"));

/** The page module of the terminal view, which the application serves as ui/terminal.html. */
export const PAGE = new URL("../../ui/view.js", import.meta.url);
/** The surface of the views of these tests, and the sidecar that plugin.json lists as its only dependency. */
export const SURFACE = "terminal-1";
const SIDECAR = Object.keys(manifest.dependencies)[0];
/** The exposure declarations of the plugin, and the declarations of a diagnostic build (the host merges diagnostics.json the same way). */
export const DECLARATIONS = manifest.exposes;
const DIAGNOSTIC_DECLARATIONS = {
  status: [...manifest.exposes.status, ...diagnostics.exposes.status],
  commands: [...manifest.exposes.commands, ...diagnostics.exposes.commands],
  element: manifest.exposes.element,
};
const DIAGNOSTIC_START = diagnostics;

/** The log levels of the page: each category writes its records at trace. */
const LOG_LEVELS = { lifecycle: "trace", input: "trace", call: "trace", io: "trace", frame: "trace" };

/** The settings of the plugin with their defaults, and the shell of the session. */
const settingsValues = () => ({
  ...Object.fromEntries(Object.entries(manifest.settings).map(([key, { default: value }]) => [key, value])),
  shell: "/bin/sh",
});

/** The theme of the window: the card tokens of the plugin's page, which the session receives as its colors. */
const THEME = { scheme: "dark", tokens: { "--card": "#ffffff", "--fg": "#252735", "--edge": "#d8dbe4", "--rail": "#5962e8" } };

/**
 * Opens the terminal view and loads its page. Options: diagnostic (whether the build is a diagnostic build), declarations (the exposure
 * declarations of the plugin, which the host checks each registration and binding against), sidecar (the function that answers each
 * body the view sends to the sidecar: its return value is the result, a throw is the error), image (the fixtures of the image region:
 * attach, focus, caret, text, detach), native (the host answers of runtime.native.call beyond the registrations), and faults (route names
 * that reject; an image call routes as composition.<call>). The view is closed when the test ends.
 */
export async function openTerminal(t, { diagnostic = true, declarations = diagnostic ? DIAGNOSTIC_DECLARATIONS : DECLARATIONS, sidecar = () => null, image = {}, native = {}, faults } = {}) {
  const start = { surface: SURFACE, params: null, origin: { directory: null }, project: null, declarations, diagnostics: diagnostic ? DIAGNOSTIC_START : null };
  const view = openViewWindow({
    plugin: manifest.id,
    surface: SURFACE,
    start,
    theme: THEME,
    declarations,
    sidecars: [SIDECAR],
    composition: manifest.surface.composition,
    sidecar,
    image: { attach: () => null, focus: () => null, caret: () => null, text: () => null, detach: () => null, ...image },
    native,
    faults,
    settings: settingsValues(),
    textSize: 1,
    levels: LOG_LEVELS,
  });
  t.after(() => view.close());
  await view.load(PAGE);
  // The host sends the theme of the window as a message after the page starts, and the page passes it to its listeners.
  view.push("theme", THEME);
  await view.settled();
  return view;
}

/** The names of the commands that the page registered through runtime.command.register, in order (the core entries left out). */
export const commandsRegistered = (view) => view.calls.filter(({ command }) => command === "runtime.command.register")
  .map(({ params }) => params.name).filter((name) => !name.startsWith("core."));

/** The element of the terminal that the page exposes as terminal.view, which the page mounts in the shadow root of its body. */
export function terminalElement(view) {
  const host = view.window.document.body.firstElementChild;
  return host.shadowRoot.querySelector('[data-expose="terminal.view"]');
}

// The request ids of the exposure relay of the test, which are unique in the process.
let exposureRequests = 0;

/** Sends an exposure request of the method with params to the view, and resolves with the result the page answered (or rejects with its error). */
export async function exposure(view, method, params) {
  const id = ++exposureRequests;
  view.push("exposure-request", { id, surface: SURFACE, method, params });
  await view.settled();
  const answer = view.calls.find((call) => call.command === "runtime.native.call" && call.params.name === "exposureReply" && call.params.payload.id === id);
  if (answer === undefined) throw new Error(`the page did not answer the exposure request ${method}`);
  const { error, result } = answer.params.payload;
  if (error !== undefined) throw new Error(error.message);
  return result;
}

/** The names of the image region calls of the view, in order, with their params. */
export const imageCalls = (view) => view.calls.filter((call) => call.command.startsWith("image.")).map(({ command, params }) => [command, params]);

/** The sends of the terminal to its sidecar session, in order: {id, body, cids}. */
export const sidecarSends = (view) => view.observed.sidecar.map(({ id, body, cids }) => ({ id, body, cids }));

/** Delivers a sidecar message of the session of the surface to the view, and waits until the page has handled it. */
export async function sidecarState(view, body) {
  view.sidecarMessage(SIDECAR, SURFACE, { body });
  await view.settled();
}

/** Delivers a region input event to the view, as the host delivers the input of the image region. */
export async function regionInput(view, event) {
  view.push("image-event", { name: "view", event });
  await view.settled();
}
