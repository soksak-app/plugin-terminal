# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

- P28: the plugin requires the terminal service `^0.0.8`, and version 0.0.10 carries it.
- P27: version 0.0.9 carries P26.
- P26: every message sent to the sidecar with its result, every event of the sidecar and every event of the image region is a trace event with its whole body, and the events `ime` and `input` carry the typed text and every range.
- P25: version 0.0.8 carries P22.
- P22: each native callback of the input method is written to the performance trace as the event `ime` with its kind and text length, never the text.
- P24: version 0.0.7 carries P20, P21 and P23.
- P23: a terminal service that was replaced opens the new shell in the last directory that the shell reported, and a directory of another machine returns to the directory where the tab started.
- P21: the plugin requires the terminal service `^0.0.7`, whose hello answer carries its version.
- P20: input that waited during a reconnection is sent when the preserved session answers, and each input (kind and length, never the text), session gate change and queue sending is written to the performance trace.
- P19: the documents and comments call plugins, sidecars and releases by those words.
