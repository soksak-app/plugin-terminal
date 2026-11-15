// The fixtures of the plugin API (test/fixtures/plugin-api/) and the resolve hook that maps the specifiers of the import map of the
// page to them. A test of the plugin judges the calls that the page makes on the interface; this test judges that the interface the
// page imports is the fixture, that it refuses a use that the test did not arrange, and that it keeps the calls it records.
import assert from "node:assert/strict";
import test from "node:test";

const FIXTURES = new URL("./fixtures/plugin-api/", import.meta.url).href;

test("the specifiers that the page imports resolve to the fixture modules of this repository", { timeout: 5000 }, () => {
  for (const [specifier, file] of [
    ["@soksak/plugin-api", "index.mjs"],
    ["@soksak/plugin-api/view", "view.mjs"],
    ["@soksak/plugin-api/screen-hash", "screen-hash.mjs"],
    ["@soksak/plugin-api/diagnostic-view-frames", "diagnostic-view-frames.mjs"],
  ]) {
    assert.equal(import.meta.resolve(specifier), FIXTURES + file, specifier);
  }
});

test("a subpath that the import map of the page does not list is not mapped", { timeout: 5000 }, async () => {
  await assert.rejects(import("@soksak/plugin-api/testing"), (error) => error.code === "ERR_MODULE_NOT_FOUND" || error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED");
});

test("a fixture export refuses a call that the test did not arrange and answers one that it did", { timeout: 5000 }, async () => {
  const { shellQuotePath } = await import("@soksak/plugin-api");
  shellQuotePath.reset();
  assert.throws(() => shellQuotePath("/a b"), /shellQuotePath is not arranged by the test/);
  shellQuotePath.arrange((path) => `<${path}>`);
  assert.equal(shellQuotePath("/a b"), "</a b>");
  assert.deepEqual(shellQuotePath.calls.map(({ method, args }) => ({ method, args })),
    [{ method: "shellQuotePath", args: ["/a b"] }, { method: "shellQuotePath", args: ["/a b"] }]);
  shellQuotePath.reset();
});

test("the view bridge records its calls, refuses an unarranged method and delivers a pushed event to its listeners", { timeout: 5000 }, async () => {
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  const bridge = createViewBridge({});
  assert.throws(() => bridge.calls.request("tab.title", "x"), /calls\.request is not arranged by the test/);
  bridge.rec.arrange("calls.request", async (command, params) => ({ command, params }));
  assert.deepEqual(await bridge.calls.request("tab.title", "x"), { command: "tab.title", params: "x" });
  const received = [];
  bridge.runtime.theme((theme) => received.push(theme));
  bridge.push("theme", null, { scheme: "dark" });
  assert.deepEqual(received, [{ scheme: "dark" }]);
  assert.deepEqual(bridge.rec.calls.map(({ method }) => method), ["calls.request", "calls.request", "runtime.theme"]);
});

test("a registered command runs when the test drives it, and bind runs the command of the element on its event until dispose", { timeout: 5000 }, async () => {
  const { createExpose } = await import("@soksak/plugin-api");
  const port = { register: async () => {}, onRequest: () => {}, reply: () => {}, changed: () => {}, report: () => {} };
  const exposure = createExpose(port, () => ({}));
  const runs = [];
  await exposure.command("demo.run", (params) => { runs.push(params); return "done"; });
  assert.equal(await exposure.run("demo.run", { a: 1 }), "done");
  await assert.rejects(exposure.run("demo.other", {}), /command demo\.other is not registered/);
  const target = new EventTarget();
  target.dataset = {};
  await exposure.bind(target, "demo.run", { b: 2 }, { event: "ping", when: (event) => event.ok === true });
  target.dispatchEvent(Object.assign(new Event("ping"), { ok: false }));
  target.dispatchEvent(Object.assign(new Event("ping"), { ok: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runs, [{ a: 1 }, { b: 2 }]);
  await exposure.dispose();
  target.dispatchEvent(Object.assign(new Event("ping"), { ok: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runs, [{ a: 1 }, { b: 2 }]);
});
