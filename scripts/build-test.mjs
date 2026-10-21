import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceUI = path.join(root, "ui");
const outputRoot = path.join(root, "build", "test");
const outputUI = path.join(outputRoot, "ui");
const table = JSON.parse(fs.readFileSync(path.join(root, "scripts", "test-sdk-cases.json"), "utf8"));

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function blankComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, (match) => match.replace(/[^\n]/g, " "));
}

function importedNames(clause) {
  const named = clause.match(/\{([^}]*)\}/);
  if (!named) return [];
  return named[1].split(",").map((item) => item.trim().split(/\s+as\s+/)[0]).filter(Boolean);
}

function importsOf(source) {
  const code = blankComments(source);
  const found = [];
  const add = (specifier, clause, match, captureIndex) => {
    const start = match.index + match[0].lastIndexOf(specifier);
    found.push({ specifier, names: clause === null ? [] : importedNames(clause), start, end: start + specifier.length });
  };
  const staticPattern = /\bimport\s+([\s\S]*?)\s+from\s+(["'])([^"']+)\2\s*;?/g;
  for (const match of code.matchAll(staticPattern)) add(match[3], match[1], match, 3);
  const reexportPattern = /\bexport\s+([\s\S]*?)\s+from\s+(["\'])([^"\']+)\2\s*;?/g;
  for (const match of code.matchAll(reexportPattern)) add(match[3], match[1], match, 3);
  const sideEffectPattern = /\bimport\s+(["'])([^"']+)\1\s*;?/g;
  for (const match of code.matchAll(sideEffectPattern)) add(match[2], null, match, 2);
  const dynamicPattern = /\bimport\(\s*(["'])([^"']+)\1\s*\)/g;
  for (const match of code.matchAll(dynamicPattern)) add(match[2], null, match, 2);
  return found.sort((a, b) => a.start - b.start);
}

function isSDK(specifier) {
  return specifier === "soksak" || specifier.startsWith("@soksak/");
}

function localTarget(from, specifier) {
  const clean = specifier.split(/[?#]/, 1)[0];
  const resolved = path.resolve(path.dirname(from), clean);
  if (resolved !== outputUI && !resolved.startsWith(outputUI + path.sep)) return null;
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  if (!path.extname(resolved)) {
    for (const extension of [".js", ".mjs"]) if (fs.existsSync(resolved + extension)) return resolved + extension;
  }
  throw new Error("test build cannot resolve UI import " + specifier + " from " + path.relative(root, from));
}

function fakeSource(module) {
  const literal = JSON.stringify({ exports: module.exports, caseCopies: module.caseCopies });
  const lines = [
    'import { isDeepStrictEqual } from "node:util";',
    "const TABLE = " + literal + ";",
    "// Every pure call gets a fresh one-step instance bound to exactly one published case.",
    "function bindCase(testCase, operation) {",
    "  let position = 0;",
    "  return function call(value) {",
    '    if (position !== 0) throw new Error("published case instance was already consumed: " + testCase.id);',
    "    const step = testCase.steps[position];",
    '    if (!step || !Object.hasOwn(step, operation)) throw new Error("operation is not at this case position: " + testCase.id);',
    "    const expected = step[operation];",
    '    const input = operation === "quote" ? expected.path : operation === "message" ? expected.value : expected.screen;',
    '    if (!isDeepStrictEqual(value, input)) throw new Error("input does not match published case " + testCase.id);',
    "    position += 1;",
    '    if (Object.hasOwn(step.output, "error")) throw new Error(step.output.error);',
    '    if (operation === "quote") return step.output.path;',
    '    if (operation === "message") return step.output.screen;',
    '    if (operation === "hash") return step.output.hash;',
    '    throw new Error("no output projection for contract operation " + operation);',
    "  };",
    "}",
    "function invoke(exportName, value) {",
    "  const operation = TABLE.exports[exportName];",
    '  if (typeof operation !== "string") throw new Error("unlisted test API export: " + exportName);',
    "  const matches = TABLE.caseCopies.filter((testCase) => {",
    "    if (!Array.isArray(testCase.steps) || testCase.steps.length !== 1) return false;",
    "    const step = testCase.steps[0];",
    "    if (!Object.hasOwn(step, operation)) return false;",
    "    const expected = step[operation];",
    '    const input = operation === "quote" ? expected.path : operation === "message" ? expected.value : expected.screen;',
    "    return isDeepStrictEqual(value, input);",
    "  });",
    '  if (matches.length !== 1) throw new Error("unlisted or ambiguous " + exportName + " call: " + JSON.stringify(value));',
    "  const instance = bindCase(matches[0], operation);",
    "  return instance(value);",
    "}",
  ];
  for (const [name] of Object.entries(module.exports)) {
    lines.push((name === "screenHash" ? "export async function " : "export function ") + name + "(value) { return invoke(" + JSON.stringify(name) + ", value); }");
  }
  return lines.join("\n") + "\n";
}
const modules = new Map(table.modules.map((module, index) => [module.specifier, { ...module, file: path.join(outputRoot, "fakes", "sdk-" + index + ".mjs") }]));
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
fs.cpSync(sourceUI, outputUI, { recursive: true });
fs.mkdirSync(path.join(outputRoot, "fakes"), { recursive: true });
for (const module of modules.values()) fs.writeFileSync(module.file, fakeSource(module));

const testsRoot = path.join(root, "test");
const entryFiles = new Set();
const testPackages = new Set();
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => "node:" + name)]);
const packageName = (specifier) => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
function packageRoot(name, fromDirectory) {
  let directory = fromDirectory;
  while (true) {
    const candidate = path.join(directory, "node_modules", ...name.split("/"), "package.json");
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
function scanTestDependency(name, fromDirectory, visitedPackages) {
  if (isSDK(name)) throw new Error("test dependency graph reaches SDK package: " + name);
  const directory = packageRoot(name, fromDirectory);
  if (!directory) return;
  if (visitedPackages.has(directory)) return;
  visitedPackages.add(directory);
  const packageJson = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
    for (const dependency of Object.keys(packageJson[field] || {})) {
      if (isSDK(dependency)) throw new Error("test devDependency graph reaches SDK package " + dependency + " through " + name);
      if (!builtins.has(dependency)) scanTestDependency(dependency, directory, visitedPackages);
    }
  }
}
for (const file of walk(testsRoot).filter((name) => /\.(?:mjs|js)$/.test(name))) {
  const source = fs.readFileSync(file, "utf8");
  if (source.includes("@soksak/") || /(?:from|import\()\s*[\"']soksak[\"']/.test(source)) {
    throw new Error("test source contains an SDK specifier: " + path.relative(root, file));
  }
  const discovered = importsOf(source);
  for (const match of source.matchAll(/\brequire\(\s*([\"'])([^\"']+)\1\s*\)/g)) discovered.push({ specifier: match[2] });
  for (const item of discovered) {
    if (item.specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(file), item.specifier.split(/[?#]/, 1)[0]);
      if (target === outputRoot || target.startsWith(outputRoot + path.sep)) entryFiles.add(target);
      continue;
    }
    if (item.specifier.startsWith("node:") || builtins.has(item.specifier) || /^(?:data|https?):/.test(item.specifier)) continue;
    if (isSDK(packageName(item.specifier))) throw new Error("test source reaches an SDK package: " + item.specifier);
    testPackages.add(packageName(item.specifier));
  }
}
if (entryFiles.size === 0) throw new Error("no test imports reach build/test/ui");

const visited = new Set();
function visit(file) {
  if (visited.has(file)) return;
  if (!file.startsWith(outputUI + path.sep) && file !== outputUI) throw new Error("UI test import escapes build/test/ui: " + file);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("test build entry is missing: " + file);
  visited.add(file);
  const source = fs.readFileSync(file, "utf8");
  const imports = importsOf(source);
  const replacements = [];
  for (const item of imports) {
    if (isSDK(item.specifier)) {
      const module = modules.get(item.specifier);
      if (!module) throw new Error("unlisted SDK import reached from UI: " + item.specifier + " in " + path.relative(root, file));
      if (item.names.length === 0) throw new Error("SDK import must name contract exports: " + item.specifier + " in " + path.relative(root, file));
      for (const name of item.names) if (!Object.hasOwn(module.exports, name)) {
        throw new Error("unlisted SDK export " + item.specifier + "#" + name + " in " + path.relative(root, file));
      }
      let relative = path.relative(path.dirname(file), module.file).split(path.sep).join("/");
      if (!relative.startsWith(".")) relative = "./" + relative;
      replacements.push({ start: item.start, end: item.end, value: relative });
      continue;
    }
    if (item.specifier.startsWith(".")) {
      const target = localTarget(file, item.specifier);
      if (target) visit(target);
      continue;
    }
    if (item.specifier.startsWith("node:") || builtins.has(item.specifier)) continue;
    const name = packageName(item.specifier);
    if (isSDK(name)) throw new Error("unlisted SDK import reached from UI: " + item.specifier + " in " + path.relative(root, file));
    testPackages.add(name);
  }
  let rewritten = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    rewritten = rewritten.slice(0, replacement.start) + replacement.value + rewritten.slice(replacement.end);
  }
  if (rewritten !== source) fs.writeFileSync(file, rewritten);
}
for (const entry of entryFiles) visit(entry);
for (const name of testPackages) scanTestDependency(name, root, new Set());
console.log("Built test UI tree: " + visited.size + " reachable modules, " + modules.size + " contract fakes");
