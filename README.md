# Terminal plugin

`terminal.screen` watches subscribe to semantic PTY screen changes before their initial read. Engine output invalidates the watched cells even when the native image is not drawing or a raster copy is pending; the existing coalesced read keeps one trailing read for changes during an open read. The first watcher enables `screen.watch`, the last watcher disables it once, reconnect restores it before a fresh read, and dispose/abort releases it. Unwatched surfaces request no semantic notifications. A `screen.changed` event makes no raster or presentation claim. Registration waits for the matching `screen.watching` acknowledgement under a unique existing wire CID; transport completion alone permits no initial read. A refusal, a send failure or the `sidecar-failure` of the surface is reported through the existing session error surface. A pending transition has no time limit: its acknowledgement, a refusal, a send failure, its replacement, a connection event, an exit, the `sidecar-failure` of the surface or the close of the view ends it. Late CIDs cannot restore ended demand.

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
