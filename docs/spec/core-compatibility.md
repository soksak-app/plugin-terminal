# Core compatibility

[한국어](core-compatibility.ko.md)

The terminal package uses the view manifest contract of core release `0.0.24`. Its `plugin.json` declares `surface.composition.kind: "view"` without `surface.module`, which the published core `v0.0.20` reader requires. `package.json` therefore declares `engines.soksak: "^0.0.24"`, matching core `0.0.24` under the core version-range rules and excluding earlier versions and later unverified versions. The package release waits for a published core release that carries this contract.

`make check` runs the census check of the events kit and the record check of the records kit that `package.json` pins. The application validates `plugin.json` when it installs the release, and the registry check compares the exposed names of the release with the declarations of each listed core.
