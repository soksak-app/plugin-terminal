// Start state of the window checks of this plugin (core docs/spec/plugins.md#window-checks-of-a-plugin). The run installs this plugin
// from its own packed release into each published application (scripts/test-app.mjs), with the fixture plugins of e2e/fixtures and no
// other real plugin. prepareFixture of @soksak/window-check opens the new-space layout that the environment of the application declares
// (workspace.grid); a tab of it that names a plugin that the configuration does not load opens as a placeholder, and the preparation
// replaces each placeholder by a tab of the start probe in the same card. The start tab is the active tab of the focused card, a terminal
// tab whose shell is a fixed fixture: the preparation adds one to that card when its active tab is not a terminal tab.
import { fileURLToPath } from "node:url";
import { prepareFixture, TRACE } from "@soksak/window-check/app.mjs";
import { recordCatalog } from "@soksak/window-check/catalog.mjs";
import { currentEventOffsets, readEvents, traceRows } from "@soksak/window-check/event-log.mjs";

/** The plugin under check. */
export const PLUGIN = "terminal";

/**
 * The fixture plugin of the tabs that are not terminal tabs: the start probe of e2e/fixtures/start-probe. It replaces each placeholder
 * of the start layout, and a check opens it to hide a terminal tab behind a tab of another plugin.
 */
export const PROBE = "startprobe";

/** The shells of the window-check terminal. They avoid a prompt that depends on the profile of the login shell. */
const SHELLS = {
  check: fileURLToPath(new URL("./check-shell", import.meta.url)),
  zsh: fileURLToPath(new URL("./check-zsh", import.meta.url)),
};

/** The shell fixture `shell` (`check`, or `zsh` for the tracked ZLE case) as the value of the setting `terminal.shell`. */
export function terminalCheckShell(shell = "check") {
  if (Object.hasOwn(SHELLS, shell)) return SHELLS[shell];
  throw new Error(`unsupported terminal check shell ${JSON.stringify(shell)}`);
}

/** The declaration `{ catalog, records }` of a wait on the records that a predicate reads. */
export const reading = (app, records) => ({ catalog: recordCatalog(app.configDir), records });

/**
 * The tabs of the layout `grid` (core.grid) that `surfaces` (core.surfaces) report as placeholders, as `{card, tab, plugin}` in the
 * order of the cards and their tabs.
 */
export function placeholderTabs(grid, surfaces) {
  const placeholders = new Set(surfaces.filter((row) => row.kind === "tab" && row.placeholder != null).map((row) => row.surface));
  return (grid?.cards ?? []).flatMap((card) => (card.tabs ?? []).filter((tab) => placeholders.has(tab.id))
    .map((tab) => ({ card: card.id, tab: tab.id, plugin: tab.plugin })));
}

/** Replaces every placeholder tab of the start layout by a tab of PROBE in its card; the new tab is added before the close. */
export async function replacePlaceholders(s) {
  for (const { card, tab } of placeholderTabs(await s.get("core.grid"), await s.get("core.surfaces"))) {
    await s.run("core.card.add-tab", { card, plugin: PROBE });
    await s.run("core.tab.close", { tab });
  }
}

/** Makes the active tab of the focused card a terminal tab: a card whose active tab is of another plugin gets a new terminal tab. */
export async function focusedTerminal(s) {
  const grid = await s.get("core.grid");
  const focused = grid?.cards.find((card) => card.focused);
  if (!focused) throw new Error(`the start layout has no focused card: ${JSON.stringify(grid?.cards ?? null)}`);
  const active = focused.tabs?.find((tab) => tab.id === focused.active);
  if (active?.plugin !== PLUGIN) await s.run("core.card.add-tab", { card: focused.id, plugin: PLUGIN });
}

/** Waits until the visible terminal surfaces are registered and apply their theme, then returns those surfaces. */
export async function terminalReady(s) {
  await s.until("core.surfaces",
    (all) => all.some((x) => x.visible && x.plugin === PLUGIN &&
      x.exposes.includes("status core.surface.document") &&
      x.exposes.includes("status terminal.session") &&
      x.exposes.includes("element terminal.view")),
    "no visible terminal surface registered its document, session, and view");
  // A notification that satisfies the predicate can describe the surface just before a reload replaces it. The function reads the
  // current registry before it returns the id, so it does not proceed with a stale surface id.
  const active = new Set((await s.get("core.grid")).cards.map((card) => card.active).filter(Boolean));
  const terminals = (await s.surfaces(PLUGIN)).filter((x) => active.has(x.surface) &&
    x.exposes.includes("status core.surface.document") &&
    x.exposes.includes("status terminal.session") &&
    x.exposes.includes("element terminal.view"));
  for (const terminal of terminals) {
    await s.until("core.surface.document", (doc) => doc !== null && doc.readyState === "complete" && doc.themed,
      `terminal ${terminal.surface} did not apply its theme`, { surface: terminal.surface });
  }
  return terminals;
}

/** The surface registration rows of the trace that the event log gained after the offsets. */
async function registrationTimeline(s, offsets) {
  await s.flushLog();
  return traceRows(readEvents(s.app.configDir, offsets).events).filter((row) => row.event === "surface.registration");
}

/**
 * Puts the window in the start state of a check and returns the start terminal, an entry of core.surfaces. `shell` is the shell fixture
 * (terminalCheckShell), `log` is the log policy that the check declares and `reads` the records below `error` that it reads
 * (prepareFixture); with the performance trace the registration timeline of a failed start is read too.
 */
export async function fresh(s, { performanceTrace = TRACE, settings = {}, log = {}, reads = [], shell = "check" } = {}) {
  const traceOffsets = currentEventOffsets(s.app.configDir);
  const declared = performanceTrace ? [...reads, "workbench.trace.surface.registration"] : reads;
  await prepareFixture(s, { settings: { ...settings, "terminal.shell": terminalCheckShell(shell) }, performanceTrace, log,
    reads: declared, catalog: declared.length ? recordCatalog(s.app.configDir) : undefined });
  let terminal;
  try {
    await replacePlaceholders(s);
    await focusedTerminal(s);
    [terminal] = await terminalReady(s);
  } catch (error) {
    if (!performanceTrace) throw error;
    throw new Error(`${error.message}; registration timeline: ${JSON.stringify(await registrationTimeline(s, traceOffsets))}`, { cause: error });
  }
  await s.presented();
  try {
    await s.get("terminal.session", terminal.surface);
  } catch (error) {
    throw new Error(`terminal readiness returned stale surface ${terminal.surface}: ${error.message}; ` +
      `current surfaces: ${JSON.stringify(await s.get("core.surfaces"))}`);
  }
  return terminal;
}
