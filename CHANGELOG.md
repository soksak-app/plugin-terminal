# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

- P39: `surface.menu` lists `terminal.copy` titled `복사` and `terminal.paste` titled `붙여넣기`, so a right click on a terminal opens them.
- P40: `make test` runs the record check `soksak-records`, and CI checks the form of each pushed commit message with `soksak-commits`.
- P32.2: the tests import `@soksak/plugin-api/screen-hash` from the installed core release 0.0.11; the hook that resolved it from the core checkout is removed.
- P30.5: `@soksak/plugin-api` comes from the core release 0.0.11 and `engines.soksak` is `>=0.0.11`, so the manifest member `events` is accepted and `make test` runs the event guard from the installed dependency.
- P38.1: the surface records each wheel gesture as `plugin.terminal.wheel` with its deltas, the cell height, the lines it sends and the carry, so a gesture that sends no scroll is in the log.
- P37: a paste awaits the copy of the latest selection release of its surface, which the sidecar sends after the raster that shows the release, so a paste that follows a release returns the text of that selection.
- P36: a cell of the rows of the screen names each attribute flag of the screen message that is set.
- P35: a blank cell and the continuation of a wide character have no `ch` in the rows of the screen, so a reader counts their width as spaces again.
- P33: `test/census.test.mjs` shows that a source of occurrences without an event or a reason fails the guard of this repository.
- P32.6: the diagnostic command `terminal.screen.alter` changes the next screen message before the page hashes it, so a window check observes that the replay of core reports the change.
- P32.5: the frame event names the session of the sidecar instead of the identifier of the surface.
- P32.4: the frame event carries `segment`, the replay segment of the screen message.
- P32.3: the terminal validates every `screen` message with `screenFromMessage`, builds its rows from `cells` instead of `lines`, requires only `col`, `row` and `visible` of the cursor and checks `focused`, `shape` and `blinking` when present; `terminal.screen.read` resolves the cell rows. Red: the golden message was refused with `invalid screen cursor from sidecar`. Tested with `npm test` on macOS (the manifest test fails on the pinned plugin-api before and after this change).
- P32.1: the terminal hashes each `screen` message of the sidecar with `screenFromMessage` and `screenHash` and stores the event `frame` (`session`, `sequence`, `rows`, `cols`, `hash`) behind the gate `runtime.log.enabled`; a refused message is the error of the source `screen`. This closes P31.3. `test/terminal.test.mjs` reproduces the hashes of the 7 golden messages of core.
- P31.2: the events `input` and `send` carry the `cids` of the input that caused them.
- P31.1: the terminal calls `runtime.log.<level>` directly, passes the fields of the events `ime`, `input`, `send`, `send.result`, `sidecar.event` and `region` as a builder, and the emitter `ui/events.js` is removed. `test/terminal.test.mjs` and `test/events.test.mjs` pass; `soksak-events` reports 12 declared events and 15 emit sites.
- P30.4: `make test` runs `soksak-events` with `census.json` and `events.json`, and the 9 reason comments are written as `default: <reason>`.
- P30.3: each input carries the `cids` of the region event that caused it to the sidecar (`sidecar.send(surface, body, cids)`), also when it waited for the session; an invalid `cids` is shown as a session error.
- P30.2: the trace events go through the emitter of the plugin, `send.result` states `ok`, `micros` and `error`, and the session gate, the session open, the close, the refusal of an input by the full queue and each shown error are stored as events. `test/terminal.test.mjs` and `test/module.test.mjs` pass.
- P30.1: the plugin declares the catalog `events.json` (named in `plugin.json`, packed with the release) and the emitter `ui/events.js`, which stores an event through `context.runtime.log` with the prefix `plugin.terminal.`. `test/events.test.mjs` passes 5 of 5.
- P29: the terminal ignores the events of its sidecar once `context.closing` aborts, so it no longer sets the caret of a region that the workbench detached at the removal of the surface.
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
