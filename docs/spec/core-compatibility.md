# Core compatibility

[한국어](core-compatibility.ko.md)

The terminal package uses the view manifest contract of core release candidate `0.0.21`. Its `plugin.json` declares `surface.composition.kind: "view"` without `surface.module`, which the published core `v0.0.20` reader requires. `package.json` therefore declares `engines.soksak: "^0.0.21"`, matching the current candidate under the core version-range rules and excluding `0.0.20` and later unverified versions. The package release waits for a published core release that carries this contract.

`make check` runs every SDK checker from one `CORE_PLUGIN_API_DIR`, which defaults to `node_modules/@soksak/plugin-api`. A developer may set it to a local core `packages/plugin-api` directory. The check passes the same directory to the copied-case validator and invokes its `view-check.js`, `exposure-check.js`, `engines-check.js`, `events-check.js` and `records-check.js` entry points. A missing required checker is an error. This override does not change the package dependency or release pin.
