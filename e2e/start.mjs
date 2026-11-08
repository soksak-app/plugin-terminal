// Start state of the window checks of this plugin: the start state of @soksak/window-check/start.mjs (core
// docs/spec/plugins.md#window-checks-of-a-plugin). The start layout that the environment of the application declares focuses a card
// with a terminal tab, which this plugin fills, so the start tab is that terminal tab; the start probe of window-check replaces each
// placeholder tab, the tab of a plugin that the run does not install, and a check selects it to hide a terminal tab. The shell of the
// terminal is a fixed fixture of this repository.
import { fileURLToPath } from "node:url";
import { fresh as start, START_PROBE } from "@soksak/window-check/start.mjs";

export { cardSidebar, reading } from "@soksak/window-check/start.mjs";

/** The plugin under check. */
export const PLUGIN = "terminal";

/** The tab of another plugin that a check selects to hide a terminal tab: the start probe of @soksak/window-check. */
export const PROBE = START_PROBE;

/** The entries that a terminal tab has registered when a check can read its document, its session and its view. */
export const TERMINAL_ENTRIES = Object.freeze(["status core.surface.document", `status ${PLUGIN}.session`, `element ${PLUGIN}.view`]);

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

/** Waits until the document of the terminal tab `surface` applied the theme. */
export async function terminalThemed(s, surface) {
  await s.until("core.surface.document", (doc) => doc !== null && doc.readyState === "complete" && doc.themed,
    `terminal ${surface} did not apply its theme`, { surface });
}

/**
 * Puts the window in the start state of a check and returns the start terminal tab `{surface, plugin}`: window-check fresh with the
 * terminal tab of the focused card as its start tab, which registered TERMINAL_ENTRIES and applied the theme, the start probe in place
 * of each placeholder tab and the shell fixture `shell` (terminalCheckShell) as `terminal.shell`. The other options are those of
 * window-check fresh.
 */
export async function fresh(s, { shell = "check", ...options } = {}) {
  const tab = await start(s, { startPlugin: PLUGIN, startEntries: TERMINAL_ENTRIES, placeholderPlugin: START_PROBE, ...options,
    settings: { ...options.settings, [`${PLUGIN}.shell`]: terminalCheckShell(shell) } });
  await terminalThemed(s, tab.surface);
  return tab;
}
