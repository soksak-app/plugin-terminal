// Resolves `@soksak/plugin-api/screen-hash` from the core checkout while the pinned @soksak/plugin-api release predates it
// (docs/features.md P32.2). Remove this file and the --import flag of the test script when the dependency is raised.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

export const CORE_SCREEN_HASH = pathToFileURL(new URL("../../../core/packages/plugin-api/screen-hash.js", import.meta.url).pathname).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@soksak/plugin-api/screen-hash") return { url: CORE_SCREEN_HASH, shortCircuit: true };
    return next(specifier, context);
  },
});
