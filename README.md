# Terminal plugin

`terminal.screen.observe` is diagnostic-only: one request obtains a newly drawn renderer reference, atomically returning `requestId`, 2D semantic `rows`, `rowCount`, `columnCount`, `frame`, `cursor`, `render`, `background` and `scrollback`. It is separate from ordinary `screen.read`; unavailable, busy, closed or failed observations reject explicitly. It is a reference obtained after the measured interval, not readiness or a replacement for its earliest-content timing.

[한국어](README.ko.md)

Terminal plugin: a full-screen terminal surface connected to a VT engine session. The plugin format is defined in the soksak core specification (`docs/spec/plugins.md`).

```sh
make test                                   # tests
make check                                  # event source check and document checks
make pack OUT=<folder> # the plugin release
make install-hooks                                  # once after cloning: check commit messages and records at commit time
```

`make check` runs the event source check and the document check of the kit that `package.json` pins. The application validates `plugin.json` when it installs the release, and the registry check compares the exposed names of the release with the declarations of each listed core.

The checklist is [docs/features.md](docs/features.md).
