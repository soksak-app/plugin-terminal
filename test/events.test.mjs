import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const catalog = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));

const LEVELS = ["error", "warn", "info", "debug", "trace"];
const CLASSES = ["lifecycle", "input", "call", "io", "frame"];
const TYPES = ["string", "number", "boolean", "array", "object", "null"];

test("the manifest names the catalog, the release holds it and no emitter module remains", () => {
  assert.equal(manifest.events, "events.json");
  assert.ok(existsSync(new URL(`../${manifest.events}`, import.meta.url)));
  assert.ok(pkg.files.includes("events.json"));
  assert.ok(!pkg.files.includes("ui/events.js"));
  assert.ok(!existsSync(new URL("../ui/events.js", import.meta.url)));
});

test("the catalog declares the layer plugin and events of the form plugin.terminal.<name>", () => {
  assert.equal(catalog.schema, 3);
  assert.deepEqual(catalog.layers, ["plugin"]);
  assert.ok(Object.keys(catalog.events).length > 0);
  const frame = catalog.events["plugin.terminal.frame"].fields;
  assert.ok(frame.required.includes("frame"));
  assert.deepEqual(frame.properties.frame.type, ["object", "null"]);
  assert.deepEqual(frame.properties.frame.required, ["generation", "raster", "sequence"]);
  assert.equal(frame.properties.frame.additionalProperties, false);
  for (const [name, event] of Object.entries(catalog.events)) {
    assert.match(name, /^plugin\.terminal\.[a-z_]+(\.[a-z_]+)*$/, name);
    assert.equal(event.layer, "plugin", name);
    assert.ok(CLASSES.includes(event.class), `${name}: class ${event.class}`);
    for (const level of [event.level].flat()) assert.ok(LEVELS.includes(level), `${name}: level ${level}`);
    assert.ok(event.description.length > 0, name);
    assert.equal(event.fields.$schema, "https://json-schema.org/draft/2020-12/schema", name);
    assert.equal(event.fields.type, "object", name);
    assert.ok(Array.isArray(event.fields.required), name);
    for (const field of event.fields.required) assert.ok(Object.hasOwn(event.fields.properties, field), `${name}.${field}`);
    for (const [field, property] of Object.entries(event.fields.properties)) {
      for (const type of [property.type].flat()) assert.ok(TYPES.includes(type), `${name}.${field}: type ${type}`);
    }
  }
});
