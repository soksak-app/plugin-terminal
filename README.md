# Terminal plugin

[한국어](README.ko.md)

Terminal plugin: a full-screen terminal surface connected to a VT engine session. The plugin format is defined in the soksak core specification (`docs/spec/plugins.md`).

```sh
make test                                   # tests
make check                                  # census and record checks
make pack OUT=<folder> # the plugin release
make hooks                                  # once after cloning: check commit messages and records at commit time
```

`make check` runs the census check of the events kit and the record check of the records kit that `package.json` pins. The application validates `plugin.json` when it installs the release, and the registry check compares the exposed names of the release with the declarations of each listed core.

The checklist is [docs/features.md](docs/features.md).
