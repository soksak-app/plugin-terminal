// The resolve hook of the plugin tests. The page imports the browser modules of @soksak/plugin-api through the import map of the
// application; the tests map the same specifiers to the fixture modules of this repository, and no other specifier.

const FIXTURES = new Map([
  ["@soksak/plugin-api", "./index.mjs"],
  ["@soksak/plugin-api/view", "./view.mjs"],
  ["@soksak/plugin-api/screen-hash", "./screen-hash.mjs"],
  ["@soksak/plugin-api/diagnostic-view-frames", "./diagnostic-view-frames.mjs"],
]);

/** Maps a plugin API specifier to its fixture URL; every other specifier goes to the default resolution. */
export async function resolve(specifier, context, nextResolve) {
  const target = FIXTURES.get(specifier);
  if (target === undefined) return nextResolve(specifier, context);
  return { url: new URL(target, import.meta.url).href, shortCircuit: true, format: "module" };
}

