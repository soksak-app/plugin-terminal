// The window checks of the terminal surface: its PTY children and shells, padding, titles, notifications, links, history, input and
// output through the terminal sidecar, inline images, theme, cursor, font, native drags, selection, paste, file drop, diagnostic
// entries, session errors and fixed cells during a divider drag.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

// The application menu is built from one ko/en table, so the check follows the menu language.
const MENU_TITLES = {
  ko: { menu: "보기", larger: "글자 크게" },
  en: { menu: "View", larger: "Bigger Text" },
};
const largerTitle = async (s) => MENU_TITLES[(await s.get("host.menu")).language] ?? MENU_TITLES.en;

import { APPS, drag, failure, open } from "@soksak/window-check/app.mjs";
import { recordCatalog } from "@soksak/window-check/catalog.mjs";
import { assertHeldStatesShown } from "@soksak/window-check/drag-measurement.mjs";
import { frames, pixel, readFrame } from "@soksak/window-check/frame.mjs";
import { fresh } from "./start.mjs";
import { glyphShape, surfaceBoxes, whitePixels } from "./outside.mjs";
import { terminalProcessSnapshot } from "./terminal-processes.mjs";
import {
  cellBackgrounds, ensureTerminals, isColor, MEASURED_BACKGROUND, readScreenUntil, selectionBackground, setMeasuredBackground, terminalBackgroundSample,
} from "./terminal-screen.mjs";

// A 1x1 RGBA PNG image.
const PNG = Buffer.from("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C63000100000500010D0A2DB40000000049454E44AE426082", "hex");


async function closeTerminalTabs(session) {
  const grid = await session.get("core.grid");
  for (const tab of grid.cards.flatMap((card) => card.tabs).filter((tab) => tab.plugin === "terminal")) {
    await session.run("core.tab.close", { tab: tab.id });
  }
}

async function terminalCursorCell(session, surface) {
  await session.presented();
  await session.request("diagnostics.capture.start", {});
  const displayed = await session.presented();
  const { frames: frameDir } = await session.request("diagnostics.capture.stop", { after: displayed.displayed });
  const files = frames(frameDir);
  assert.ok(files.length > 0, "cursor policy capture produced no frames");
  const frame = readFrame(files.at(-1));
  const host = await session.get("host.window");
  const region = host.regions.find((item) => item.surface === surface && item.name === "view");
  assert.ok(region?.frame, `native terminal region ${surface} has no frame`);
  const cursor = await session.get("terminal.cursor", surface);
  const state = await session.get("terminal.session", surface);
  const x0 = Math.max(0, Math.round((region.frame.x + cursor.col * state.cellWidth) * frame.scale));
  const y0 = Math.max(0, Math.round((region.frame.y + cursor.row * state.cellHeight) * frame.scale));
  const x1 = Math.min(frame.width, x0 + Math.ceil(state.cellWidth * frame.scale));
  const y1 = Math.min(frame.height, y0 + Math.ceil(state.cellHeight * frame.scale));
  const pixels = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.push(pixel(frame, x, y));
  const surfaceX = Math.max(0, Math.round(region.frame.x * frame.scale));
  const surfaceY = Math.max(0, Math.round(region.frame.y * frame.scale));
  const surfaceWidth = Math.min(frame.width - surfaceX, Math.ceil(region.frame.width * frame.scale));
  const surfaceHeight = Math.min(frame.height - surfaceY, Math.ceil(region.frame.height * frame.scale));
  const surfacePixels = [];
  for (let y = surfaceY; y < surfaceY + surfaceHeight; y++) {
    for (let x = surfaceX; x < surfaceX + surfaceWidth; x++) surfacePixels.push(pixel(frame, x, y));
  }
  rmSync(frameDir, { recursive: true, force: true });
  return { cell: pixels, surface: surfacePixels };
}

async function terminalFrame(session) {
  await session.request("diagnostics.capture.start", {});
  const displayed = await session.presented();
  const { frames: frameDir } = await session.request("diagnostics.capture.stop", { after: displayed.displayed });
  try {
    const files = frames(frameDir);
    assert.ok(files.length > 0, "terminal selection capture produced no frames");
    return readFrame(files.at(-1));
  } finally {
    rmSync(frameDir, { recursive: true, force: true });
  }
}

async function terminalColorBounds(session, surface, color) {
  const frame = await terminalFrame(session);
  const host = await session.get("host.window");
  const region = host.regions.find((item) => item.surface === surface && item.name === "view");
  assert.ok(region?.frame, `native terminal region ${surface} has no frame`);
  const scale = frame.scale;
  const x0 = Math.max(0, Math.round(region.frame.x * scale));
  const y0 = Math.max(0, Math.round(region.frame.y * scale));
  const x1 = Math.min(frame.width, Math.ceil((region.frame.x + region.frame.width) * scale));
  const y1 = Math.min(frame.height, Math.ceil((region.frame.y + region.frame.height) * scale));
  let count = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  // Counts the colors of the region so that a failure shows what was drawn.
  const histogram = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = pixel(frame, x, y);
      const key = px.slice(0, 3).join(",");
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
      const matches = color === "red"
        ? px[0] >= 180 && px[1] <= 80 && px[2] <= 80
        : px[0] <= 80 && px[1] <= 80 && px[2] >= 180;
      if (matches) {
        count++;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const colors = [...histogram].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([rgb, n]) => `${rgb}×${n}`).join(" ");
  return { count, minY, maxY, measured: `region ${JSON.stringify(region.frame)} presented ${JSON.stringify(region.presented)}; colors ${colors}` };
}

function differentPixels(before, after) {
  return before.reduce((count, value, index) => count +
    (value.some((channel, channelIndex) => channel !== after[index]?.[channelIndex]) ? 1 : 0), 0);
}

async function assertGridFillsPlane(session, message) {
  const grid = await session.get("core.grid");
  assert.ok(grid?.plane, `${message}: grid has no plane measurement`);
  assert.equal(Math.round(grid.width), Math.round(grid.plane.w),
    `${message}: grid width ${grid.width} does not fill plane width ${grid.plane.w}`);
  assert.equal(Math.round(grid.height), Math.round(grid.plane.h),
    `${message}: grid height ${grid.height} does not fill plane height ${grid.plane.h}`);
}

for (const app of Object.values(APPS)) {
  test(`${app.name}: closing terminal tabs reaps every PTY child without killing the shared service`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const grid = await s.get("core.grid");
    const tab = grid.cards.flatMap((card) => card.tabs).find((item) => item.plugin === "terminal");
    assert.ok(tab, "the fixture must contain a terminal tab");
    await s.run("core.tab.select", { tab: tab.id });
    const terminals = await ensureTerminals(s, 3);
    assert.equal(terminals.length, 3, "the close test requires three terminal sessions");
    await s.presented();

    const before = terminalProcessSnapshot(app.configDir);
    assert.equal(before.shells.length, 3, "three open terminal sessions must own three PTY children");

    await closeTerminalTabs(s);
    // Layout settlement does not await project persistence. Flush awaits tab
    // cleanup and the persistent service's authoritative retain response.
    await s.run("core.projects.flush");
    await s.until(
      "core.surfaces",
      (current) => current.every((surface) => surface.plugin !== "terminal"),
      "terminal surfaces did not close",
    );
    const after = terminalProcessSnapshot(app.configDir);
    assert.equal(after.service, before.service, "closing tabs must not recreate the shared terminal service");
    assert.deepEqual(after.shells, [], "completed layout retention must reap every PTY child");
  });

  test(`${app.name}: padding settings inset the terminal grid and show the terminal background`, { timeout: 120000 }, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    await setMeasuredBackground(s, surface);
    const padding = { top: 6, right: 10, bottom: 14, left: 18 };
    const set = (side, value) => s.run("core.settings.change", { key: `terminal.padding.${side}`, value, scope: "common" });
    s.cleanup(async () => {
      for (const side of Object.keys(padding)) await set(side, 0);
    });
    const before = await s.rect("terminal.view", undefined, surface);
    const { cols, rows } = await s.get("terminal.session", surface);
    for (const [side, value] of Object.entries(padding)) await set(side, value);
    // The grid is set again to fit the drawing region inside the padding.
    await s.until("terminal.session", (session) => session.cols < cols && session.rows < rows,
      "the terminal grid did not shrink inside the padding", { surface });
    const view = await s.rect("terminal.view", undefined, surface);
    const inset = { top: view.y - before.y, right: before.x + before.width - (view.x + view.width),
      bottom: before.y + before.height - (view.y + view.height), left: view.x - before.x };
    assert.deepEqual(inset, padding, `the view is not inset by the padding: ${JSON.stringify({ before, view })}`);
    // The native drawing region follows the inner region.
    const frame = { x: view.document.x + view.x, y: view.document.y + view.y, width: view.width, height: view.height };
    await s.until("host.window", (window) => window.regions.some((region) => region.surface === surface &&
      Object.keys(frame).every((key) => Math.abs(region.frame[key] - frame[key]) <= 1)),
      `the image region did not follow the padded view ${JSON.stringify(frame)}`);
    // The padding area has the default background color of the terminal.
    await s.request("diagnostics.capture.start", {});
    const { displayed } = await s.presented();
    const { frames: dir } = await s.request("diagnostics.capture.stop", { after: displayed });
    try {
      const files = frames(dir);
      assert.ok(files.length > 0, "the padding capture produced no frames");
      const shot = readFrame(files.at(-1));
      const at = (x, y) => pixel(shot, Math.round(x * shot.scale), Math.round(y * shot.scale));
      const samples = {
        left: at(frame.x - padding.left / 2, frame.y + frame.height / 2),
        top: at(frame.x + frame.width / 2, frame.y - padding.top / 2),
      };
      t.diagnostic(`padding samples ${JSON.stringify(samples)}`);
      for (const [side, sample] of Object.entries(samples)) {
        assert.ok(sample.every((value, index) => Math.abs(value - MEASURED_BACKGROUND[index]) <= 8),
          `the ${side} padding does not show the terminal background: ${sample}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${app.name}: the login shell setting starts the account's login shell as a login shell`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    s.cleanup(() => closeTerminalTabs(s));
    const existing = await ensureTerminals(s, 1);
    await s.run("core.settings.change", { key: "terminal.shell", value: "login", scope: "common" });
    // A setting applies to sessions that open after it. Opens a new terminal.
    const terminals = await ensureTerminals(s, existing.length + 1);
    const opened = terminals.find((terminal) => !existing.some((item) => item.surface === terminal.surface));
    assert.ok(opened, "no new terminal opened after the setting changed");
    const expected = `-${basename(userInfo().shell)}`;
    await s.run("terminal.input", { bytes: "printf 'ARGV0=%s\\n' \"$0\"\r" }, opened.surface);
    await readScreenUntil(s, opened.surface, (lines) => lines.some((line) => line.trim() === `ARGV0=${expected}`),
      `the new terminal did not start ${userInfo().shell} as a login shell (argv0 ${expected})`);
  });

  for (const shell of ["/bin/zsh", "/bin/bash"]) {
    test(`${app.name}: a resize redraws a wrapped ${basename(shell)} input line without rows of the previous width`, async (t) => {
      const s = await open(t, app);
      await fresh(s);
      s.cleanup(() => closeTerminalTabs(s));
      const existing = await ensureTerminals(s, 1);
      await s.run("core.settings.change", { key: "terminal.shell", value: shell, scope: "common" });
      const terminals = await ensureTerminals(s, existing.length + 1);
      const opened = terminals.find((terminal) => !existing.some((item) => item.surface === terminal.surface));
      assert.ok(opened, "no new terminal opened after the setting changed");
      // The shell integration must report the first prompt so that a size change erases the prompt rows.
      await s.until("terminal.session", (session) => session.vendor?.shell?.marker === "prompt.start",
        `${shell} did not report an OSC 133 prompt start`, { surface: opened.surface });
      const { cols } = await s.get("terminal.session", opened.surface);
      // Rows of the screen state omit the trailing default cells, so each row is padded to the column count. Joining the rows after the output row gives the logical row of the prompt.
      const rowsOf = (lines, width) => lines.map((row) => row.map((cell) =>
        cell.ch === undefined ? " ".repeat(cell.width) : cell.ch).join("").padEnd(width, " "));
      // The output row directly above the prompt must also stay after the size change. A wrong number of rows that the shell moves up overwrites this row.
      const above = "ABOVE-LINE";
      await s.run("terminal.input", { bytes: `printf '${above}\\n'\r` }, opened.surface);
      await s.until("terminal.screen", (lines) => {
        const rows = rowsOf(lines, cols);
        const index = rows.lastIndexOf(above.padEnd(cols, " "));
        return index >= 0 && rows[index + 1]?.trim().length > 0;
      }, `${shell} did not show a prompt after the output line`, { surface: opened.surface });
      // Makes the input take close to two rows without running it. The blanks are only at the start, so they do not fall on a row boundary.
      const input = `true START-${"x".repeat(Math.max(20, cols - 20))}-END`;
      await s.run("terminal.input", { bytes: input }, opened.surface);
      const promptLine = (rows, width) => {
        const index = rows.lastIndexOf(above.padEnd(width, " "));
        return index < 0 ? null : { row: index + 1, text: rows.slice(index + 1).join("") };
      };
      // A reflow that narrows the screen keeps the cursor row and moves the rows above it into the history (the prompt with a project folder path
      // takes several rows at a narrow width). The order of the output row and the prompt is read from the history and the screen in sequence. The history is read
      // by moving the viewport with a declared command and then returns to the latest output.
      const history = async (width) => {
        const { scrollback, rows } = await s.get("terminal.session", opened.surface);
        if (scrollback.history === 0) return [];
        assert.ok(scrollback.history <= rows, `${scrollback.history} history rows do not fit one screen of ${rows} rows`);
        await s.run("terminal.scrollback.set", { offset: scrollback.history }, opened.surface);
        await s.until("terminal.session", (value) => value.scrollback.offset === scrollback.history,
          "the viewport did not move to the oldest history row", { surface: opened.surface });
        const earlier = rowsOf(await s.get("terminal.screen", opened.surface), width).slice(0, scrollback.history);
        await s.run("terminal.scrollback.set", { offset: 0 }, opened.surface);
        await s.until("terminal.session", (value) => value.scrollback.offset === 0,
          "the viewport did not return to the newest output", { surface: opened.surface });
        return earlier;
      };
      // The prompt and the input must continue once on the row right after the output row, and the cursor must be at the end of the input.
      const consistent = async (width, label, prompt) => {
        let measured = "";
        // When the shell redraws, the input appears once on the screen. Before the redraw the engine has erased the prompt row, so
        // there is none. The screen must be of the new width: the message of the width before the change also shows the input
        // once, and a cursor position read from it belongs to the old layout.
        try {
          await s.until("terminal.screen", (lines) => {
            const rows = rowsOf(lines, width);
            const count = rows.join("").split("START-").length - 1;
            measured = `START- ${count} times in ${JSON.stringify(rows.join("").trimEnd())}`;
            return count === 1 && rows.join("").includes(input) && rows.every((row) => row.length === width);
          }, `${label}: the screen did not show the input once`, { surface: opened.surface });
        } catch (error) {
          const { vendor } = await s.get("terminal.session", opened.surface);
          throw new Error(`${label}: the input is not shown once: ${measured}; last shell mark ${JSON.stringify(vendor?.shell)}`);
        }
        // The shell erases its line and draws it again in separate writes, so the cursor stands at the end of the input only
        // when the drawing finished; the rows are read after the cursor, never between the erasing and the drawing.
        const drawn = rowsOf(await s.get("terminal.screen", opened.surface), width);
        const end = drawn.join("").indexOf(input) + input.length;
        try {
          await s.until("terminal.cursor",
            (value) => value.row === Math.floor(end / width) && value.col === end % width,
            `${label}: the cursor is not after the input end at row ${Math.floor(end / width)} col ${end % width}`,
            { surface: opened.surface });
        } catch (error) {
          const { scrollback, cols: liveCols } = await s.get("terminal.session", opened.surface);
          const rows = rowsOf(await s.get("terminal.screen", opened.surface), width);
          error.message += `; the session holds cols ${liveCols} with scrollback ${JSON.stringify(scrollback)} ` +
            `and rows ${JSON.stringify(rows.map((row) => row.trimEnd()))}`;
          throw error;
        }
        const earlier = await history(width);
        const current = rowsOf(await s.get("terminal.screen", opened.surface), width);
        const all = [...earlier, ...current];
        const line = promptLine(all, width);
        const count = all.join("").split("START-").length - 1;
        const starts = line && (prompt === undefined ? line.text.indexOf(input) > 0 : line.text.startsWith(prompt + input));
        assert.ok(count === 1 && starts, `${label}: the prompt line does not follow ${above} once: START- ${count} times in ` +
          `${JSON.stringify(all.map((row) => row.trimEnd()))} (${earlier.length} history rows)`);
        return line.text.slice(0, line.text.indexOf(input));
      };
      const prompt = await consistent(cols, "before the resize");
      const grid = await s.get("core.grid");
      const card = grid.cards.find((item) => item.active === opened.surface);
      assert.ok(card && card.c0 > 0, "the new terminal card has no left boundary");
      const start = grid.lines.x[card.c0];
      await s.run("core.boundary.move", { axis: "x", line: card.c0, position: start + Math.round(card.w / 2) });
      const narrow = (await s.until("terminal.session", (session) => session.cols < cols,
        "the terminal did not narrow", { surface: opened.surface })).cols;
      await consistent(narrow, `after narrowing to ${narrow} columns`, prompt);
      await s.run("core.boundary.move", { axis: "x", line: card.c0, position: start });
      await s.until("terminal.session", (session) => session.cols === cols,
        "the terminal did not return to its width", { surface: opened.surface });
      await consistent(cols, `after widening to ${cols} columns`, prompt);
      // Dragging the boundary changes the size repeatedly, also while the shell redraws.
      await drag(s, { axis: "x", line: card.c0, dx: Math.round(card.w / 2), dy: 0, ms: 96, times: 1 });
      await s.until("terminal.session", (session) => session.cols === cols,
        "the terminal did not return to its width after the drag", { surface: opened.surface });
      await consistent(cols, `after a divider drag`, prompt);
    });
  }

  test(`${app.name}: the terminal tab shows the program title unless the title setting is name`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    s.cleanup(() => closeTerminalTabs(s));
    const [terminal] = await ensureTerminals(s, 1);
    const label = (grid) => grid.cards.flatMap((card) => card.tabs).find((tab) => tab.id === terminal.surface)?.label;
    await s.run("terminal.input", { bytes: "printf '\\033]2;TITLE-CHECK\\007'\r" }, terminal.surface);
    await s.until("core.grid", (grid) => label(grid) === "TITLE-CHECK",
      "the tab did not show the program title", { timeout: 10000 });
    await s.run("core.settings.change", { key: "terminal.title", value: "name", scope: "common" });
    await s.until("core.grid", (grid) => label(grid) === null, "the name setting kept the program title");
    await s.run("core.settings.change", { key: "terminal.title", value: "program", scope: "common" });
    await s.until("core.grid", (grid) => label(grid) === "TITLE-CHECK", "the program setting did not show the last title");
    // Resetting the title (an empty title) returns to the tab name.
    await s.run("terminal.input", { bytes: "printf '\\033]2;\\007'\r" }, terminal.surface);
    await s.until("core.grid", (grid) => label(grid) === null, "an empty program title did not remove the title");
  });

  test(`${app.name}: an OSC 9 notification from a terminal out of view becomes a tab notice until the tab is in view`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    s.cleanup(() => closeTerminalTabs(s));
    const [shown, hidden] = await ensureTerminals(s, 2);
    const cardOf = (grid, surface) => grid.cards.find((card) => card.tabs.some((tab) => tab.id === surface));
    const notice = (grid, surface) => cardOf(grid, surface).tabs.find((tab) => tab.id === surface).notice;
    await s.run("core.card.focus", { card: cardOf(await s.get("core.grid"), shown.surface).id });
    await s.until("core.grid", (grid) => cardOf(grid, shown.surface).focused, "the first terminal card did not take focus");
    // No notification is kept for a visible tab (the active tab of the focused card).
    await s.run("terminal.input", { bytes: "printf '\\033]9;SHOWN-NOTICE\\007'\r" }, shown.surface);
    await s.until("terminal.session", (session) => session.vendor?.notification === "SHOWN-NOTICE",
      "the focused terminal did not receive its notification", { surface: shown.surface });
    assert.equal(notice(await s.get("core.grid"), shown.surface), null, "the tab in view received a notice");
    await s.run("terminal.input", { bytes: "printf '\\033]9;NOTICE-CHECK\\007'\r" }, hidden.surface);
    await s.until("core.grid", (grid) => notice(grid, hidden.surface) === "NOTICE-CHECK",
      "the terminal out of view did not show a tab notice", { timeout: 10000 });
    await s.run("core.card.focus", { card: cardOf(await s.get("core.grid"), hidden.surface).id });
    await s.until("core.grid", (grid) => notice(grid, hidden.surface) === null,
      "the notice stayed after the tab came into view");
  });

  test(`${app.name}: an OSC 9 notification from a terminal out of view follows the system policy and then the tab policy`, async (t) => {
      const s = await open(t, app);
      await fresh(s);
      s.cleanup(() => closeTerminalTabs(s));
      const [shown, hidden] = await ensureTerminals(s, 2);
      const cardOf = (grid, surface) => grid.cards.find((card) => card.tabs.some((tab) => tab.id === surface));
      await s.run("core.card.focus", { card: cardOf(await s.get("core.grid"), shown.surface).id });
      await s.until("core.grid", (grid) => cardOf(grid, shown.surface).focused, "the first terminal card did not take focus");
      await s.run("core.settings.change", { key: "terminal.notifications", value: "system", scope: "common" });
      await s.run("terminal.input", { bytes: "printf '\\033]9;SYSTEM-POLICY\\007'\r" }, hidden.surface);
      await s.until("terminal.session", (session) => session.vendor?.notification === "SYSTEM-POLICY",
        "the system notification policy did not reach the terminal", { surface: hidden.surface });
      // The result of the system policy is one of: posted, native error, or denied permission. A denial is reported only through the permission state, without a post or an error
      // (V5-111). The notification permission of the application bundle is set only when the user answers the system question.
      const decided = (state) => state.posted.includes(hidden.surface) || state.error !== null || state.authorization === "denied";
      try {
        await s.until("core.notifications", decided,
          "the system notification policy produced neither a post, a native error, nor a denied authorization", { timeout: 10000 });
      } catch (error) {
        const state = await s.get("core.notifications");
        if (state.authorization === "notDetermined") {
          throw new Error(`${app.name}: the notification authorization of this application is not decided; answer its system notification prompt once`, { cause: error });
        }
        throw error;
      }
      assert.equal((await s.get("core.grid")).cards.flatMap((card) => card.tabs).find((tab) => tab.id === hidden.surface).notice,
        null, "the system notification policy fell back to a tab notice");
      await s.run("core.settings.change", { key: "terminal.notifications", value: "tab", scope: "common" });
      const posted = (await s.get("core.notifications")).posted.length;
      await s.run("terminal.input", { bytes: "printf '\\033]9;TAB-NOTICE\\007'\r" }, hidden.surface);
      const notice = (grid, surface) => grid.cards.find((card) => card.tabs.some((tab) => tab.id === surface)).tabs.find((tab) => tab.id === surface).notice;
      await s.until("core.grid", (grid) => notice(grid, hidden.surface) === "TAB-NOTICE",
        "the terminal out of view did not show a tab notice", { timeout: 10000 });
      assert.equal((await s.get("core.notifications")).posted.length, posted, "the tab policy posted a system notification");
      await s.run("core.card.focus", { card: cardOf(await s.get("core.grid"), hidden.surface).id });
      await s.until("core.grid", (grid) => notice(grid, hidden.surface) === null,
        "the tab notice stayed after the tab came into view");
    });

  test(`${app.name}: OSC 8 linked cells are drawn with an underline and plain cells are not`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    s.cleanup(() => closeTerminalTabs(s));
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    await s.run("terminal.input", {
      bytes: "clear; printf '\\033]8;;https://example.com/\\007LINKED\\033]8;;\\007 PLAINS\\n'\r",
    }, surface);
    const lines = await readScreenUntil(s, surface, (screen) => screen.includes("LINKED PLAINS"), "the link row did not render");
    const row = lines.indexOf("LINKED PLAINS");
    const session = await s.get("terminal.session", surface);
    await s.request("diagnostics.capture.start", {});
    const displayed = await s.presented();
    const { frames: directory } = await s.request("diagnostics.capture.stop", { after: displayed.displayed });
    try {
      const files = frames(directory);
      assert.ok(files.length > 0, "the capture produced no frames");
      const frame = readFrame(files.at(-1));
      const region = (await s.get("host.window")).regions.find((item) => item.surface === surface && item.name === "view");
      const scale = frame.scale;
      const background = pixel(frame, Math.round((region.frame.x + 20.5 * session.cellWidth) * scale),
        Math.round((region.frame.y + (row + 0.5) * session.cellHeight) * scale));
      // In the lower quarter of the cell, counts the pixels of the one pixel row that has the most pixels different from the background. An underline is a row that fills the whole cell width,
      // and the lower end of a glyph fills only a part of a row.
      const fullestRow = (column0, column1) => {
        const top = Math.round((region.frame.y + (row + 0.75) * session.cellHeight) * scale);
        const bottom = Math.round((region.frame.y + (row + 1) * session.cellHeight) * scale);
        const left = Math.round((region.frame.x + column0 * session.cellWidth) * scale);
        const right = Math.round((region.frame.x + column1 * session.cellWidth) * scale);
        let fullest = 0;
        for (let y = top; y < bottom; y++) {
          let count = 0;
          for (let x = left; x < right; x++) {
            if (pixel(frame, x, y).some((channel, index) => Math.abs(channel - background[index]) > 40)) count++;
          }
          fullest = Math.max(fullest, count);
        }
        return fullest;
      };
      const width = Math.round(6 * session.cellWidth * scale);
      const linked = fullestRow(0, 6);
      const plain = fullestRow(7, 13);
      assert.ok(linked >= width * 0.9, `the fullest row below the linked text has ${linked} of ${width} pixels`);
      assert.ok(plain < width * 0.75, `the fullest row below the plain text has ${plain} of ${width} pixels`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test(`${app.name}: clear leaves no history and hides the scrollbar`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    s.cleanup(() => closeTerminalTabs(s));
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    await s.run("terminal.input", { bytes: "i=0; while [ $i -lt 60 ]; do echo row$i; i=$((i+1)); done\r" }, surface);
    await s.until("terminal.session", (session) => session.scrollback?.history > 0, "the rows did not exceed the screen", { surface });
    // macOS clear sends ED 3 and ED 2. Runs the command exactly as the user reported it.
    await s.run("terminal.input", { bytes: "clear; printf '\\n한\\n'\r" }, surface);
    await readScreenUntil(s, surface, (lines) => lines.some((line) => line.trim() === "한"), "the output after clear did not render");
    const session = await s.until("terminal.session", (value) => value.scrollback?.history === 0,
      "clear left lines in the history", { surface });
    const track = await s.rect("terminal.scrollbar", undefined, surface);
    assert.equal(track.width, 0, `the scrollbar is shown without history: ${JSON.stringify({ track, scrollback: session.scrollback })}`);
  });

  test(`${app.name}: terminal input returns terminal output through the terminal sidecar`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    await assertGridFillsPlane(s, "initial terminal layout");

    // Activates the terminal tab. core.grid is a status, so the card and tab come from a status read.
    const grid = await s.get("core.grid");
    const card = grid.cards.find((c) => c.tabs.some((tab) => tab.plugin === "terminal"));
    assert.ok(card, "terminal tab not found");
    const terminalTab = card.tabs.find((tab) => tab.plugin === "terminal");

    // Runs the command that selects the terminal tab.
    await s.run("core.tab.select", { tab: terminalTab.id });

    // Waits until the terminal session is ready.
    let terminalSurface;
    await s.until(
      "core.surfaces",
      (surfaces) => {
        const terminal = surfaces.find(
          (surf) => surf.visible && surf.plugin === "terminal" &&
            surf.exposes.includes("status terminal.session")
        );
        if (!terminal) return false;
        terminalSurface = terminal.surface;
        return true;
      },
      "terminal surface did not become visible"
    );

    // Waits until the terminal sessionId exists.
    await s.until(
      "terminal.session",
      (session) => session.sessionId !== "",
      "terminal session did not report sessionId",
      { surface: terminalSurface }
    );
    await setMeasuredBackground(s, terminalSurface);

    // Sends the command.
    await s.run("terminal.input", { bytes: "echo hi\r" }, terminalSurface);

    // Waits until the output line is read.
    // Confirms that the screen was read.
    const screenLines = await readScreenUntil(
      s,
      terminalSurface,
      (screen) => screen.some((line) => line.trim() === "hi"),
      'terminal output does not contain "hi"'
    );

    // Confirms with a window capture that glyphs appeared in the terminal region.
    const terminalRect = await s.rect("terminal.view", undefined, terminalSurface);
    const capture = await s.request("diagnostics.capture.start", {});

    // Stops the capture immediately and records the frames up to the last display time.
    const { frames: frameDir } = await s.request("diagnostics.capture.stop", {
      after: (await s.presented()).displayed,
    });

    s.cleanup(async () => {
      await closeTerminalTabs(s);
      rmSync(frameDir, { recursive: true, force: true });
    });

    const frameFiles = frames(frameDir);
    assert.ok(frameFiles.length > 0, "no frames were captured");

    // Reads the last frame.
    const lastFramePath = frameFiles[frameFiles.length - 1];
    const frame = readFrame(lastFramePath);

    // Confirms that the native IOSurface covers the terminal region and glyphs appeared.
    const BG_COLOR = MEASURED_BACKGROUND;
    const COLOR_TOLERANCE = 10;
    const BRIGHT_TEXT_THRESHOLD = 160;
    const BRIGHT_TEXT_MIN = 20;
    const BG_SAMPLE_RATIO_MIN = 0.5;

    // Window coordinates are points and the frame is in device pixels, so multiplies by the frame scale.
    const termX = Math.round(terminalRect.x * frame.scale);
    const termY = Math.round(terminalRect.y * frame.scale);
    const termWidth = Math.round(terminalRect.width * frame.scale);
    const termHeight = Math.round(terminalRect.height * frame.scale);

    let bgPixelCount = 0;
    let totalSampleCount = 0;
    let brightTextCount = 0;

    // Samples one of every two pixels and counts the background ratio and the number of bright pixels.
    for (let y = termY; y < termY + termHeight; y += 2) {
      for (let x = termX; x < termX + termWidth; x += 2) {
        if (y < 0 || y >= frame.height || x < 0 || x >= frame.width) continue;
        const px = pixel(frame, x, y);
        totalSampleCount++;

        // (a) number of background color pixels
        const isBG = px.every((v, i) => Math.abs(v - BG_COLOR[i]) <= COLOR_TOLERANCE);
        if (isBG) bgPixelCount++;

        // (b) number of bright pixels
        const brightness = (px[0] + px[1] + px[2]) / 3;
        if (brightness >= BRIGHT_TEXT_THRESHOLD) brightTextCount++;
      }
    }

    const bgRatio = totalSampleCount > 0 ? bgPixelCount / totalSampleCount : 0;
    assert.ok(
      bgRatio >= BG_SAMPLE_RATIO_MIN,
      `terminal IOSurface not detected: ${(bgRatio * 100).toFixed(1)}% background (need >= ${(BG_SAMPLE_RATIO_MIN * 100).toFixed(0)}%)`
    );
    assert.ok(
      brightTextCount >= BRIGHT_TEXT_MIN,
      `terminal text not visible: ${brightTextCount} bright pixels (need >= ${BRIGHT_TEXT_MIN})`
    );
  });

  test(`${app.name}: inline image pixels follow scroll, resize, replacement, deletion, and cleanup`, { timeout: 30000 }, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    s.cleanup(() => closeTerminalTabs(s));
    await s.until("terminal.session", (state) => Boolean(state?.sessionId && state.rows > 8),
      "inline-image terminal session did not open", { surface });
    // Types after the shell prints the prompt. The terminal shows input from before that once first.
    await readScreenUntil(s, surface, (lines) => lines.some((line) => line.includes("$")), "the shell prompt did not appear");

    const red = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwH4QBEfcD/ePF9e8AAAAASUVORK5CYII=";
    const blue = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGNgYPj/H4QBDfsD/Yde1YcAAAAASUVORK5CYII=";
    const name = "cGxvdA==";
    const image = (data) => `printf '\\033[6;1H\\033]1337;File=name=${name};inline=1;width=4px;height=4px:${data}\\a'`;
    const redInput = `${image(red)}\r`;
    await s.run("terminal.input", { bytes: redInput }, surface);
    await s.until("terminal.session", (state) => state.inlineImages?.includes("plot"),
      "inline image display event was not observed", { surface });
    const beforeScroll = await terminalColorBounds(s, surface, "red");
    assert.ok(beforeScroll.count >= 2, `red inline image did not reach native pixels: ${beforeScroll.count}; ${beforeScroll.measured}`);
    t.diagnostic(`${app.name}: inline image displayed ${beforeScroll.count} red pixels`);

    await s.run("terminal.input", { bytes: "i=0; while [ $i -lt 100 ]; do printf '\\n'; i=$((i+1)); done; printf '\\nSCROLL_DONE\\n'\r" }, surface);
    await readScreenUntil(s, surface, (lines) => lines.includes("SCROLL_DONE"),
      "terminal did not finish the scroll fixture");
    const afterScroll = await terminalColorBounds(s, surface, "red");
    t.diagnostic(`${app.name}: after scroll red pixels ${afterScroll.count} y=${afterScroll.minY}-${afterScroll.maxY}`);
    assert.equal(afterScroll.count, 0, "scrolled-off inline image remained visible at a stale absolute position");
    assert.ok((await s.get("terminal.session", surface)).inlineImages.includes("plot"),
      "scrolling deleted inline-image ownership instead of hiding its placement");

    await s.run("terminal.input", { bytes: `${image(blue)}; printf '\\nREPLACE_DONE\\n'\r` }, surface);
    await readScreenUntil(s, surface, (lines) => lines.includes("REPLACE_DONE"),
      "terminal did not finish the replacement fixture");
    const replaced = await terminalColorBounds(s, surface, "blue");
    assert.ok(replaced.count >= 1, `same-name replacement did not reach native pixels: ${replaced.count}; ${replaced.measured}`);
    const redAfterReplacement = await terminalColorBounds(s, surface, "red");
    assert.ok(redAfterReplacement.count < beforeScroll.count / 2,
      `same-name replacement retained the old image: ${redAfterReplacement.count}`);

    await s.run("terminal.image.inline.delete", { name: "plot" }, surface);
    await s.until("terminal.session", (state) => !state.inlineImages?.includes("plot"),
      "inline image deletion event was not observed", { surface });
    const deleted = await terminalColorBounds(s, surface, "blue");
    t.diagnostic(`${app.name}: after delete blue pixels ${deleted.count} y=${deleted.minY}-${deleted.maxY}`);
    assert.equal(deleted.count, 0, "inline image deletion left blue pixels in the native raster");
    const screen = await readScreenUntil(s, surface, (lines) => lines.length > 0,
      "terminal screen disappeared after inline image deletion");
    assert.ok(Array.isArray(screen), "terminal text state was not retained after image deletion");
    await s.run("host.window.resize", { width: 800, height: 920 });
    const resizedScreen = await readScreenUntil(s, surface, (lines) => lines.length > 0,
      "terminal screen disappeared after resize");
    assert.ok(Array.isArray(resizedScreen), "terminal text state was not retained after resize");
    t.diagnostic(`${app.name}: PASS inline image lifecycle (scroll/resize/replace/delete)`);
  });

  test(`${app.name}: the terminal background equals the card color of every theme and mode`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    s.cleanup(async () => {
      await s.run("core.settings.theme", { name: "midnight", mode: "dark", scope: "common" });
      await closeTerminalTabs(s);
    });
    await s.until("terminal.session", (state) => Boolean(state?.sessionId && state.theme),
      "terminal session did not report its effective theme", { surface: terminal.surface });
    const rect = await s.rect("terminal.view", undefined, terminal.surface);
    // The theme values are the theme list that the workbench reports, unchanged.
    const THEMES = await s.get("core.themes");
    for (const { name: theme } of THEMES) {
      for (const mode of ["dark", "light"]) {
        await s.run("core.settings.theme", { name: theme, mode, scope: "common" });
        // The terminal background is the card color (--card).
        const token = THEMES.find((item) => item.name === theme)[mode].card;
        await s.until("terminal.session", (state) => state?.theme === mode && state.background === token,
          `the terminal did not apply ${theme} ${mode} background ${token}`, { surface: terminal.surface });
        const sample = await terminalBackgroundSample(s, rect);
        const expected = [1, 3, 5].map((at) => parseInt(token.slice(at, at + 2), 16));
        assert.ok(sample.every((value, index) => Math.abs(value - expected[index]) <= 2),
          `${theme} ${mode}: the terminal background pixel is rgb(${sample}), the card token is ${token}`);
      }
    }
  });

  test(`${app.name}: terminal raster follows application light and dark theme`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    await s.until("core.surfaces", (surfaces) => surfaces.some((item) =>
      item.surface === terminal.surface && item.exposes.includes("status terminal.session")),
    "terminal session status did not register");
    await s.until("terminal.session", (state) => Boolean(state?.sessionId && state.theme),
      "terminal session did not report its effective theme", { surface: terminal.surface });
    const original = (await s.get("core.settings")).values.mode;
    const other = original === "dark" ? "light" : "dark";
    const rect = await s.rect("terminal.view", undefined, terminal.surface);
    const darkSample = original === "dark" ? await terminalBackgroundSample(s, rect) : null;
    const lightSample = original === "light" ? await terminalBackgroundSample(s, rect) : null;
    const sessionBefore = await s.get("terminal.session", terminal.surface);
    s.cleanup(async () => {
      await s.run("core.settings.theme", { name: "midnight", mode: original, scope: "common" });
      await closeTerminalTabs(s);
    });

    await s.run("core.settings.theme", { name: "midnight", mode: other, scope: "common" });
    await s.until("core.settings", (settings) => settings.values.mode === other && !settings.saving,
      `application theme did not switch to ${other}`);
    const switched = await s.until("terminal.session", (state) => state?.theme === other,
      `terminal did not acknowledge ${other} theme`, { surface: terminal.surface });
    const switchedSample = await terminalBackgroundSample(s, rect);
    if (other === "light") assert.ok(switchedSample[0] > 200 && switchedSample[1] > 200 && switchedSample[2] > 200,
      `light terminal background pixel was not light: ${switchedSample}`);
    else assert.ok(switchedSample[0] < 80 && switchedSample[1] < 80 && switchedSample[2] < 80,
      `dark terminal background pixel was not dark: ${switchedSample}`);
    assert.equal(switched.sessionId, sessionBefore.sessionId, "theme switch recreated the terminal session");
    assert.equal(switched.cellWidth, sessionBefore.cellWidth, "theme switch changed cell width");
    assert.equal(switched.cellHeight, sessionBefore.cellHeight, "theme switch changed cell height");
    if (other === "light") assert.ok(darkSample === null || switchedSample.some((value, index) => Math.abs(value - darkSample[index]) > 100),
      `light and dark background pixels did not differ: ${darkSample} -> ${switchedSample}`);
    else assert.ok(lightSample === null || switchedSample.some((value, index) => Math.abs(value - lightSample[index]) > 100),
      `dark and light background pixels did not differ: ${lightSample} -> ${switchedSample}`);
  });

  test(`${app.name}: terminal cursor policy uses declared settings, persistence, and pixels`, { timeout: 30000 }, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const cursorKeys = [
      "terminal.cursor.shape", "terminal.cursor.blink", "terminal.cursor.interval",
      "terminal.cursor.idleTimeout", "terminal.cursor.unfocused",
    ];
    s.cleanup(async () => {
      for (const key of cursorKeys) await s.run("core.settings.reset", { key });
      await closeTerminalTabs(s);
    });
    await s.until("terminal.session", (state) => Boolean(state?.sessionId),
      "terminal session did not open", { surface: terminal.surface });
    const terminalView = await s.rect("terminal.view", undefined, terminal.surface);
    await s.click(terminalView.document.x + terminalView.x + terminalView.width / 2,
      terminalView.document.y + terminalView.y + terminalView.height / 2);
    await s.until("host.window", (host) => host.regions.some((region) =>
      region.surface === terminal.surface && region.focused),
    "terminal did not receive focus before cursor capture");
    const before = await terminalCursorCell(s, terminal.surface);
    await s.run("core.settings.open");
    const modalControl = async (key) => {
      const modal = await s.until("core.settings-modal", (state) =>
        state.controls.some((control) => control.key === key),
      `settings control ${key} did not appear`);
      return modal.controls.find((control) => control.key === key);
    };
    // The terminal settings are on the terminal page of the plugin section. Both steps open through the command of a declared control.
    const plugins = await modalControl("nav:plugins");
    await s.run(plugins.command.name, plugins.command.params);
    const page = await modalControl("plugin:terminal");
    await s.run(page.command.name, page.command.params);
    await s.until("core.settings-modal", (modal) => modal.plugin === "terminal", "the terminal settings page did not open");
    // The choices are a select box. The chosen value goes to the value of the command that the control points to (Controls in core docs/spec/settings.md).
    const pick = async (setting, expected) => {
      const control = await modalControl(setting);
      assert.ok(control.command, `settings control ${setting} has no command`);
      assert.ok(control.options?.includes(expected), `settings control ${setting} does not offer ${expected}`);
      await s.run(control.command.name, { ...control.command.params, value: expected });
      await s.until("core.settings", (state) => state.values[setting] === expected && !state.saving,
        `settings command did not apply ${setting}=${expected}`);
    };
    await pick("terminal.cursor.shape", "underline");
    await pick("terminal.cursor.blink", "Never");
    await pick("terminal.cursor.unfocused", "beam");
    // A numeric setting changes through the command that the value input control points to.
    const enter = async (key, value) => {
      const modal = await s.until("core.settings-modal", (state) =>
        state.controls.some((control) => control.name === "core.settings-modal.set" && control.key === key),
      `settings value control ${key} did not appear`);
      const control = modal.controls.find((item) => item.name === "core.settings-modal.set" && item.key === key);
      assert.ok(control.command, `settings value control ${key} has no command`);
      await s.run(control.command.name, { ...control.command.params, value: String(value) });
      await s.until("core.settings", (state) => state.values[key] === value && !state.saving,
        `settings value control did not apply ${key}=${value}`);
    };
    await enter("terminal.cursor.interval", 900);
    await enter("terminal.cursor.idleTimeout", 0);
    await s.run("core.settings.close");

    await s.until("terminal.cursor", (state) => state.unfocused === "beam" && state.blink === "Never" &&
      state.interval === 900 && state.idleTimeout === 0,
    "terminal did not receive the effective cursor settings", { surface: terminal.surface });
    await s.presented();
    const after = await terminalCursorCell(s, terminal.surface);
    assert.ok(differentPixels(before.surface, after.surface) > 0,
      "cursor policy did not change actual terminal surface pixels");
    await s.run("core.settings.set", {
      patch: { "terminal.cursor.shape": "beam" },
      scope: "project",
    });
    await s.until("core.settings", (state) => state.values["terminal.cursor.shape"] === "beam" && !state.saving,
      "project cursor setting was not persisted");
    await s.until("terminal.cursor", (state) => state.shape === "beam",
      "project cursor setting did not reach the sidecar", { surface: terminal.surface });
    await s.run("core.settings.reset", { key: "terminal.cursor.shape" });
    await s.until("core.settings", (state) => state.values["terminal.cursor.shape"] === "underline" && !state.saving,
      "project cursor reset did not restore the common value");
    await s.until("terminal.cursor", (state) => state.shape === "underline",
      "common cursor value was not restored after project reset", { surface: terminal.surface });
    assert.equal(await failure(s.run("core.settings.set", {
      patch: { "terminal.cursor.interval": 0 }, scope: "common",
    })), -32602, "invalid cursor setting must fail explicitly");
    assert.equal((await s.get("core.settings")).values["terminal.cursor.interval"], 900,
      "invalid cursor setting must not replace the effective value");
  });

  test(`${app.name}: each cursor shape and focus state renders its own cursor-cell pixels`, { timeout: 60000 }, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    const keys = ["terminal.cursor.shape", "terminal.cursor.blink", "terminal.cursor.unfocused"];
    s.cleanup(async () => {
      for (const key of keys) await s.run("core.settings.reset", { key });
      await closeTerminalTabs(s);
    });
    await readScreenUntil(s, surface, (lines) => lines.some((line) => line.endsWith("$")), "shell prompt missing");
    const set = async (patch) => {
      await s.run("core.settings.set", { patch, scope: "common" });
      const [key, value] = Object.entries(patch)[0];
      const field = { "terminal.cursor.shape": "shape", "terminal.cursor.blink": "blink", "terminal.cursor.unfocused": "unfocused" }[key];
      await s.until("terminal.cursor", (state) => state[field] === value, `the terminal did not apply ${key}=${value}`, { surface });
    };
    // With blinking off, the cursor stays in one shape.
    await set({ "terminal.cursor.blink": "Never" });

    // Measures the ratio of device pixels of the cursor cell that differ from the background, split into the border band and the inside.
    const measure = async (label) => {
      const cursor = await s.run("terminal.screen.read", {}, surface).then(() => s.get("terminal.cursor", surface));
      await s.presented();
      await s.request("diagnostics.capture.start", {});
      const displayed = await s.presented();
      const { frames: frameDir } = await s.request("diagnostics.capture.stop", { after: displayed.displayed });
      try {
        const files = frames(frameDir);
        assert.ok(files.length > 0, `${label}: the capture produced no frames`);
        const frame = readFrame(files.at(-1));
        const region = (await s.get("host.window")).regions.find((item) => item.surface === surface && item.name === "view");
        const state = await s.get("terminal.session", surface);
        const x0 = Math.round((region.frame.x + cursor.col * state.cellWidth) * frame.scale);
        const y0 = Math.round((region.frame.y + cursor.row * state.cellHeight) * frame.scale);
        const width = Math.floor(state.cellWidth * frame.scale);
        const height = Math.floor(state.cellHeight * frame.scale);
        const background = pixel(frame, Math.round((region.frame.x + region.frame.width - 3) * frame.scale),
          Math.round((region.frame.y + region.frame.height - 3) * frame.scale));
        const ink = (x, y) => pixel(frame, x0 + x, y0 + y).some((value, index) => Math.abs(value - background[index]) > 60);
        const band = (fx, fy, fw, fh) => {
          let count = 0;
          for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) if (ink(x, y)) count++;
          return count / (fw * fh);
        };
        // The cursor line is 2 device pixels. The band is one line of device pixels at the cell edge, and the inside is inside that line.
        const line = 2;
        // For the failure report: an ink map of the cursor cell and one cell around it.
        const map = [];
        for (let y = -height; y < 2 * height; y++) {
          let row = "";
          for (let x = -width; x < 2 * width; x++) row += ink(x, y) ? "#" : ".";
          map.push(row);
        }
        return {
          label,
          cell: { col: cursor.col, row: cursor.row, x0, y0, width, height, scale: frame.scale },
          top: band(line, 0, width - 2 * line, 1),
          bottom: band(line, height - 1, width - 2 * line, 1),
          left: band(0, line, 1, height - 2 * line),
          right: band(width - 1, line, 1, height - 2 * line),
          inside: band(line + 1, line + 1, width - 2 * line - 2, height - 2 * line - 2),
          map,
        };
      } finally {
        rmSync(frameDir, { recursive: true, force: true });
      }
    };
    const expect = (value, shape) => {
      const full = (v) => v > 0.8;
      const empty = (v) => v < 0.1;
      const rules = {
        block: full(value.top) && full(value.bottom) && full(value.left) && full(value.right) && full(value.inside),
        hollow: full(value.top) && full(value.bottom) && full(value.left) && full(value.right) && empty(value.inside),
        underline: full(value.bottom) && empty(value.top) && empty(value.right) && empty(value.inside),
        beam: full(value.left) && empty(value.right) && empty(value.top) && empty(value.inside),
        hidden: empty(value.top) && empty(value.bottom) && empty(value.left) && empty(value.right) && empty(value.inside),
      };
      const { map, ...bands } = value;
      assert.ok(rules[shape], `${value.label} did not render a ${shape} cursor: ${JSON.stringify(bands)}\n${map.join("\n")}`);
    };

    // Before focus: the unfocused cursor setting decides the shape.
    await s.until("host.window", (host) => host.regions.some((region) => region.surface === surface && !region.focused),
      "the terminal started with keyboard focus");
    for (const [unfocused, shape] of [["hollow", "hollow"], ["solid", "block"], ["underline", "underline"], ["beam", "beam"]]) {
      await set({ "terminal.cursor.unfocused": unfocused });
      expect(await measure(`unfocused ${unfocused}`), shape);
    }
    await set({ "terminal.cursor.unfocused": "hollow" });

    // After focus: the cursor shape setting decides the shape.
    const view = await s.rect("terminal.view", undefined, surface);
    await s.click(view.document.x + view.x + view.width / 2, view.document.y + view.y + view.height / 2);
    await s.until("host.window", (host) => host.regions.some((region) => region.surface === surface && region.focused),
      "the terminal did not receive keyboard focus");
    for (const shape of ["block", "underline", "beam"]) {
      await set({ "terminal.cursor.shape": shape });
      expect(await measure(`focused ${shape}`), shape);
    }

    // A cursor that the program hides is not drawn.
    await s.run("terminal.input", { bytes: "printf '\\033[?25l'\r" }, surface);
    await s.until("terminal.cursor", (state) => state.visible === false, "the program did not hide the cursor", { surface });
    expect(await measure("hidden"), "hidden");
  });

  test(`${app.name}: the terminal font follows the pressed card's text size`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    s.cleanup(() => closeTerminalTabs(s));
    await s.until("terminal.session", (state) => Boolean(state?.sessionId) && state.fontSize === 13,
      "the terminal did not open at 13 points", { surface });
    // The pixel height of one line of red glyphs shows the drawn font size.
    const red = async (marker) => {
      await s.run("terminal.input", { bytes: `printf '\\033[2J\\033[H\\033[31m${marker}\\033[0m\\n'\r` }, surface);
      await readScreenUntil(s, surface, (lines) => lines.some((line) => line.trim() === marker), `${marker} did not render`);
      await s.presented();
      return terminalColorBounds(s, surface, "red");
    };
    const before = await s.get("terminal.session", surface);
    const glyphBefore = await red("HGHGHG");
    assert.ok(glyphBefore.count > 0, "the red text was not found in the terminal pixels");
    const view = await s.rect("terminal.view", undefined, surface);
    await s.click(view.document.x + view.x + view.width / 2, view.document.y + view.y + view.height / 2);
    await s.until("core.text", (value) => value.scope.kind === "card", "pressing the terminal card did not make it the scope");
    const titles = await largerTitle(s);
    await s.run("host.menu.select", { menu: titles.menu, title: titles.larger });
    await s.run("host.menu.select", { menu: titles.menu, title: titles.larger });
    const after = await s.until("terminal.session", (state) => state.fontSize === 13 * 1.25,
      "the terminal font did not reach 13 points times 1.25", { surface });
    const cell = after.cellHeight / before.cellHeight;
    assert.ok(Math.abs(cell - 1.25) <= 0.1, `the cell height must grow with the factor: ${before.cellHeight} → ${after.cellHeight}`);
    const glyphAfter = await red("HGHGHG");
    const glyph = (glyphAfter.maxY - glyphAfter.minY + 1) / (glyphBefore.maxY - glyphBefore.minY + 1);
    assert.ok(Math.abs(glyph - 1.25) <= 0.15,
      `the rendered glyph height must grow with the factor: ${JSON.stringify(glyphBefore)} → ${JSON.stringify(glyphAfter)}`);
  });

  test(`${app.name}: a native drag over blank terminal cells ends without a surface error`, async (t) => {
    const s = await open(t, app, { clipboard: true });
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    s.cleanup(() => closeTerminalTabs(s));
    await s.until("core.surfaces", (surfaces) => surfaces.some((item) =>
      item.surface === surface && item.exposes.includes("status terminal.session")),
    "terminal selection status did not register");
    await s.until("terminal.session", (state) => Boolean(state?.sessionId),
      "terminal selection session did not open", { surface });
    const marker = "BLANK-SELECTION-1";
    await s.run("terminal.input", { bytes: `printf '\\033[2J\\033[H${marker}\\n'\r` }, surface);
    await readScreenUntil(s, surface, (screen) => screen.some((line) => line.trim() === marker),
      "terminal blank selection marker did not render");

    const view = await s.rect("terminal.view", undefined, surface);
    const metrics = await s.get("terminal.session", surface);
    assert.ok(metrics.rows > 4 && metrics.cols > 20, `terminal grid is too small: ${metrics.cols}×${metrics.rows}`);
    const row = metrics.rows - 2;
    const viewX = view.document.x + view.x;
    const y = view.document.y + view.y + (row + 0.5) * metrics.cellHeight;
    const released = metrics.selectionReleases;
    await s.pointer(viewX + 5.5 * metrics.cellWidth, y, "down", { button: "left" });
    await s.pointer(viewX + 20.5 * metrics.cellWidth, y, "drag", { button: "left" });
    await s.pointer(viewX + 20.5 * metrics.cellWidth, y, "up", { button: "left" });
    // Waits until the sidecar answers the release or reports an error.
    const state = await s.until("terminal.session",
      (value) => value?.selectionReleases > released || value?.error !== undefined,
      "the sidecar did not answer the selection release", { surface });
    // A selected cell is drawn with the selection background of the theme and the screen cells of the page have no color, so measures the turned-off range in pixels.
    const selection = await selectionBackground(s);
    const columns = Array.from({ length: 16 }, (_, index) => 5 + index);
    const shown = await cellBackgrounds(s, surface, columns.map((col) => ({ col, row })));
    const selected = columns.filter((col, index) => isColor(shown[index], selection));
    assert.equal(state.error, undefined,
      `a drag over blank row ${row} reported ${state.error}; selected cells in columns 5–20: ${selected.join(",")}`);
    assert.deepEqual(state.unsupported, [], "the sidecar answers of the drag are declared events");
    assert.deepEqual(selected, [], `the blank selection was not cleared: columns ${selected.join(",")} of row ${row} ` +
      `are drawn on the selection background ${selection}`);
  });

  test(`${app.name}: a native drag into the padding below the last row selects to the last row`, async (t) => {
    const s = await open(t, app, { clipboard: true });
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    s.cleanup(() => closeTerminalTabs(s));
    await s.until("core.surfaces", (surfaces) => surfaces.some((item) =>
      item.surface === surface && item.exposes.includes("status terminal.session")),
    "terminal selection status did not register");
    await s.until("terminal.session", (state) => Boolean(state?.sessionId),
      "terminal selection session did not open", { surface });
    const marker = "PADDING-SELECTION-1";
    await s.run("terminal.input", { bytes: `printf '\\033[2J\\033[H${marker}\\n'\r` }, surface);
    await readScreenUntil(s, surface, (screen) => screen.some((line) => line.trim() === marker),
      "terminal padding selection marker did not render");

    const view = await s.rect("terminal.view", undefined, surface);
    const metrics = await s.get("terminal.session", surface);
    const padding = view.height - metrics.rows * metrics.cellHeight;
    assert.ok(padding >= 1 && padding < metrics.cellHeight,
      `the view must leave padding below the last row: ${view.height} for ${metrics.rows} rows of ${metrics.cellHeight}`);
    const viewX = view.document.x + view.x;
    const top = view.document.y + view.y;
    const released = metrics.selectionReleases;
    await s.pointer(viewX + 0.5 * metrics.cellWidth, top + 0.5 * metrics.cellHeight, "down", { button: "left" });
    // A selection covers a cell only when the pointer passes the horizontal middle of the cell (core docs/spec/persistent-services.md). Dragging up to just before the middle of the fourth cell
    // selects the first three cells of the last row, and passing the middle selects four cells. The sidecar handles drags in order, so a screen read after a drag
    // names the frame that shows the selection, and cellBackgrounds reads the pixels after that frame is presented. The selection is visible only by color, so it is
    // measured in pixels.
    const selection = await selectionBackground(s);
    const last = metrics.rows - 1;
    const below = top + metrics.rows * metrics.cellHeight + padding / 2;
    for (const [column, expected] of [[3.4, [true, true, true, false]], [3.6, [true, true, true, true]]]) {
      await s.pointer(viewX + column * metrics.cellWidth, below, "drag", { button: "left" });
      const shown = await cellBackgrounds(s, surface, [0, 1, 2, 3].map((col) => ({ col, row: last })));
      assert.deepEqual(shown.map((sample) => isColor(sample, selection)), expected,
        `a drag into the bottom padding to column ${column} selected other cells of the last row: ${JSON.stringify(shown)} ` +
          `against the selection background ${selection}`);
    }
    await s.pointer(viewX + 3.6 * metrics.cellWidth, below, "up", { button: "left" });
    const state = await s.until("terminal.session",
      (value) => value?.selectionReleases > released || value?.error !== undefined,
      "the sidecar did not answer the selection release", { surface });
    assert.equal(state.error, undefined, `a drag into the bottom padding reported ${state.error}`);
  });

  test(`${app.name}: native terminal selection renders and copies through one explicit paste`, async (t) => {
    const s = await open(t, app, { clipboard: true });
    // The failure report holds the transcript lines, which are records of the page at the level info.
    await fresh(s, { log: { lifecycle: "info" }, reads: ["workbench.record.info"] });
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    s.cleanup(() => closeTerminalTabs(s));
    await s.until("core.surfaces", (surfaces) => surfaces.some((item) =>
      item.surface === surface && item.exposes.includes("status terminal.session")),
    "terminal selection status did not register");
    await s.until("terminal.session", (state) => Boolean(state?.sessionId),
      "terminal selection session did not open", { surface });

    const transcript = await s.transcript(recordCatalog(s.app.configDir));
    s.cleanup(() => transcript.stop());
    // Writes into the failure report whether the terminal screen changed during the selection gesture.
    const screens = [];
    const offScreens = s.client.on("status.changed", (params) => {
      if (params?.name === "terminal.screen" && params.surface === surface) {
        screens.push(params.value.map((cells) => cells.map((cell) => cell.ch).join("").trimEnd()).slice(0, 3));
      }
    });
    await s.request("status.watch", { name: "terminal.screen", surface });
    s.cleanup(async () => {
      offScreens();
      await s.request("status.unwatch", { name: "terminal.screen", surface });
    });
    const marker = "SELECTION-CLIP-123";
    await s.run("terminal.input", { bytes: `printf '\\033[2J\\033[H${marker}\\n'\r` }, surface);
    const lines = await readScreenUntil(s, surface,
      (screen) => screen.some((line) => line.trim() === marker),
      "terminal selection marker did not render");
    const row = lines.findIndex((line) => line.trim() === marker);
    assert.ok(row >= 0, "terminal selection marker row was not found");
    const col = lines[row].indexOf(marker);
    assert.ok(col >= 0, "terminal selection marker column was not found");

    const view = await s.rect("terminal.view", undefined, surface);
    const metrics = await s.get("terminal.session", surface);
    assert.ok(metrics.cellWidth > 0 && metrics.cellHeight > 0, "terminal cell metrics are unavailable");
    const before = await terminalFrame(s);
    const viewX = view.document.x + view.x;
    const viewY = view.document.y + view.y;
    // A selection covers a cell only when the pointer passes the middle of the cell, so presses close to the left edge of the first cell.
    const start = {
      x: viewX + (col + 0.2) * metrics.cellWidth,
      y: viewY + (row + 0.5) * metrics.cellHeight,
    };
    const end = {
      x: viewX + (col + marker.length - 0.5) * metrics.cellWidth,
      y: start.y,
    };
    const screensBefore = screens.length;
    await s.pointer(start.x, start.y, "down", { button: "left" });
    await s.pointer(end.x, end.y, "drag", { button: "left" });
    await s.pointer(end.x, end.y, "up", { button: "left" });
    await s.presented();
    const selected = await s.get("terminal.session", surface);
    if (selected.error !== undefined) {
      const screen = await s.get("terminal.screen", surface);
      assert.fail(`native selection reported ${selected.error}; marker at row ${row}, col ${col}; ` +
        `pointer ${JSON.stringify(start)} → ${JSON.stringify(end)}; screen before selection ${JSON.stringify(lines.slice(0, row + 3))}; ` +
        `screen after selection ${JSON.stringify(screen.slice(0, row + 3).map((cells) => cells.map((cell) => cell.inverse ? cell.ch.toUpperCase() + "*" : cell.ch).join("")))}; ` +
        `grid before ${metrics.cols}×${metrics.rows} at ${metrics.cellWidth}×${metrics.cellHeight}, ` +
        `after ${selected.cols}×${selected.rows} at ${selected.cellWidth}×${selected.cellHeight}; ` +
        `transcript ${JSON.stringify(transcript.lines.slice(-10))}; ` +
        `screens during the gesture ${JSON.stringify(screens.slice(screensBefore))}, last before ${JSON.stringify(screens[screensBefore - 1])}`);
    }

    const after = await terminalFrame(s);
    let changed = 0;
    // Window coordinates are points and the frame is in device pixels, so multiplies by the frame scale.
    const scale = after.scale;
    const x0 = Math.max(0, Math.round((viewX + col * metrics.cellWidth) * scale));
    const x1 = Math.min(after.width, Math.round((viewX + (col + marker.length) * metrics.cellWidth) * scale));
    const y0 = Math.max(0, Math.round((viewY + row * metrics.cellHeight) * scale));
    const y1 = Math.min(after.height, Math.round((viewY + (row + 1) * metrics.cellHeight) * scale));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const oldPixel = pixel(before, x, y);
        const newPixel = pixel(after, x, y);
        if (oldPixel.some((value, index) => value !== newPixel[index])) changed++;
      }
    }
    assert.ok(changed > 0, "native selection did not change the selected raster pixels");

    await s.run("terminal.paste", {}, surface);
    const pasted = await readScreenUntil(s, surface,
      (screen) => screen.filter((line) => line.includes(marker)).length >= 2,
      "explicit paste did not return the selected text to the terminal");
    assert.ok(pasted.filter((line) => line.includes(marker)).length >= 2,
      "selection clipboard text was not pasted exactly as selected");
  });

  test(`${app.name}: an explicit PNG paste writes an owned image and inserts its quoted path`, async (t) => {
    const s = await open(t, app, { clipboard: true });
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    s.cleanup(() => closeTerminalTabs(s));
    await readScreenUntil(s, surface, (lines) => lines.some((line) => line.includes("$")), "shell prompt missing");
    const directory = mkdtempSync(join(tmpdir(), "soksak-png-paste-"));
    s.cleanup(() => rmSync(directory, { recursive: true, force: true }));
    const image = join(directory, "one.png");
    writeFileSync(image, PNG);
    execFileSync("osascript", ["-e", `set the clipboard to (read (POSIX file "${image}") as «class PNGf»)`]);

    await s.run("terminal.paste", {}, surface);
    // A long path wraps at the terminal width, so reads the lines joined.
    const quoted = /'([^']*\/pasted-image-[^'/]*\.png)'/;
    const pasted = await readScreenUntil(s, surface, (lines) => quoted.test(lines.join("")),
      "the PNG paste did not insert a quoted image path");
    const line = pasted.join("");
    const saved = quoted.exec(line)[1];
    s.cleanup(() => rmSync(saved, { force: true }));
    assert.equal(dirname(saved), join(realpathSync(app.configDir), "clipboard"), `the image is not owned by the configuration: ${line}`);
    assert.deepEqual(readFileSync(saved), PNG, "the saved image differs from the clipboard PNG");
    assert.equal((await s.get("terminal.session", surface)).error, undefined);

    // Clipboard bytes that do not parse as a PNG become an explicit error on read and are not stored. The refused read is the
    // error of the one display path, which this check causes on purpose.
    s.expectError(/error native clipboard: PNG decode failed/);
    execFileSync("osascript", ["-e", "set the clipboard to «data PNGf706E67»"]);
    await assert.rejects(() => s.run("terminal.paste", {}, surface), /PNG decode failed/);
  });

  test(`${app.name}: terminal file drop pastes quoted paths without executing`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    const dropped = "'/tmp/dropped file.txt' '/tmp/quote'\\''name.txt'";
    await s.run("terminal.drop", {
      urls: ["file:///tmp/dropped%20file.txt", "file:///tmp/quote%27name.txt"],
    }, surface);
    const lines = await readScreenUntil(s, surface,
      (screen) => screen.some((line) => line.includes(dropped)),
      "terminal file drop did not paste its quoted paths");
    assert.ok(lines.some((line) => line.includes(dropped)), "file drop payload was not visible in the terminal");
    assert.ok(!lines.some((line) => line.includes("command not found")), "file drop must not execute a command");
  });

  // The surface of a diagnostic build has the entries that the plugin diagnostic module (diagnostics.json) registered.
  test(`${app.name}: diagnostic terminal entries inject preedit and record terminal input`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    assert.deepEqual(await s.run("terminal.ime.trace", { action: "start" }, surface),
      { enabled: true, overflow: false, entries: [] });
    s.cleanup(() => s.run("terminal.ime.trace", { action: "stop" }, surface));
    // The plugin requires markedRange: the marked text of an input method, or null when nothing is marked.
    await s.run("terminal.compose.update",
      { text: "글은", markedRange: { location: 0, length: 2 }, selectedRange: { location: 2, length: 0 } }, surface);
    await s.until("terminal.compose", (compose) => compose.text === "글은" && compose.selectedRange?.location === 2,
      "the injected preedit did not reach terminal.compose", { surface });
    await s.run("terminal.compose.update", { text: "", markedRange: null }, surface);
    await s.until("terminal.compose", (compose) => compose.text === "",
      "the empty preedit did not clear terminal.compose", { surface });
    const trace = await s.run("terminal.ime.trace", { action: "stop" }, surface);
    // Each injected preedit reaches the session as an input operation that carries the preedit.
    assert.deepEqual(trace.entries.map((entry) => [entry.kind, entry.input?.operation, entry.input?.preedit?.text]),
      [["terminal-input", "input", "글은"], ["terminal-input", "input", ""]]);
  });

  // An unrelated event (a theme check) does not clear a session error; only the event that resolves the error (a new trace) clears it.
  test(`${app.name}: a terminal session error stays until the event that resolves it`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    const [terminal] = await ensureTerminals(s, 1);
    const surface = terminal.surface;
    await s.until("terminal.session", (state) => Boolean(state?.sessionId && state.theme),
      "terminal session did not report its effective theme", { surface });
    const original = (await s.get("core.settings")).values.mode;
    const other = original === "dark" ? "light" : "dark";
    s.cleanup(() => s.run("core.settings.theme", { name: "midnight", mode: original, scope: "common" }));
    await s.run("terminal.ime.trace", { action: "start" }, surface);
    s.cleanup(() => s.run("terminal.ime.trace", { action: "stop" }, surface));
    // The trace capacity is 256. Control-U erases only the input line of the shell.
    for (let i = 0; i < 257; i++) await s.run("terminal.input", { bytes: "\u0015" }, surface);
    const overflow = "IME diagnostic trace capacity exceeded";
    // The overflow is the error of the one display path, which this check causes on purpose.
    s.expectError(/plugin\.terminal\.error: \{"message":"IME diagnostic trace capacity exceeded"/);
    await s.until("terminal.session", (state) => state.error === overflow,
      "the trace overflow did not reach terminal.session", { surface });
    await s.run("core.settings.theme", { name: "midnight", mode: other, scope: "common" });
    const switched = await s.until("terminal.session", (state) => state.theme === other,
      `terminal did not acknowledge ${other} theme`, { surface });
    assert.equal(switched.error, overflow, "a theme acknowledgement hid the trace overflow");
    await s.run("terminal.ime.trace", { action: "start" }, surface);
    await s.until("terminal.session", (state) => state.error === undefined,
      "a new trace did not resolve the trace overflow", { surface });
  });

  test(`${app.name}: multiple terminals keep fixed cells during a divider drag`, async (t) => {
    const s = await open(t, app);
    await fresh(s);
    s.cleanup(() => closeTerminalTabs(s));
    const terminals = await ensureTerminals(s, 3);
    assert.ok(terminals.length >= 3, `expected at least three visible terminals, got ${terminals.length}`);
    await s.presented();

    const before = new Map();
    for (const [index, surface] of terminals.entries()) {
      const session = await s.get("terminal.session", surface.surface);
      before.set(surface.surface, { cellWidth: session.cellWidth, cellHeight: session.cellHeight });
      const marker = `DRAG-TEXT-${index}`;
      // Changes the background first. The erase below clears that output and the history together.
      await setMeasuredBackground(s, surface.surface);
      // Clears the history too (ED 3). This check measures the alignment of the native region; with a history, the visible scrollbar is checked separately.
      await s.run("terminal.input", { bytes: `printf '\\033[2J\\033[3J\\033[H${marker}\\n'\r` }, surface.surface);
      await readScreenUntil(
        s,
        surface.surface,
        (screen) => screen[0].trim() === marker,
        `${surface.surface} did not render its marker before the divider drag`
      );
      before.get(surface.surface).marker = marker;
    }
    const beforeGrid = await s.get("core.grid");
    const terminalY = (await s.rect("terminal.view", undefined, terminals[0].surface)).y;
    // Performs one fast drag with several terminals present. Repeated round trips and
    // returning to the project are checked separately in F1.3 with a full capture matrix.
    const terminalCard = beforeGrid.cards.filter((card) => terminals.some((surface) => card.active === surface.surface))
      .sort((a, b) => a.x - b.x)[0];
    assert.ok(terminalCard, "terminal card is missing");
    const result = await drag(s, { axis: "x", line: terminalCard.c1, dx: 500, dy: 0, ms: 96, times: 1 }, { capture: true });
    // A recording holds only changed frames, so the frame count follows the refresh rate of the display. Requires at least 7/8 of the frames that the display can draw during the drag time.
    // At 120Hz a drag of 192ms gives 21 frames, the same as the earlier criterion.
    const { refreshRate } = await s.get("host.window");
    assert.ok(refreshRate > 0, `the window reports no refresh rate: ${refreshRate}`);
    const minimum = Math.ceil(result.asked * refreshRate / 1000 * 7 / 8);
    t.diagnostic(`divider recording frames ${result.count} of at least ${minimum} for ${result.asked}ms at ${refreshRate}Hz`);
    assert.ok(result.count >= minimum,
      `divider recording contained too few frames: ${result.count} of at least ${minimum} for ${result.asked}ms at ${refreshRate}Hz`);
    assert.ok(result.longestGap <= 100, `divider recording dropped a gesture interval: ${result.longestGap}ms`);
    assert.equal(result.late, 0, `divider input arrived late: ${result.late} steps`);
    assert.equal(result.deepest, 0, `divider input queue accumulated ${result.deepest} steps`);

    // The end of the round trip must equal the start coordinate. The actual movement is checked with the card coordinates of each capture.
    const { displayed } = await s.presented();
    // The frame time is the display clock (ms) of the host. The failure text gives it as the wall-clock time of the performance trace to match the trace.
    const clockOffset = Date.now() - displayed;
    const at = (time) => new Date(time + clockOffset).toISOString();
    const host = await s.get("host.window");
    const positions = [];
    let firstGlyph = null;
    for (const [index, file] of frames(result.frameDir).entries()) {
      const frame = readFrame(file);
      const boxes = surfaceBoxes(frame, MEASURED_BACKGROUND);
      const terminalBoxes = boxes.filter((box) =>
        Math.abs(box.row / frame.scale - terminalY) <= 5);
      assert.equal(terminalBoxes.length, terminals.length, `frame ${index}: every terminal must be measurable`);
      positions.push({ time: frame.time,
        position: [...terminalBoxes].sort((a, b) => a.card.l - b.card.l)[1].card.l / frame.scale });
      for (const box of terminalBoxes) {
        assert.ok(box.l > box.card.l && box.r - 1 < box.card.r,
          `frame ${index} at ${at(frame.time)}: terminal ${box.l}..${box.r - 1} invades DOM card ${box.card.l}..${box.card.r}`);
        const scale = frame.scale;
        const leftGap = box.l - box.card.l;
        const rightGap = box.card.r - box.r;
        assert.ok(leftGap >= scale && leftGap <= 2 * scale,
          `frame ${index} at ${at(frame.time)}: terminal left gap is ${leftGap}px; ` +
          `(surface=${box.l}..${box.r}, card=${box.card.l}..${box.card.r}, scale=${scale})`);
        // surfaceBoxes.r is an exclusive coordinate and span().card.r is the last pixel of the card.
        // The native region must end just before the inner edge of the right border.
        assert.ok(rightGap >= 0 && rightGap <= 2 * scale,
          `frame ${index} at ${at(frame.time)}: terminal right gap is ${rightGap}px; ` +
          `(surface=${box.l}..${box.r}, card=${box.card.l}..${box.card.r}, scale=${scale})`);
        assert.ok(box.r - box.l >= box.card.r - box.card.l - 4 * scale,
          `frame ${index} at ${at(frame.time)}: terminal native area is narrower than its card`);
        assert.equal(whitePixels(frame, { l: box.l, r: box.r, t: box.t, b: box.b }), 0,
          `frame ${index}: terminal contains white pixels`);
        const metrics = before.values().next().value;
        const shape = glyphShape(frame, { l: box.l, r: box.l + Math.round(metrics.cellWidth * scale),
          t: box.t, b: box.t + Math.round(metrics.cellHeight * scale) });
        firstGlyph ??= shape;
        assert.equal(shape.height, firstGlyph.height,
          `frame ${index}: terminal glyph height changed during drag`);
        assert.ok(Math.abs(shape.width - firstGlyph.width) <= 1,
          `frame ${index}: terminal glyph raster width changed beyond subpixel rounding`);
      }
    }
    // Every placement that stayed long must appear in the recording. A position that stayed shorter than one display can be replaced.
    assertHeldStatesShown(positions, result.ticks, result.boundary);
    for (const surface of await s.surfaces("terminal")) {
      const session = await s.get("terminal.session", surface.surface);
      const original = before.get(surface.surface);
      await readScreenUntil(
        s,
        surface.surface,
        (screen) => screen.join("").includes(original.marker),
        `${surface.surface} lost terminal text during the divider drag`
      );
      assert.equal(session.cellWidth, original.cellWidth, `${surface.surface} changed terminal cell width`);
      assert.equal(session.cellHeight, original.cellHeight, `${surface.surface} changed terminal cell height`);
      const region = host.regions.find((item) => item.surface === surface.surface);
      assert.ok(region, `${surface.surface} has no native region after divider drag`);
      assert.equal(region.presented.width, Math.round(region.frame.width * region.presented.scale),
        `${surface.surface} raster width does not match its frame after divider drag`);
      assert.equal(region.presented.height, Math.round(region.frame.height * region.presented.scale),
        `${surface.surface} raster height does not match its frame after divider drag`);
    }
  });
}
