import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createEmitter } from "../ui/events.js";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const catalog = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));

const LEVELS = ["error", "warn", "info", "debug", "trace"];
const CLASSES = ["lifecycle", "input", "call", "io", "frame"];
const TYPES = ["string", "number", "boolean", "array", "object", "null"];

/** A runtime whose log stores the calls it receives. */
function createRuntime() {
  const stored = [];
  const log = Object.fromEntries(LEVELS.map((level) => [level, (event, fields) => stored.push({ level, event, fields })]));
  return { runtime: { log }, stored };
}

test("the manifest names the catalog and the release holds it with the emitter", () => {
  assert.equal(manifest.events, "events.json");
  assert.ok(existsSync(new URL(`../${manifest.events}`, import.meta.url)));
  assert.ok(pkg.files.includes("events.json"));
  assert.ok(pkg.files.includes("ui/events.js"));
});

test("the catalog declares the layer plugin and events of the form plugin.terminal.<name>", () => {
  assert.equal(catalog.schema, 2);
  assert.deepEqual(catalog.layers, ["plugin"]);
  assert.ok(Object.keys(catalog.events).length > 0);
  for (const [name, event] of Object.entries(catalog.events)) {
    assert.match(name, /^plugin\.terminal\.[a-z_]+(\.[a-z_]+)*$/, name);
    assert.equal(event.layer, "plugin", name);
    assert.ok(CLASSES.includes(event.class), `${name}: class ${event.class}`);
    for (const level of [event.level].flat()) assert.ok(LEVELS.includes(level), `${name}: level ${level}`);
    assert.ok(event.description.length > 0, name);
    for (const [field, type] of Object.entries(event.fields)) {
      for (const part of type.split("|")) assert.ok(TYPES.includes(part), `${name}.${field}: type ${type}`);
    }
  }
});

test("the emitter stores an event of the plugin without its prefix", () => {
  const { runtime, stored } = createRuntime();
  const emitEvent = createEmitter(runtime, "terminal");
  emitEvent("info", "plugin.terminal.session.gate", { open: true });
  assert.deepEqual(stored, [{ level: "info", event: "session.gate", fields: { open: true } }]);
});

test("the emitter builds the fields of a builder when it stores the event", () => {
  const { runtime, stored } = createRuntime();
  const emitEvent = createEmitter(runtime, "terminal");
  emitEvent("trace", "plugin.terminal.region", () => ({ type: "key" }));
  assert.deepEqual(stored, [{ level: "trace", event: "region", fields: { type: "key" } }]);
});

test("the emitter rejects a name of another plugin, an unknown level and fields that are no object", () => {
  const { runtime, stored } = createRuntime();
  const emitEvent = createEmitter(runtime, "terminal");
  assert.throws(() => emitEvent("info", "plugin.browser.open", {}), /plugin\.terminal\./);
  assert.throws(() => emitEvent("loud", "plugin.terminal.open", {}), /level/);
  assert.throws(() => emitEvent("info", "plugin.terminal.open", null), /fields/);
  assert.deepEqual(stored, []);
});
