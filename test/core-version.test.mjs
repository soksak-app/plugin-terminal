import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the core compatibility documents state the engines.soksak that the package declares", { timeout: 1000 }, () => {
  const statements = (file) => [...readFileSync(new URL(`../docs/spec/${file}`, import.meta.url), "utf8").matchAll(/`engines\.soksak: "([^"]*)"`/g)]
    .map((match) => match[1]);
  assert.deepEqual(
    { english: statements("core-compatibility.md"), korean: statements("core-compatibility.ko.md") },
    { english: [pkg.engines.soksak], korean: [pkg.engines.soksak] },
  );
});

// Core 0.0.39 and earlier accept only the exposes kinds status, commands and dom, so they refuse the exposes.element of
// plugin.json; 0.0.40 is the core release of F502-13 (F502-13-1), the first core release that accepts it (P116). The package
// declares 0.0.41, which admits it.
test("the package declares the range of core 0.0.41 (P116)", { timeout: 1000 }, () => {
  assert.equal(pkg.engines.soksak, "^0.0.41");
});

// The application resolves @soksak/plugin-api through the import map of the page, so the plugin declares no dependency on it and
// engines.soksak is its only relation to core; the tests resolve it to the fixtures of this repository (P144).
test("the package declares no dependency on the plugin API", { timeout: 1000 }, () => {
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "bundledDependencies"]) {
    assert.deepEqual(Object.keys(pkg[field] ?? {}).filter((name) => name.startsWith("@soksak/plugin-api")), [], `${field} names the plugin API`);
  }
});

test("the compatibility documents state that the plugin names no plugin API release (P144)", { timeout: 1000 }, () => {
  const text = (file) => readFileSync(new URL(`../docs/spec/${file}`, import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.ok(text("core-compatibility.md").includes("The plugin names no plugin API release and declares no dependency on `@soksak/plugin-api`"), "core-compatibility.md");
  assert.ok(text("core-compatibility.ko.md").includes("Plugin은 plugin API release를 지정하지 않고 `@soksak/plugin-api`에 대한 dependency를 선언하지 않는다"), "core-compatibility.ko.md");
  for (const file of ["core-compatibility.md", "core-compatibility.ko.md"]) {
    assert.doesNotMatch(text(file), /devDependency `@soksak\/plugin-api`|tarball/, `${file} states a pin of the plugin API`);
  }
});

// A range ^0.0.z admits core 0.0.z and every later 0.0 release (core docs/spec/installation.md#versions-and-ranges), so the
// documents state the later releases and name no exclusion of them (P132).
test("the core compatibility documents state that the range admits every later 0.0 core release (P132)", { timeout: 1000 }, () => {
  const first = /^\^(0\.0\.\d+)$/.exec(pkg.engines.soksak)?.[1];
  assert.ok(first, `engines.soksak ${pkg.engines.soksak} is not a range ^0.0.z`);
  const text = (file) => readFileSync(new URL(`../docs/spec/${file}`, import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.ok(text("core-compatibility.md").includes(`admits core ${first} and every later 0.0 release`), "core-compatibility.md");
  assert.ok(text("core-compatibility.ko.md").includes(`core ${first}부터 그 뒤의 모든 0.0 release를 허용한다`), "core-compatibility.ko.md");
  for (const file of ["core-compatibility.md", "core-compatibility.ko.md"]) {
    assert.doesNotMatch(text(file), /unverified|검증하지 않은/, `${file} excludes the later releases`);
  }
});
