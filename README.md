# Terminal plugin

[한국어](README.ko.md)

Terminal plugin: a full-screen terminal surface connected to a VT engine session. The plugin format is defined in the soksak core specification (`docs/spec/plugins.md`).

```sh
make test                                   # tests
make pack OUT=<folder> SOK=<core>/target/debug/sok   # the plugin release
```

The checklist is [docs/features.md](docs/features.md).
