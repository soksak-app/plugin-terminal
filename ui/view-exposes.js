// The exposure declarations of the terminal view (core docs/spec/plugins.md, diagnostics). This module imports no SDK export, so a
// test imports it directly.

/**
 * Returns the exposure bundle that the view loads for createExpose. The start values are the declarations of the surface, and in a
 * diagnostic build they already hold the diagnostics.json entries, because the workbench adds them to the surface declarations. The
 * view adds nothing for the diagnostics, so each entry is declared once.
 *
 *     start        the frozen start values, whose declarations are the surface declarations
 */
export function viewExposes(start) {
  return start.declarations;
}
