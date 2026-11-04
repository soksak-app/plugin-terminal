# Core compatibility

[한국어](core-compatibility.ko.md)

The terminal package uses the view manifest contract of core release `0.0.24`. Its `plugin.json` declares `surface.composition.kind: "view"` without `surface.module`, which the published core `v0.0.20` reader requires. `package.json` declares `engines.soksak: "^0.0.34"`, which only that core release satisfies under the core version-range rules, so it excludes earlier versions and later unverified versions.

`make check` runs the census check of the events kit and the record check of the records kit that `package.json` pins. The application validates `plugin.json` when it installs the release, and the registry check compares the exposed names of the release with the declarations of each listed core.
