// Exercises terminal view start validation, mount, registration, and command handlers at the plugin boundary.
// Core view-bridge behavior is covered by core tests; this file never imports or runs that implementation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { START, createViewPage } from "./view-host.mjs";
import { mountPage as mountTerminalPage, startValues } from "../build/test/ui/terminal-view.js";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const diagnostics = JSON.parse(readFileSync(new URL("../diagnostics.json", import.meta.url), "utf8"));

async function mountView(host) {
  host.page = await mountTerminalPage(host.context, host.report, host.window.document);
  await host.settle();
}

// The check of a view page (core docs/spec/plugin-processes.md, rule 4): the page begins with its doctype and holds no import map,
// because the host inserts the view import map after the doctype of each view page.
function checkViewPage(html) {
  assert.match(html, /^<!doctype html>/i, "the view page begins with its doctype");
  assert.doesNotMatch(html, /<script\b[^>]*\btype\s*=\s*["']?importmap\b/i, "the view page holds no import map of its own");
}

test("the view page begins with its doctype, holds no import map, and carries the page script", () => {
  const html = readFileSync(new URL("../ui/terminal.html", import.meta.url), "utf8");
  assert.equal(checkViewPage(html), undefined);
  assert.match(html, /<script type="module" src="\.\/view\.js"><\/script>/);
});

test("the view start values reject a page without host injection", () => {
  assert.throws(() => startValues({ sokSurface: null, location: { host: "terminal" } }),
    /the view of terminal has no start values: the host provides window\.sokSurface/);
});

const declared = (kind) => manifest.exposes[kind].map((entry) => entry.name).sort();

test("the view page opens the sidecar session of its surface and registers the declared entries", async (t) => {
  const host = createViewPage(t, "open");
  await mountView(host);
  await host.settle();
  // The session of the sidecar is keyed by the surface id of the view, and it opens the declared image region.
  const open = host.sidecar.sent.find(({ body }) => body.operation === "open");
  assert.equal(open.id, START.surface);
  assert.equal(open.body.image, "view");
  assert.equal(open.body.shell, "/bin/sh");
  // The region of the composition is attached with the declared sidecar, and the page placed the region and the overlays.
  assert.deepEqual(host.regionCalls[0], ["image.attach", { name: "view", sidecar: manifest.surface.composition.regions[0].sidecar }]);
  assert.equal(host.places.length > 0, true, "the page placed its composition");
  assert.deepEqual(host.places[0].regions.map(({ name }) => name), ["view"]);
  // Every declared status and dom name is registered through the relay, and every command through the registry.
  const kinds = (group) => host.registrations.filter(({ kind }) => kind === group).map(({ name }) => name).sort();
  // A diagnostic build adds the entries of diagnostics.json to the surface declaration, and the page registers them.
  const diagnosticNames = (group) => diagnostics.exposes[group].map((entry) => entry.name);
  assert.deepEqual(kinds("status"), [...declared("status"), ...diagnosticNames("status")].sort());
  assert.deepEqual(kinds("dom"), declared("dom"));
  assert.deepEqual([...host.commands].sort(), [...declared("commands"), ...diagnosticNames("commands")].sort());
});

test("the theme of the view reaches the session with the card colors", async (t) => {
  const host = createViewPage(t, "theme");
  await mountView(host);
  await host.settle();
  assert.deepEqual(host.sidecar.sent.find(({ body }) => body.operation === "theme")?.body,
    { operation: "theme", mode: "dark", background: "#ffffff", foreground: "#252735", cursor: "#252735", selection: "#5962e8" });
});

test("a registered terminal command reaches its handler", async (t) => {
  const host = createViewPage(t, "command");
  await mountView(host);
  await host.settle();
  host.sidecar.trigger(START.surface, { event: "state", sessionId: "s1", cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 });
  await host.settle();
  const answer = await host.exposureRequest(9001, "command.run", { name: "terminal.input", params: { bytes: "bHM=" } });
  await host.settle();
  assert.equal(answer, null);
  const input = host.sidecar.sent.find(({ body }) => body.operation === "input");
  assert.equal(input.id, START.surface, "the input travels to the session of the surface");
  assert.deepEqual(input.body.actions, [{ type: "insert", text: "bHM=", replacementRange: null, attributed: false }]);
});

test("terminal.close detaches the image region before it ends the sidecar session", async (t) => {
  const host = createViewPage(t, "close-order");
  await mountView(host);
  await host.settle();
  const answer = await host.exposureRequest(9002, "command.run", { name: "terminal.close", params: {} });
  await host.settle();
  assert.equal(answer, null);
  const detach = host.received.findIndex(({ command }) => command === "image.detach");
  const closeSend = host.received.filter(({ command, params }) =>
    command === "runtime.sidecar.send" && params?.body?.operation === "close");
  assert.equal(closeSend.length, 1, "the session of the surface closes once");
  const closeIndex = host.received.indexOf(closeSend[0]);
  assert.notEqual(detach, -1, "the image region is detached");
  assert.ok(detach < closeIndex, "the region is detached before the session closes");
});

test("the view page reports a failed sidecar startup and releases its composition", async (t) => {
  const host = createViewPage(t, "open-failure", { openError: "connect authenticated service: socket missing" });
  await mountView(host);
  await host.settle();
  assert.deepEqual(host.regionCalls.map(([command]) => command), ["image.attach", "image.detach"],
    "a failed sidecar startup releases the native image composition");
  const report = host.logs.find(({ event }) => event === "plugin.terminal.report");
  assert.match(report.fields.text, /mount failed: connect authenticated service: socket missing/);
  assert.equal(host.sidecar.sent.some(({ body }) => body.operation === "close"), false,
    "a session that never opened is not closed");
});

test("a build without a diagnostic declaration registers the declared entries only", async (t) => {
  const host = createViewPage(t, "release", { diagnostic: false });
  await mountView(host);
  await host.settle();
  assert.deepEqual([...host.commands].sort(), declared("commands"));
  const diagnosticStatuses = diagnostics.exposes.status.map((entry) => entry.name);
  assert.equal(host.registrations.some(({ name }) => diagnosticStatuses.includes(name)), false,
    "a build without the diagnostic declaration registers no diagnostic entry");
});


test("terminal input and send records carry the sidecar correlation identifiers", async (t) => {
  const host = createViewPage(t, "log-cids");
  const records = [];
  host.context.runtime.log = Object.fromEntries(["error", "warn", "info", "debug", "trace"].map((level) => [level,
    (event, fields, options) => records.push({ level, event, fields: typeof fields === "function" ? fields() : fields, cids: options?.cids })]));
  await mountView(host);
  host.sidecar.trigger(START.surface, { event: "state", sessionId: "s1", cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 });
  await host.settle();
  host.region.trigger("input", {
    type: "input",
    actions: [{ type: "insert", text: "ls", replacementRange: null, attributed: false }],
    preedit: { text: "", markedRange: null, selectedRange: { location: 0, length: 0 }, replacementRange: null, attributed: false },
    errors: [], cids: ["native-input-49-5"],
  });
  await host.settle();
  const input = host.sidecar.sent.find(({ body }) => body.operation === "input");
  assert.ok(input.cids.length > 0, "input has a real correlation chain");
  for (const event of ["input", "send"]) {
    const record = records.find((record) => record.event === event && (event !== "send" || record.fields.body.operation === "input"));
    assert.ok(record, event + " record reaches the view route");
    assert.deepEqual(record.cids, input.cids, event + " retains correlation identifiers");
  }
});


function terminalPointer(host, button = 0) {
  const view = host.context.exposure.getDom("terminal.view");
  view.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 400 });
  view.setPointerCapture = () => {};
  view.hasPointerCapture = () => true;
  view.releasePointerCapture = () => {};
  const event = new host.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button, clientX: 80, clientY: 32 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  view.dispatchEvent(event);
  return event;
}

test("a primary press in the separate view runs terminal.focus and requests native keyboard focus", { timeout: 10000 }, async (t) => {
  const host = createViewPage(t, "pointer-focus");
  await mountView(host);
  const event = terminalPointer(host);
  await host.settle();
  assert.deepEqual(host.commandRuns, [{ name: "terminal.focus", params: {} }], "the view press did not run its declared focus command");
  assert.deepEqual(host.regionCalls.filter(([name]) => name === "image.focus"), [["image.focus", { name: "view" }]],
    "the focus command did not transfer keyboard ownership to the native region");
  assert.equal(host.context.exposure.getDom("terminal.view").dataset.command, "terminal.focus");
  assert.equal(event.defaultPrevented, true, "the DOM must not retake focus after the native focus command");
  await host.page.dispose();
});

test("the view focus binding ignores another button and is removed when the page is disposed", { timeout: 10000 }, async (t) => {
  const host = createViewPage(t, "pointer-focus-dispose");
  await mountView(host);
  assert.equal(host.bindings.length, 1, "the view has no focus binding to dispose");
  terminalPointer(host, 2);
  await host.settle();
  assert.deepEqual(host.commandRuns, []);
  const view = host.context.exposure.getDom("terminal.view");
  await host.page.dispose();
  view.dispatchEvent(new host.window.MouseEvent("pointerdown", { button: 0 }));
  await host.settle();
  assert.deepEqual(host.commandRuns, [], "a disposed page still runs its focus command");
});

test("a rejected focus from a view press reaches the session and the surface error path", { timeout: 10000 }, async (t) => {
  const host = createViewPage(t, "pointer-focus-failure");
  await mountView(host);
  const failure = new Error("native focus refused");
  host.region.focus = async () => { throw failure; };
  terminalPointer(host);
  await host.settle();
  assert.match(host.context.exposure.getStatus("terminal.session").read().error ?? "", /native focus refused/);
  assert.deepEqual(host.reports.filter(([kind, phase]) => kind === "status" && phase === "error"), [["status", "error", failure]]);
  await host.page.dispose();
});


test("a refused view focus binding releases the terminal session and composition", { timeout: 10000 }, async (t) => {
  const host = createViewPage(t, "pointer-focus-bind-failure", { bindError: new Error("focus binding refused") });
  await mountView(host);
  assert.equal(host.page, null, "a page without its required focus binding must not remain mounted");
  assert.equal(host.regionCalls.filter(([command]) => command === "image.detach").length, 1);
  assert.equal(host.sidecar.sent.filter(({ body }) => body.operation === "close").length, 1);
  assert.match(host.logs.find(({ event }) => event === "plugin.terminal.report").fields.text, /mount failed: focus binding refused/);
});
