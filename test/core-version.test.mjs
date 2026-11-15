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
test("the package declares the range of core 0.0.41 and its plugin API release pins that version (P116, P142.1)", { timeout: 1000 }, () => {
  assert.equal(pkg.engines.soksak, "^0.0.41");
});

// The tests run on the plugin API of the core release that the range names, and the pin is that release tarball of the same
// version, so the release that the tests load is the release that the range declares (P142.1).
test("the plugin API devDependency is the tarball of the core release that engines.soksak names (P142.1)", { timeout: 1000 }, () => {
  const version = /^\^(0\.0\.\d+)$/.exec(pkg.engines.soksak)?.[1];
  assert.ok(version, `engines.soksak ${pkg.engines.soksak} is not a range ^0.0.z`);
  assert.equal(pkg.devDependencies["@soksak/plugin-api"],
    `https://github.com/soksak-app/core/releases/download/v${version}/soksak-plugin-api-${version}.tgz`);
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
