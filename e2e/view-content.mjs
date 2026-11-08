// Reads the shown content of a terminal view through the public value that holds it, and checks that the host presents the frame that
// shows it: the cell rows of terminal.screen.read whose frame the image region of the view presented.
import assert from "node:assert/strict";
import { valueProof } from "@soksak/window-check/view-content.mjs";
import { presentedScreen, textLines } from "./terminal-screen.mjs";

/** The text of the cell rows of the terminal view of surface, after its image region presented the frame that shows them. */
export async function readTerminalContent(s, surface) {
  const screen = await presentedScreen(s, surface);
  return textLines({ lines: screen.rows }).join("\n");
}

/** Reads the content of surface (readTerminalContent) and returns the proof that it holds expected (valueProof). */
export async function terminalContentProof(s, surface, expected) {
  return valueProof(expected, await readTerminalContent(s, surface), `terminal ${surface}`);
}

/**
 * The content case of a terminal tab: `ready(s, { tab })` waits until the tab registered its session and screen, writes a fixed line,
 * waits until the screen shows it and the view has an area, and returns the check that reads the content after the display.
 */
export function terminalContentCase(s, diagnostic) {
  const text = "SOKSAK TERMINAL CONTENT";
  const status = async (tab, name, predicate) => {
    await s.until("core.surfaces", all => all.some(item => item.surface === tab
      && item.exposes.includes(`status ${name}`)), `${tab} did not register ${name}`);
    return s.until(name, predicate, `${tab} did not reach ${name} readiness`, { surface: tab });
  };
  return { ready: async (_, { tab }) => {
    await status(tab, "terminal.session", value => value.sessionId && value.cols > 0 && value.rows > 0);
    await s.run("terminal.input", { bytes: `printf '${text}\\n'\r` }, tab);
    await status(tab, "terminal.screen", rows => rows.map(row => row.map(cell => cell.ch ?? " ").join("")).join("\n").includes(text));
    const rect = await s.rect("terminal.view", undefined, tab);
    assert.ok(rect.width > 0 && rect.height > 0, `${tab}: terminal.view has no visible area`);
    return async () => {
      await terminalContentProof(s, tab, text);
      diagnostic(`terminal ${tab} shows ${JSON.stringify(text)}`);
    };
  } };
}
