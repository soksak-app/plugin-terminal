// Exercises terminal view start validation, mount, registration, and command handlers at the plugin boundary.
// The page is the real ui/view.js, loaded into a jsdom window of test/fixtures/view-page.mjs. Each call that the page makes on the plugin
// API is recorded by the fixtures of test/fixtures/plugin-api/ and answered as the test arranges.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { startValues } from "../ui/terminal-view.js";
import { SURFACE, callsOf, compositionCalls, openTerminal, regionInput, registered, requests, sidecarSends, sidecarState, terminalElement } from "./fixtures/view-page.mjs";

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
  // The page creates one composition of the region and the overlays, and gives it the input handler of the region.
  const created = callsOf(view, "composition.create");
  assert.equal(created.length, 1, "the page creates its composition once");
  const [elements] = created[0];
  assert.deepEqual(Object.keys(elements.regions), ["view"]);
  assert.deepEqual(Object.keys(elements.overlays).sort(), ["padding-bottom", "padding-left", "padding-right", "padding-top", "scrollbar"]);
  assert.deepEqual(Object.keys(elements.input), ["view"]);
  assert.equal(typeof elements.input.view, "function", "the region input is handled by the page");
  assert.equal(elements.regions.view, terminalElement(view), "the region is the terminal element");
  // Every status and element name is registered through the exposure, and every command through commands.register of the view.
  // A diagnostic build adds the entries of diagnostics.json to the surface declaration, and the page registers them.
  assert.deepEqual(registered(view, "status").sort(), [...declared("status"), ...diagnosticNames("status")].sort());
  assert.deepEqual(registered(view, "element").sort(), declared("element"));
  assert.deepEqual(registered(view, "command").sort(), [...declared("commands"), ...diagnosticNames("commands")].sort());
});

test("a region input delivered while the composition is created reaches the session", async (t) => {
  const input = {
    type: "input",
    actions: [{ type: "insert", text: "ls", replacementRange: null, attributed: false }],
    preedit: { text: "", markedRange: null, selectedRange: { location: 0, length: 0 }, replacementRange: null, attributed: false },
    errors: [], cids: ["native-input-50-1"],
  };
  // The host delivers the input in the answer of the creation, before the creation of the page resolves. The page holds the input
  // until the session reports its state, and then sends it: a region without the input handler would send nothing.
  const view = await openTerminal(t, { create: (elements) => { elements.input.view(input); } });
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
  const answer = await view.exposure.run("terminal.input", { bytes: "bHM=" });
  assert.equal(answer ?? null, null);
  const input = sidecarSends(view).find(({ body }) => carriesInput(body));
  assert.equal(input.id, SURFACE, "the input travels to the session of the surface");
  assert.deepEqual(input.body.actions, [{ type: "insert", text: "bHM=", replacementRange: null, attributed: false }]);
});

test("a command that the page registered with the exposure is also registered with the commands of the view", async (t) => {
  const view = await openTerminal(t);
  // Core sends the forwarded command.run of a registered view command as a command request, which the bridge answers from the handler
  // that the page registered with commands.register; both registrations hold the same handler.
  await sidecarState(view, { event: "state", sessionId: "s1", cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 });
  assert.equal(await view.bridge.runCommand("terminal.input", { bytes: "bHM=" }) ?? null, null);
  assert.deepEqual(sidecarSends(view).find(({ body }) => carriesInput(body)).body.actions,
    [{ type: "insert", text: "bHM=", replacementRange: null, attributed: false }]);
});

test("terminal.close detaches the image region before it ends the sidecar session", async (t) => {
  const view = await openTerminal(t);
  // The command answers after the region is detached and the session is closed.
  const answer = await view.exposure.run("terminal.close", {});
  assert.equal(answer ?? null, null);
  const order = view.bridge.rec.calls.map(({ method, args }) => method === "calls.request" && args[0] === "runtime.sidecar.send"
    ? `send:${args[1].body.operation}` : method);
  const closeSend = order.filter((entry) => entry === "send:close");
  assert.equal(closeSend.length, 1, "the session of the surface closes once");
  assert.notEqual(order.indexOf("composition.dispose"), -1, "the composition of the region is disposed");
  assert.ok(order.indexOf("composition.dispose") < order.indexOf("send:close"), "the region is detached before the session closes");
});

test("the view page reports a failed sidecar startup and releases its composition", async (t) => {
  const view = await openTerminal(t, {
    sidecar: ({ operation }) => {
      if (operation === "open") throw new Error("connect authenticated service: socket missing");
      return null;
    },
  });
  // The report of the failed mount is the last record of the failed startup.
  const report = callsOf(view, "runtime.error").map(([, text]) => text).find((line) => /mount failed/.test(line));
  assert.deepEqual(compositionCalls(view).map(([method]) => method).filter((method) => !method.startsWith("region.")), ["composition.create", "composition.dispose"],
    "a failed sidecar startup releases the composition of the region");
  assert.match(report, /mount failed: connect authenticated service: socket missing/);
  assert.equal(sidecarSends(view).some(({ body }) => body.operation === "close"), false,
    "a session that never opened is not closed");
});

test("a build without a diagnostic declaration registers the declared entries only", async (t) => {
  const view = await openTerminal(t, { diagnostic: false });
  assert.deepEqual(registered(view, "command").sort(), declared("commands"));
  const diagnosticStatuses = diagnostics.exposes.status.map((entry) => entry.name);
  assert.equal(registered(view, "status").some((name) => diagnosticStatuses.includes(name)), false,
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
    const record = view.events.find((record) => record.event === event && (event === "send" ? carriesInput(record.fields.body) : !record.fields.actions?.every(({ type }) => type === "focus")));
    assert.ok(record, event + " record reaches the view log");
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

const focusCalls = (view) => view.bridge.rec.calls.filter(({ method }) => method === "region.focus");

test("a primary press in the separate view runs terminal.focus and requests native keyboard focus", { timeout: 10000 }, async (t) => {
  const view = await openTerminal(t);
  // The page binds the press of the terminal element to the command terminal.focus on pointerdown of the primary button.
  const binding = view.bound.find(({ name }) => name === "terminal.focus");
  assert.equal(binding.element, terminalElement(view));
  assert.equal(binding.options.event, "pointerdown");
  terminalPointer(view);
  await view.settled();
  assert.equal(focusCalls(view).length, 1, "the focus command did not transfer keyboard ownership to the native region");
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
  const view = await openTerminal(t, { region: { focus: () => { throw new Error("native focus refused"); } } });
  terminalPointer(view);
  await view.settled();
  assert.match((await view.exposure.read("terminal.session")).error ?? "", /native focus refused/);
  // The surface error reaches the tab once, with the message of the failure as the call params.
  assert.deepEqual(requests(view, "tab.error"), ["native focus refused"]);
});

test("a refused focus command releases the terminal session and composition", { timeout: 10000 }, async (t) => {
  // The registration of the command terminal.focus with the commands of the view is refused while the session is open.
  const view = await openTerminal(t, { arrange: (bridge) => bridge.rec.arrange("commands.register", (name) => {
    if (name === "terminal.focus") throw new Error("command terminal.focus is not declared");
  }) });
  assert.equal(compositionCalls(view).filter(([method]) => method === "composition.dispose").length, 1);
  assert.equal(sidecarSends(view).filter(({ body }) => body.operation === "close").length, 1);
  assert.match(callsOf(view, "runtime.error").map(([, text]) => text).find((line) => /mount failed/.test(line)), /mount failed: command terminal\.focus is not declared/);
});
