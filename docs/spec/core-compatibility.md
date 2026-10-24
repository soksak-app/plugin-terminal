# Core compatibility

[한국어](core-compatibility.ko.md)

The terminal package uses the view manifest contract of core release candidate `0.0.21`. Its `plugin.json` declares `surface.composition.kind: "view"` without `surface.module`, which the published core `v0.0.20` reader requires. `package.json` therefore declares `engines.soksak: "^0.0.21"`, matching the current candidate under the core version-range rules and excluding `0.0.20` and later unverified versions. The package release waits for a published core release that carries this contract.
