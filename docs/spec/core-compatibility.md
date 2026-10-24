# Core compatibility

[한국어](core-compatibility.ko.md)

The terminal package uses the view manifest contract of core release candidate `0.0.21`. Its `plugin.json` declares `surface.composition.kind: "view"` without `surface.module`, which the published core `v0.0.20` reader requires. `package.json` therefore declares `engines.soksak: "^0.0.21"`, matching the current candidate under the core version-range rules and excluding `0.0.20` and later unverified versions. The package release waits for a published core release that carries this contract.

`make check` runs validators published by the pinned SDK. A developer may set `CORE_PLUGIN_API_DIR` to a local core `packages/plugin-api` directory to run checks that the pin does not yet publish. The view literal check invokes that directory's `view-check.js` with `view-check.json` and the copied `test/fixtures/screen-message.json`; without the override it invokes the installed `soksak-view-check` command. A missing checker is an error, and the override does not change the package dependency or release pin.
