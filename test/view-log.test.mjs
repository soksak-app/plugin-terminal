import assert from "node:assert/strict";
import test from "node:test";
import { createReporter, createViewLog } from "../build/test/ui/view-log.js";
import { loadDiagnostics } from "../build/test/ui/view-diagnostics.js";

/** A view call route that refuses each runtime.log and answers the other calls. */
function routeRefusingLog(refusal) {
  const calls = [];
  return {
    calls,
    request: async (command, params) => {
      calls.push({ command, params });
      if (command === "runtime.log") throw refusal;
      return null;
    },
  };
}

const routeRefusedRoute = () => routeRefusingLog(new Error("log refused"));

/** Runs fn with console.error captured, and returns the captured lines. */
async function captureErrors(fn) {
  const lines = [];
  const consoleError = console.error;
  console.error = (line) => lines.push(line);
  try {
    await fn();
  } finally {
    console.error = consoleError;
  }
  return lines;
}

test("a refused page record keeps its console line and is reported through runtime.error with where log", async () => {
  const route = routeRefusedRoute();
  const lines = await captureErrors(() => createReporter(route)("page failed"));
  assert.deepEqual(lines, ["runtime.log page failed"]);
  assert.deepEqual(route.calls.filter(({ command }) => command === "runtime.error").map(({ params }) => params),
    [{ where: "log", text: "page failed (refused: log refused)" }]);
});

test("a refused surface log record is reported through runtime.error with where log", async () => {
  const route = routeRefusedRoute();
  const lines = await captureErrors(() => createViewLog(route).warn("sidecar.unknown", { event: "mystery" }));
  assert.deepEqual(lines, ["runtime.log sidecar.unknown"]);
  assert.deepEqual(route.calls.filter(({ command }) => command === "runtime.error").map(({ params }) => params),
    [{ where: "log", text: "sidecar.unknown (refused: log refused)" }]);
});

test("the diagnostics declaration of a build without it is not an error, and any other failed status is refused", async () => {
  const fetched = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    assert.equal(await loadDiagnostics("sok://terminal/ui/terminal.html"), null);
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(loadDiagnostics("sok://terminal/ui/terminal.html"), /answered 500/);
  } finally {
    globalThis.fetch = fetched;
  }
});
