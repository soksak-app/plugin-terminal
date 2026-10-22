// The diagnostics declaration of the terminal view page (core docs/spec/plugins.md, diagnostics).
/**
 * The diagnostics module of this plugin, which is staged only in a diagnostic build: the declaration file decides, as the
 * workbench reads the declaration of diagnostics.json for each plugin. In a build without it the route serves no file, and
 * the page registers no diagnostic entry. Returns {declaration, attach}, or null without a diagnostic declaration.
 */
export async function loadDiagnostics(pageHref = window.location.href) {
  let response;
  try {
    response = await fetch(new URL("../diagnostics.json", pageHref).href);
  } catch (error) {
    throw new Error(`the diagnostics declaration of the terminal view cannot be read: ${error?.message ?? error}`);
  }
  // A build that stages no diagnostics.json serves the request as not found, so the page has no diagnostic entry.
  // Any other failed status is a failure to read the declaration, which the page reports.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`the diagnostics declaration of the terminal view answered ${response.status}`);
  const declaration = await response.json();
  return { declaration, attach: (await import("./terminal-diagnostics.js")).attach };
}
