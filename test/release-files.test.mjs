import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { parse } from "acorn";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const diagnostics = JSON.parse(readFileSync(new URL("diagnostics.json", root), "utf8"));

/** The release lists the files of `files`; a directory entry lists the files under it. */
const listed = (path) => pkg.files.some((entry) => path === entry || path.startsWith(`${entry}/`));

/** Relative specifiers that a module imports: static imports, re-exports, and literal dynamic imports. */
function moduleSpecifiers(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const found = [];
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    if (
      (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
      node.source
    ) found.push(node.source.value);
    if (node.type === "ImportExpression" && node.source.type === "Literal") found.push(node.source.value);
    for (const [key, value] of Object.entries(node)) if (key !== "start" && key !== "end") visit(value);
  };
  visit(ast);
  return found.filter((specifier) => specifier.startsWith("."));
}

/** Relative `src` attributes of the script elements of a page. */
const pageScripts = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]).filter((src) => src.startsWith("."));

const uiFiles = readdirSync(new URL("ui/", root)).filter((name) => /\.(js|html)$/.test(name));

test("every relative import of a ui page resolves to a file of the release", () => {
  assert.ok(uiFiles.length > 0);
  const unresolved = [];
  for (const name of uiFiles) {
    const source = readFileSync(new URL(`ui/${name}`, root), "utf8");
    const specifiers = name.endsWith(".html") ? pageScripts(source) : moduleSpecifiers(source);
    for (const specifier of specifiers) {
      const target = new URL(specifier, new URL(`ui/${name}`, root));
      const path = target.pathname.slice(new URL(".", root).pathname.length);
      if (!listed(path)) unresolved.push(`ui/${name} -> ${path}`);
    }
  }
  assert.deepEqual(unresolved, []);
});

// Every release holds the diagnostic declaration and its module, and only a diagnostic build reads them (core docs/spec/plugins.md).
test("the release holds the diagnostic module and its declaration", () => {
  assert.equal(listed(diagnostics.module), true);
  assert.equal(listed("diagnostics.json"), true);
});
