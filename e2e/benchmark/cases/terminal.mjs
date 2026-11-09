// The view measurement case of the terminal plugin: its lifecycle, its initial shell prompt read through the screen read, its source
// frames and the pixel geometry of its native raster region against the declared card slot, measured with the measurement background
// of OSC 11.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { drag } from "@soksak/window-check/app.mjs";
import { frames, readFrame } from "@soksak/window-check/frame.mjs";
import { collectViewReclaimMeasurements, collectViewStartAndMemory, monotonicTimeMs,
  mapViewContentFramesToCapture, requireViewContentFrameCoverage, rightEdgeWidthDragPlan,
  rootNativePlacementBeforeCapture, selectOneShotViewSourceFrame,
  TAB_PLACEMENT, waitForViewReadiness, withDragTraceMode, withViewContentTrace } from "@soksak/window-check/view-metrics-collection.mjs";
import { valueProof } from "@soksak/window-check/view-content.mjs";
import { presentsFrame } from "@soksak/window-check/region-raster.mjs";
import { declaredSlotInsets, effectiveCardCornerRadiusPt, findFirstChangedSlotFrame, measureViewFrameGeometry }
  from "@soksak/window-check/view-frame-geometry.mjs";
import { dragTailGeometryFrame, sourceContentFrame } from "@soksak/window-check/marker-view.mjs";
import { PLUGIN } from "../../start.mjs";
import { readScreenUntil } from "../../terminal-screen.mjs";
import { readTerminalContent } from "../../view-content.mjs";

/**
 * The view descriptor of the terminal view. Its content is the initial fixture-shell prompt, read through terminal.screen.read once the
 * image region of the view presents the frame that the read names; no command is added and readiness is not taken as proof.
 */
export const terminalViewDescriptor = Object.freeze({
  plugin: PLUGIN,
  placement: TAB_PLACEMENT,
  params: undefined,
  expectedContent: "sh-3.2$",
  readContent: (session, surface) => readTerminalContent(session, surface),
  readinessStatus: "terminal.session",
  readiness: async (s, surface) => {
    const session = await s.until("terminal.session", (value) => value.sessionId !== "" && value.cols > 0 && value.rows > 0,
      `terminal view ${surface} did not open its session`, { surface });
    const lines = await readScreenUntil(s, surface, (rows) => rows.some((line) => line.startsWith("sh-3.2$")),
      `terminal view ${surface} did not display its initial shell prompt`).catch(async (error) => {
      const shown = (await s.get("core.surfaces")).find((item) => item.surface === surface);
      const regions = (await s.get("host.window")).regions.filter((region) => region.surface === surface);
      const state = await s.get("terminal.session", surface);
      throw new Error(`${error.message.slice(0, 200)}; session ${JSON.stringify(state)}; surface ${JSON.stringify(shown)}; regions ${JSON.stringify(regions)}`, { cause: error });
    });
    const rect = await s.rect("terminal.view", undefined, surface);
    assert.ok(rect.width > 0 && rect.height > 0, `terminal view ${surface} has no visible content region`);
    const history = await s.run("terminal.view.history", {}, surface);
    assert.deepEqual(history, { length: 1 }, `terminal view ${surface} did not begin with one root history entry`);
    return { sessionId: session.sessionId, promptLines: lines, historyEntries: history.length, regionHistoryEntries: 0 };
  },
  readDocument: async (s, surface) => {
    const history = await s.run("terminal.view.history", {}, surface);
    return { historyEntries: history.length, regionHistoryEntries: 0 };
  },
  startContentTrace: async (s, surface) => {
    const result = await s.run("terminal.view.frames", { action: "start" }, surface);
    assert.equal(result?.enabled, true, `terminal view ${surface} content-frame observer did not start`);
    return result;
  },
  stopContentTrace: async (s, surface) => {
    const result = await s.run("terminal.view.frames", { action: "stop" }, surface);
    assert.deepEqual(result, { enabled: false }, `terminal view ${surface} content-frame observer did not stop`);
    return result;
  },
});

/** The name of the measured view in the errors of the drag evidence. */
const OWNER = "terminal view";

/** Persists the original drag transaction rows before any frame analysis can fail. */
export function writeTerminalDragLayouts(directory, layouts) {
  assert.ok(Array.isArray(layouts), "terminal drag layouts must be an array");
  const path = join(directory, "layouts.json");
  writeFileSync(path, JSON.stringify({ layouts }, null, 2) + "\n");
  return path;
}

// Keep measured content outside the color tolerance of the card's antialiased focus outline.
export const TERMINAL_GEOMETRY_BACKGROUND = Object.freeze([0, 80, 180]);

const TERMINAL_GEOMETRY = Object.freeze({ contentColor: TERMINAL_GEOMETRY_BACKGROUND, cardColor: [25, 27, 36],
  planeColor: [16, 17, 23], borderColors: [[43, 46, 61], [34, 36, 47], [255, 179, 107]], colorTolerance: 3 });

/** Applies the terminal measurement color to the terminal view `surface` through OSC 11 and waits for its output marker. */
export async function setTerminalGeometryBackground(session, surface) {
  const hex = TERMINAL_GEOMETRY_BACKGROUND.map((value) => value.toString(16).padStart(2, "0")).join("/");
  const marker = `TERMINAL-GEOMETRY-${surface}`;
  await session.run("terminal.input", { bytes: `printf '\\033]11;rgb:${hex}\\007${marker}\\n'\r` }, surface);
  await readScreenUntil(session, surface, (lines) => lines.some((line) => line.startsWith(marker)),
    `${surface} did not finish the terminal geometry background change`);
}

/** Measures terminal content geometry with the exact palette used by its layout and drag collectors. */
export function measureTerminalLayoutFrame(frame, { cornerRadiusPt, targetRect } = {}) {
  return measureViewFrameGeometry(frame, { ...TERMINAL_GEOMETRY, cornerRadiusPt, targetRect });
}

function terminalDocument(host, surface) {
  const row = host.documents.find((document) => document.surface === surface && document.document === "");
  assert.ok(row?.visible && row.frame.width > 0 && row.frame.height > 0,
    `view ${surface} has no visible root document frame`);
  return row;
}

/** The one native raster region `view` of the terminal view `surface` in host.window. */
function terminalRasterRegion(host, surface) {
  const regions = host?.regions?.filter((region) => region.surface === surface && region.name === "view") ?? [];
  assert.equal(regions.length, 1, `terminal view ${surface} must have exactly one native raster region`);
  return regions[0];
}

/** Returns the declared native raster region rectangle from host.window. */
export function terminalRasterTargetRectPt(host, surface) {
  const region = terminalRasterRegion(host, surface);
  const frame = region.frame;
  assert.ok(region.visible && frame && [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)
    && frame.width > 0 && frame.height > 0,
  `terminal view ${surface} has no visible native raster region frame`);
  return { left: frame.x, top: frame.y, right: frame.x + frame.width, bottom: frame.y + frame.height };
}

/** The insets of the slot of the terminal view `surface` in its card `card`, in points, as the layout declares them. */
export async function terminalSlotInsets(s, card, surface) {
  const [grid, surfaces, rect] = await Promise.all([
    s.get("core.grid"), s.get("core.surfaces"), s.rect("terminal.view", undefined, surface),
  ]);
  return declaredSlotInsets({ grid, surfaces, card, surface,
    regionRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } });
}

function frameAtOrAfter(captured, timeMs, description) {
  const index = captured.findIndex((frame) => frame.time >= timeMs);
  assert.ok(index >= 0, `${description} has no captured display frame at or after ${timeMs} ms`);
  return index;
}

/** Whether the raster region of `surface` has a frame other than `before` and presents a raster of that frame's size. */
function presentsResizedRaster(host, surface, before) {
  const region = terminalRasterRegion(host, surface);
  return (region.frame.width !== before.width || region.frame.height !== before.height) && presentsFrame(region, host.scale);
}

/**
 * Measures the display of a card width change. The change frame is the first recorded frame whose measured slot changed. The content
 * frame is the first recorded frame whose measured slot matches the declared slot at or after the display time of the presentation
 * that follows the content read at the new size: the image region presents a raster of its new frame size (host.window regions
 * `presented`, core docs/spec/exposure.md), the screen read names a frame of that raster and the region presents it (presentedScreen), and
 * `host.window.presented` then reports the display time.
 */
async function terminalLayoutObservation(t, s, descriptor, surface, card, directory, cornerRadiusPt) {
  const traced = await withViewContentTrace(t, s, descriptor, surface, async () => {
    const recording = await s.record();
    const grid = await s.get("core.grid");
    const current = grid.cards.find((item) => item.id === card);
    assert.ok(current && Number.isFinite(current.w), `terminal measurement card ${card} has no current width`);
    const before = terminalRasterRegion(await s.get("host.window"), surface).frame;
    const beforeChangeTimeMs = (await monotonicTimeMs(s)).timeMs;
    await s.run("core.grid.size", { card, axis: "x", size: current.w + 80 });
    await s.until("host.window", (host) => presentsResizedRaster(host, surface, before),
      `terminal view ${surface} did not present a raster of its new frame size`);
    const proof = valueProof(descriptor.expectedContent, await descriptor.readContent(s, surface),
      `${descriptor.plugin} view ${surface}`);
    const host = await s.get("host.window");
    assert.ok(presentsResizedRaster(host, surface, before),
      `terminal view ${surface} no longer presents a raster of its new frame size after its content read`);
    const presented = terminalRasterRegion(host, surface).presented;
    const { displayed } = await s.presented();
    const capture = await recording.stop({ after: displayed });
    return { beforeChangeTimeMs, displayed, capture, proof, presented };
  });
  const { beforeChangeTimeMs, displayed, capture, proof, presented } = traced.action;
  assert.equal(capture.limited, false, "terminal layout recording reached its bounded frame limit");
  const paths = frames(capture.frames);
  assert.equal(paths.length, capture.count, "terminal layout recording omitted a frame file");
  assert.ok(paths.length > 0, "terminal layout recording contains no frames");
  const path = join(directory, "layout.json");
  const decoded = paths.map(readFrame);
  writeFileSync(path, JSON.stringify({ beforeChangeTimeMs, displayed, proof, presented, contentFrames: traced.contentFrames,
    events: traced.events, frameFiles: paths, frameTimes: decoded.map(({ time }) => time),
    captureDirectory: capture.frames }, null, 2) + "\n");
  const host = await s.get("host.window");
  const root = terminalDocument(host, surface);
  const nativePlacement = rootNativePlacementBeforeCapture(traced.events, surface, displayed,
    { afterMs: beforeChangeTimeMs });
  const sourceSelection = selectOneShotViewSourceFrame(traced.contentFrames,
    { requestAtMs: beforeChangeTimeMs, nativePlacement });
  const source = sourceSelection.frame;
  assert.ok(source, `terminal observer has no source frame matching its final post-request native placement projection: ${JSON.stringify(sourceSelection.failure)}`);
  const slotInsetsPt = await terminalSlotInsets(s, card, surface);
  const targetRect = { x: root.frame.x, y: root.frame.y,
    width: root.frame.width, height: root.frame.height };
  const measured = decoded.map((frame) => measureTerminalLayoutFrame(frame, { cornerRadiusPt, targetRect }));
  const transition = findFirstChangedSlotFrame(measured, { beforeChangeTimeMs, slotInsetsPt });
  const captureAfter = Math.max(displayed, source.timeRange.upperMs);
  const frameIndex = transition.slotMatchFrameIndices.find((index) => decoded[index].time >= captureAfter);
  assert.ok(frameIndex !== undefined, `terminal layout has no declared-slot pixel match at or after ${captureAfter} ms`);
  const geometry = measured[frameIndex];
  return {
    changeFrame: { frameIndex: transition.changeFrameIndex, frameCount: decoded.length,
      timeMs: decoded[transition.changeFrameIndex].time },
    contentFrame: { surface, frameIndex, frameCount: decoded.length, timeMs: decoded[frameIndex].time,
      requestAtMs: beforeChangeTimeMs, displayedAtMs: displayed, sourceTimeRange: source.timeRange,
      width: source.width, height: source.height, nativePlacement,
      surfaceEvents: traced.events.filter((event) => event?.event === "host.trace.surface" && event.fields?.surface === surface),
      proof },
    sourceFrame: source,
    initialGeometry: { frameIndex, timeMs: decoded[frameIndex].time, cardRectPt: geometry.cardRectPt,
      nativeRectPt: geometry.nativeRectPt, slotInsetsPt },
    events: traced.events,
    captureDirectory: capture.frames,
    evidencePath: path,
  };
}

async function terminalDragObservation(t, s, descriptor, surface, card, configDir, cornerRadiusPt) {
  const beforeGrid = await s.get("core.grid");
  const pane = beforeGrid.cards.find((item) => item.id === card);
  assert.ok(pane, `terminal measurement card ${card} is absent before drag`);
  const plan = rightEdgeWidthDragPlan(beforeGrid, pane);
  await s.presented();
  const measurement = await withDragTraceMode(s, () =>
    withViewContentTrace(t, s, descriptor, surface, async () => drag(s, plan, { capture: true })));
  const traced = measurement.result;
  const run = traced.action;
  mkdirSync(join(configDir, "logs"), { recursive: true });
  const directory = mkdtempSync(join(configDir, "logs", "terminal-view-drag-"));
  writeTerminalDragLayouts(directory, run.layouts);
  const files = frames(run.frames);
  assert.equal(files.length, run.count, "terminal view drag recording omitted finalized frame files");
  writeFileSync(join(directory, "source-frames.json"), JSON.stringify({
    rawEvents: traced.events, contentFrames: traced.contentFrames, frameFiles: files, frameIdentity: run.frameIdentity ?? null,
  }, null, 2) + "\n");
  const captured = files.map(readFrame);
  assert.ok(captured.length > 2, "terminal view drag recording contains too few frames");
  const firstGestureFrameIndex = frameAtOrAfter(captured, run.ticks[0], "terminal drag start");
  const gestureEndedFrameIndex = frameAtOrAfter(captured, run.ticks.at(-1), "terminal drag end");
  assert.ok(gestureEndedFrameIndex >= firstGestureFrameIndex,
    "terminal drag recording does not cover the complete requested gesture");
  const slotInsetsPt = await terminalSlotInsets(s, card, surface);
  const grid = await s.get("core.grid");
  const surfaces = await s.get("core.surfaces");
  const rootSlotInsetsPt = declaredSlotInsets({ grid, surfaces, card, surface });
  const root = terminalDocument(await s.get("host.window"), surface);
  const targetRect = { x: root.frame.x, y: root.frame.y,
    width: root.frame.width, height: root.frame.height };
  const geometryFrames = [];
  for (let frameIndex = firstGestureFrameIndex; frameIndex <= gestureEndedFrameIndex; frameIndex++) {
    const measured = measureTerminalLayoutFrame(captured[frameIndex], { cornerRadiusPt, targetRect });
    geometryFrames.push(dragTailGeometryFrame(frameIndex, measured, slotInsetsPt, OWNER));
  }
  const tailGeometryFrames = [];
  for (let frameIndex = gestureEndedFrameIndex + 1; frameIndex < captured.length; frameIndex++) {
    const measured = measureTerminalLayoutFrame(captured[frameIndex], { cornerRadiusPt, targetRect });
    tailGeometryFrames.push(dragTailGeometryFrame(frameIndex, measured, slotInsetsPt, OWNER));
  }

  const mapped = requireViewContentFrameCoverage(mapViewContentFramesToCapture(traced.contentFrames, captured), {
    gestureStartedAtMs: run.ticks[0], gestureEndedAtMs: run.ticks.at(-1),
  });
  const sourceFrames = mapped.map((source) => {
    const displayCaptureIndex = captured.findIndex((frame) => frame.time >= Math.max(run.displayed, source.timeRange.upperMs));
    return sourceContentFrame(source, source.frameIndex === null ? null : captured[source.frameIndex].time,
      displayCaptureIndex < 0 ? null : { frameIndex: displayCaptureIndex, timeMs: captured[displayCaptureIndex].time }, OWNER);
  });
  writeFileSync(join(directory, "source-frames.json"), JSON.stringify({
    frames: sourceFrames, rawEvents: traced.events, contentFrames: traced.contentFrames,
    frameFiles: files, capturedFrameTimes: captured.map(({ time }) => time), frameIdentity: run.frameIdentity ?? null,
  }, null, 2) + "\n");
  const finalHost = await s.get("host.window");
  const finalRoot = terminalDocument(finalHost, surface);
  return {
    recordedFrameCount: captured.length,
    firstGestureFrameIndex,
    lastGestureFrameIndex: gestureEndedFrameIndex,
    gestureEndedFrameIndex,
    gestureStartedAtMs: run.ticks[0],
    gestureEndedAtMs: run.ticks.at(-1),
    finalPresentation: { displayedAtMs: run.displayed,
      targetViewport: { width: Math.trunc(finalRoot.frame.width), height: Math.trunc(finalRoot.frame.height) },
      targetRectPt: terminalRasterTargetRectPt(finalHost, surface) },
    geometryFrames,
    tailGeometryFrames,
    contentFrames: sourceFrames,
    sourceContentFrames: traced.contentFrames,
    phaseMode: measurement.phaseMode,
    rootSlotInsetsPt,
    layouts: run.layouts,
    ticks: run.ticks,
    events: traced.events,
    captureDirectory: run.frames,
    evidenceDirectory: directory,
  };
}

/** Collects the terminal lifecycle, the initial prompt read through the screen read, source-frame sizes and measured drag geometry. */
export async function collectTerminalViewMeasurements(t, s, descriptor, configDir) {
  const start = await collectViewStartAndMemory(t, s, descriptor);
  const cornerRadiusPt = effectiveCardCornerRadiusPt((await s.get("core.settings")).values);
  const split = await s.run("core.card.split", { card: start.card, side: "right", plugin: descriptor.plugin });
  const surface = split.tab;
  const card = split.card;
  s.cleanup(async () => {
    const grid = await s.get("core.grid");
    if (!grid.cards.some((item) => item.id === card)) return;
    const result = await s.run("core.card.close", { card });
    assert.equal(result?.closed, true, `terminal measurement card ${card} did not close during cleanup`);
    await s.until("core.grid", (value) => !value.cards.some((item) => item.id === card),
      `terminal measurement card ${card} remained during cleanup`);
  });
  const readinessEvidence = await waitForViewReadiness(s, surface, descriptor);
  assert.equal(readinessEvidence.historyEntries, 1, `terminal view ${surface} did not begin at initial history`);
  await setTerminalGeometryBackground(s, surface);
  mkdirSync(join(configDir, "logs"), { recursive: true });
  const directory = mkdtempSync(join(configDir, "logs", "terminal-view-layout-"));
  const layout = await terminalLayoutObservation(t, s, descriptor, surface, card, directory, cornerRadiusPt);
  const dragEvidence = await terminalDragObservation(t, s, descriptor, surface, card, configDir, cornerRadiusPt);
  const closed = await s.run("core.tab.close", { tab: surface });
  assert.equal(closed?.closed, true, `terminal measurement view ${surface} did not close after capture`);
  await s.until("core.surfaces", (items) => !items.some((item) => item.surface === surface),
    `terminal measurement view ${surface} remained after capture`);
  const evidence = { events: [...start.events, ...layout.events, ...dragEvidence.events],
    recordings: [...start.recordings, { directory: layout.captureDirectory }, { directory: dragEvidence.captureDirectory }] };
  const reclaim = await collectViewReclaimMeasurements(t, s, descriptor, start.opened, evidence);
  return {
    plugin: descriptor.plugin,
    host: s.app.name,
    total: start.total,
    reclaim,
    warmDisplay: start.warmDisplay,
    newProcess: { processStarts: start.processStarts, firstDisplays: start.firstDisplays },
    layoutDisplay: [layout],
    drag: dragEvidence,
    _evidence: { ...evidence, layoutDirectory: directory, dragDirectory: dragEvidence.evidenceDirectory },
  };
}
