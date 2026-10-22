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

const VIEW_IMPORTS = JSON.parse(readFileSync(new URL("../view-check.json", import.meta.url), "utf8")).viewImports;

// The check of a view page: exactly one static import map whose imports equal VIEW_IMPORTS, and no other field.
function checkViewPage(html) {
  const maps = [...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)];
  assert.equal(maps.length, 1, "expected one import map");
  const map = JSON.parse(maps[0][1]);
  const field = Object.keys(map).find((key) => key !== "imports");
  assert.equal(field, undefined, "the import map has an unexpected field");
  assert.deepEqual(map.imports, VIEW_IMPORTS);
}

test("the view page carries the import map of the view and the page script", () => {
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
  // terminal.input names the payload bytes, and the session sends the text base64 encoded as the input message carries it.
  assert.equal(Buffer.from(input.body.bytes, "base64").toString(), "bHM=");
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
  const { createViewLog } = await import("../build/test/ui/view-log.js");
  host.context.runtime.log = createViewLog({ request: async (command, params) => { records.push({ command, params }); } });
  await mountView(host);
  host.sidecar.trigger(START.surface, { event: "state", sessionId: "s1", cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 });
  await host.settle();
  host.region.trigger("insert", { text: "ls", cids: ["native-input-49-5"] });
  await host.settle();
  const input = host.sidecar.sent.find(({ body }) => body.operation === "input");
  assert.ok(input.cids.length > 0, "input has a real correlation chain");
  for (const event of ["input", "send"]) {
    const record = records.find(({ command, params }) => command === "runtime.log" && params.event === event && (event !== "send" || params.fields.body.operation === "input"));
    assert.ok(record, event + " record reaches the view route");
    assert.deepEqual(record.params.cids, input.cids, event + " retains correlation identifiers");
  }
});
