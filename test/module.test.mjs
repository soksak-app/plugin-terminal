// Exercises terminal view start validation, mount, registration, and command handlers at the plugin boundary.
// The page is the real ui/view.js, loaded into the view window of test/fixtures/host.mjs, which answers each call of the page by the view wire.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { startValues } from "../ui/terminal-view.js";
import { DECLARATIONS, SURFACE, commandsRegistered, exposure, imageCalls, openTerminal, regionInput, sidecarSends, sidecarState, terminalElement } from "./fixtures/terminal-view.mjs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const diagnostics = JSON.parse(readFileSync(new URL("../diagnostics.json", import.meta.url), "utf8"));

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
const diagnosticNames = (group) => diagnostics.exposes[group].map((entry) => entry.name);

test("the view page opens the sidecar session of its surface and registers the declared entries", async (t) => {
  const view = await openTerminal(t);
  // The session of the sidecar is keyed by the surface id of the view, and it opens the declared image region.
  const open = sidecarSends(view).find(({ body }) => body.operation === "open");
  assert.equal(open.id, SURFACE);
  assert.equal(open.body.image, "view");
  assert.equal(open.body.shell, "/bin/sh");
  // The region of the composition is attached with the declared sidecar, and the page placed the region and the overlays.
  assert.deepEqual(imageCalls(view)[0], ["image.attach", { name: "view", sidecar: manifest.surface.composition.regions[0].sidecar }]);
  const placed = view.calls.find((call) => call.command === "composition.place");
  assert.deepEqual(placed.params.regions.map(({ name }) => name), ["view"]);
  // The creation attaches the region before it places it. The input handler is passed with the creation and has no wire form, so
  // the test of a region input during the creation checks that the handler exists.
  assert.ok(view.calls.findIndex(({ command }) => command === "image.attach") < view.calls.indexOf(placed), "the region is attached before it is placed");
  // Every declared status and element name is registered through the relay, and every command through the registry.
  // A diagnostic build adds the entries of diagnostics.json to the surface declaration, and the page registers them.
  assert.deepEqual(view.registered("status").sort(), [...declared("status"), ...diagnosticNames("status")].sort());
  assert.deepEqual(view.registered("element").sort(), declared("element"));
  assert.deepEqual(commandsRegistered(view).sort(), [...declared("commands"), ...diagnosticNames("commands")].sort());
});

test("a region input delivered while the composition is created reaches the session", async (t) => {
  const input = {
    type: "input",
    actions: [{ type: "insert", text: "ls", replacementRange: null, attributed: false }],
    preedit: { text: "", markedRange: null, selectedRange: { location: 0, length: 0 }, replacementRange: null, attributed: false },
    errors: [], cids: ["native-input-50-1"],
  };
  // The host delivers the input in the answer of the attach, before the creation of the page resolves. The page holds the input until
  // the session reports its state, and then sends it: a region without the input handler would send nothing.
  const view = await openTerminal(t, {
    image: { attach: (_params, host) => {
      host.push("image-event", { name: "view", event: input });
      return null;
    } },
  });
  await sidecarState(view, { event: "state", sessionId: "s1", cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 });
  const delivered = sidecarSends(view).find(({ body }) => carriesInput(body));
  assert.ok(delivered, "the input delivered during the creation reached the session");
  assert.deepEqual(delivered.body.actions, input.actions);
  assert.deepEqual(delivered.cids, input.cids);
});

test("the theme of the view reaches the session with the card colors", async (t) => {
  const view = await openTerminal(t);
  assert.deepEqual(sidecarSends(view).find(({ body }) => body.operation === "theme")?.body,
    { operation: "theme", mode: "dark", background: "#ffffff", foreground: "#252735", cursor: "#252735", selection: "#5962e8" });
});

// A session that opens sends the focus of the region in a message of its own, which is not input of the test.
const carriesInput = (body) => body.operation === "input" && !body.actions.every(({ type }) => type === "focus");

test("a registered terminal command reaches its handler", async (t) => {
  const view = await openTerminal(t);
  await sidecarState(view, { event: "state", sessionId: "s1", cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 });
  // The command answers after its input is sent.
  const answer = await exposure(view, "command.run", { name: "terminal.input", params: { bytes: "bHM=" } });
  assert.equal(answer, null);
  const input = sidecarSends(view).find(({ body }) => carriesInput(body));
  assert.equal(input.id, SURFACE, "the input travels to the session of the surface");
  assert.deepEqual(input.body.actions, [{ type: "insert", text: "bHM=", replacementRange: null, attributed: false }]);
});

test("terminal.close detaches the image region before it ends the sidecar session", async (t) => {
  const view = await openTerminal(t);
  // The command answers after the region is detached and the session is closed.
  const answer = await exposure(view, "command.run", { name: "terminal.close", params: {} });
  assert.equal(answer, null);
  const order = view.calls.map(({ command, params }) => command === "runtime.sidecar.send" ? `send:${params.body.operation}` : command);
  const closeSend = order.filter((entry) => entry === "send:close");
  assert.equal(closeSend.length, 1, "the session of the surface closes once");
  assert.notEqual(order.indexOf("image.detach"), -1, "the image region is detached");
  assert.ok(order.indexOf("image.detach") < order.indexOf("send:close"), "the region is detached before the session closes");
});

test("the view page reports a failed sidecar startup and releases its composition", async (t) => {
  const view = await openTerminal(t, {
    sidecar: ({ operation }) => {
      if (operation === "open") throw new Error("connect authenticated service: socket missing");
      return null;
    },
  });
  // The report of the failed mount is the last record of the failed startup.
  const report = view.observed.errors.find((line) => /mount failed/.test(line));
  assert.deepEqual(imageCalls(view).map(([command]) => command), ["image.attach", "image.detach"],
    "a failed sidecar startup releases the native image composition");
  assert.match(report, /mount failed: connect authenticated service: socket missing/);
  assert.equal(sidecarSends(view).some(({ body }) => body.operation === "close"), false,
    "a session that never opened is not closed");
});

test("a build without a diagnostic declaration registers the declared entries only", async (t) => {
  const view = await openTerminal(t, { diagnostic: false });
  assert.deepEqual(commandsRegistered(view).sort(), declared("commands"));
  const diagnosticStatuses = diagnostics.exposes.status.map((entry) => entry.name);
  assert.equal(view.registered("status").some((name) => diagnosticStatuses.includes(name)), false,
    "a build without the diagnostic declaration registers no diagnostic entry");
});

test("terminal input and send records carry the sidecar correlation identifiers", async (t) => {
  const view = await openTerminal(t);
  await sidecarState(view, { event: "state", sessionId: "s1", cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 });
  await regionInput(view, {
    type: "input",
    actions: [{ type: "insert", text: "ls", replacementRange: null, attributed: false }],
    preedit: { text: "", markedRange: null, selectedRange: { location: 0, length: 0 }, replacementRange: null, attributed: false },
    errors: [], cids: ["native-input-49-5"],
  });
  const input = sidecarSends(view).find(({ body }) => carriesInput(body));
  assert.ok(input.cids.length > 0, "input has a real correlation chain");
  for (const event of ["input", "send"]) {
    const record = view.events.find((record) => record.event === "plugin.terminal." + event && (event === "send" ? carriesInput(record.fields.body) : !record.fields.actions?.every(({ type }) => type === "focus")));
    assert.ok(record, event + " record reaches the view route");
    assert.deepEqual(record.cids, input.cids, event + " retains correlation identifiers");
  }
});

// A primary press on the terminal element, which the page binds to terminal.focus. The press carries its pointer in the element rectangle.
function terminalPointer(view, button = 0) {
  const element = terminalElement(view);
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 400 });
  element.setPointerCapture = () => {};
  element.hasPointerCapture = () => true;
  element.releasePointerCapture = () => {};
  const event = new view.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button, clientX: 80, clientY: 32 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  element.dispatchEvent(event);
  return event;
}

const focusCalls = (view) => imageCalls(view).filter(([command]) => command === "image.focus");

test("a primary press in the separate view runs terminal.focus and requests native keyboard focus", { timeout: 10000 }, async (t) => {
  const view = await openTerminal(t);
  const event = terminalPointer(view);
  await view.settled();
  assert.deepEqual(focusCalls(view), [["image.focus", { name: "view" }]],
    "the focus command did not transfer keyboard ownership to the native region");
  assert.equal(terminalElement(view).dataset.command, "terminal.focus");
  assert.equal(event.defaultPrevented, true, "the DOM must not retake focus after the native focus command");
});

test("the view focus binding ignores another button and is removed when the page is disposed", { timeout: 10000 }, async (t) => {
  const view = await openTerminal(t);
  // The binding decides in the call of the event whether the press runs its command.
  terminalPointer(view, 2);
  await view.settled();
  assert.deepEqual(focusCalls(view), [], "another button ran the focus command");
  // The page ends as the host ends it: pagehide disposes the mount, which removes the binding and the element.
  const element = terminalElement(view);
  view.window.dispatchEvent(new view.window.Event("pagehide"));
  await view.settled();
  assert.equal(terminalElement(view), null, "the page removed its terminal element");
  element.dispatchEvent(new view.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
  await view.settled();
  assert.deepEqual(focusCalls(view), [], "a disposed page still runs its focus command");
});

test("a rejected focus from a view press reaches the session and the surface error path", { timeout: 10000 }, async (t) => {
  const view = await openTerminal(t, { faults: { "composition.image.focus": "native focus refused" } });
  terminalPointer(view);
  await view.settled();
  assert.match((await exposure(view, "status.get", { name: "terminal.session" })).error ?? "", /native focus refused/);
  // The surface error reaches the tab once, with the message of the failure as the call params.
  assert.deepEqual(view.calls.filter(({ command }) => command === "tab.error").map(({ command, params }) => ({ command, params })),
    [{ command: "tab.error", params: "native focus refused" }]);
});

test("a refused focus command releases the terminal session and composition", { timeout: 10000 }, async (t) => {
  // The focus command is not declared, so the registration of the command is refused by the host while the session is open.
  const declarations = { ...DECLARATIONS, commands: DECLARATIONS.commands.filter(({ name }) => name !== "terminal.focus") };
  const view = await openTerminal(t, { declarations });
  assert.equal(imageCalls(view).filter(([command]) => command === "image.detach").length, 1);
  assert.equal(sidecarSends(view).filter(({ body }) => body.operation === "close").length, 1);
  assert.match(view.observed.errors.find((line) => /mount failed/.test(line)), /mount failed: command terminal\.focus is not declared/);
});
