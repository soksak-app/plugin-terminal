// The diagnostics declaration of the terminal view page (core docs/spec/plugins.md, diagnostics).
/**
 * The diagnostics module of this plugin, which is staged only in a diagnostic build. The start values of the view carry the
 * diagnostic declaration that core read for the plugin, or null in a build without it, so the page requests no file and
 * registers no diagnostic entry without a declaration. Returns {declaration, attach}, or null without a diagnostic declaration.
 */
export async function loadDiagnostics(start) {
  if (!Object.hasOwn(start, "diagnostics")) {
    throw new Error("the start values of the terminal view have no diagnostics: window.sokSurface {surface, params, origin, project, declarations, diagnostics} carries it");
  }
  if (start.diagnostics === null) return null;
  return { declaration: start.diagnostics, attach: (await import("./terminal-diagnostics.js")).attach };
}

export function startViewDocumentFrames({ viewWindow, observe, log }) {
  const readSourceClock = () => ({
    documentTimeOriginMs: viewWindow.performance.timeOrigin,
    sourceNowMs: viewWindow.performance.now(),
    sourceResolutionMs: 1,
  });
  const sourceClock = readSourceClock();
  const stop = observe({
    document: viewWindow.document,
    log,
    ResizeObserver: viewWindow.ResizeObserver,
    requestAnimationFrame: viewWindow.requestAnimationFrame.bind(viewWindow),
    cancelAnimationFrame: viewWindow.cancelAnimationFrame.bind(viewWindow),
    now: viewWindow.performance.now.bind(viewWindow.performance),
    timeOriginMs: viewWindow.performance.timeOrigin,
  });
  return { stop, sourceClock, readSourceClock };
}
