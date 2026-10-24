# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

- P87: Prepare terminal 0.0.21 as a local diagnostic candidate requiring VT
  `^0.0.17`. Red: the manifest check found the previous `^0.0.16` dependency.
  Green: the manifest case passes 1/1; official `candidate-pack` passes 52
  copied cases and view, exposure, engines, events and records checks. The
  installer selects terminal 0.0.21 and VT 0.0.17 and verifies the diagnostic
  module is a regular file. Terminal archive SHA-256:
  `f286666794bd606a53ae8b701a1818dae882ff9f9c027b8e4c3c2cff149ebe1b`; VT
  archive SHA-256:
  `6f3b7247bd1e14cc3ce4f25717abd0f5c7ad0e69ca79b6867cf90b5e0bfa7f9c`;
  registry index SHA-256:
  `b07f05cac2273648449b40bdf4df5c6e4ad28f71663656a87fee8037fa4e9d4f`. The
  P85 index and its prior artifacts are unchanged. The candidate is local and
  unreleased; no application was launched.

- P86-1: Accept the required focus action in native input transactions and keep
  the `native-input` diagnostic projection to `{actions, preedit, errors}`.
  Red: focus transactions were rejected, and the trace input repeated the
  region event discriminator. Green: five focused tests pass, including both
  focus states and exact diagnostic shape.

- P86: Consume each report-bearing native input scope as one validated ordered
  transaction. The terminal applies its final preedit once, sends one VT input
  request, then reports valid errors in order even when the request fails. Red:
  the unchanged consumer had no listener for the transaction event and sent no
  request; a failed request also dropped callback errors. Green: 39 focused
  terminal cases pass; copied SDK, event and records checks pass.

- P85: Prepare terminal 0.0.20 as a local diagnostic candidate requiring VT
  `^0.0.16`. The controlled installer registry contains VT 0.0.15 and 0.0.16;
  installation selects terminal 0.0.20, VT 0.0.16 and the declared regular
  module `ui/terminal-diagnostics.js`. The official candidate pack includes
  diagnostics and passes copied contract, view, exposure, engines, events and
  records checks. The VT 0.0.16 diagnostic binary smoke passes 2/2 for matching
  render/frame and engine trace. The registry contains five plugins, two
  sidecars and two packs. Terminal archive SHA-256 is
  `ddc66471f614ae5650670bcfc3317238b0ddb56e9b257a245be98ecce8c4eecf`; VT
  archive SHA-256 is
  `f022206b32e5b44f03a7f236bad5b47f26c6c94fc4144039359f6ed28491bb85`; registry
  index SHA-256 is
  `470b5341fd45fa3097c21ecf6b380fee5aec2e6263503dd566249dca1200e885`. The
  prior terminal 0.0.19 archive and P84 registry remain unchanged. The candidate
  is local and unreleased; no application was launched.

- P84: Prepare terminal 0.0.19 as a local diagnostic candidate requiring VT
  `^0.0.15`. The official candidate pack includes `diagnostics.json` and its
  regular module. The controlled installer registry contains VT 0.0.14 and
  0.0.15; installation selects terminal 0.0.19, VT 0.0.15, and
  `ui/terminal-diagnostics.js`. The registry contains five plugins, two
  sidecars and two packs. Terminal archive SHA-256 is
  `4b4b4c062d6920d7f166f47f111f499b7bf55fa7f1939cb064b65c876a235e60`; VT
  archive SHA-256 is
  `c3532df4b23a92de04cbf9eabb72e782d743d85861901b0cfe99b7158fb735ef`;
  registry index SHA-256 is
  `b79461cadcd9c64e5ef2b07f6cedfee4b91569be195c00a0699b1164cab122e7`. The
  P83 cursor description retains the existing meaning that null render metadata
  means no matching draw. The earlier provisional archive SHA-256
  `bee9a0c57f288eb247444fbd07c1cf83c3862f236116839618c924c6181640f5` was
  retained but not installed because its reserialized declaration omitted that
  meaning; the final archive uses the committed formatting and restored text.
  The candidate remains local and unreleased; no application was launched.

- P83: Use VT's frame-effective screen caret while preserving raw cursor
  coordinates for the screen hash and public cursor fields. The required
  nullable `cursor.caret` is validated before state changes, published as
  `terminal.cursor.caret`, and used for native input-method placement only when
  non-null. State updates clear it and never infer a replacement from raw
  coordinates. Red: unchanged code used raw coordinates, omitted the public
  caret, and accepted missing/out-of-grid values. Green: 14 selected terminal
  and manifest tests pass, including hash-projection coverage. The manifest
  requires VT `^0.0.15`; terminal 0.0.19 candidate packaging is tracked by
  P84. No application or package build was run.

- P82: Diagnostic candidate packing now always includes `diagnostics.json`
  and its declared module. Red: the official installer installed terminal
  0.0.17 with VT 0.0.14, then the installed-package check failed because the
  declaration was absent. Green: the same installer check installs terminal
  0.0.18 with VT 0.0.14 and verifies the declaration names the module loaded
  by the view and that the module is a regular file. The official diagnostic
  pack passes copied contract, view, exposure, engines, events and records
  checks; registry build reports five plugins, two sidecars and two packs.
  Terminal archive SHA-256:
  `e06c181f7b5a81c6ced5f3a4d37eaa1e7d9a366e256624b0b09ce12fb299d500`;
  registry index SHA-256:
  `2971d9d5d7872e60a4ceeb62c4d9866b0f624036633244741f83e25244da2a56`.
  The candidate remains local and unreleased; no application was launched.

- P79: Set the terminal candidate version to 0.0.16 and build a local archive
  containing P78 committed-input snapshots and P80 input ordering. The
  official `make pack` path passes its copied contract, view, exposure,
  engines, events, and records checks using core candidate 0.0.21. The archive
  SHA-256 is
  `bc1b53178497000aa97055f25be3c1ee24dee6851f787f5afdd5770709aea322`.
  The official installer selected VT 0.0.13 from a registry containing both
  0.0.13 and 0.0.14 because the 0.0.16 range allowed either. Linked P81
  prepares the final 0.0.17 candidate with the narrower range. The final local
  registry uses terminal 0.0.17 and VT 0.0.14; its index SHA-256 is
  `93fbc06fee0721d74d6582ce7fce7e165e5dd51937acd2e4f22b5dba9bcde1ae`.
  The existing 0.0.15 release and frozen source registry are unchanged. No
  public tag or release is made.

- P81: Require VT `^0.0.14` in terminal 0.0.17. Red: the tracked official
  installer check installed terminal 0.0.16 with VT 0.0.13 from the same
  registry containing both sidecar versions, failing its assertion for 0.0.14.
  Green: terminal 0.0.17 installs with VT 0.0.14; the focused manifest case
  passes, the registry build reports five plugins, two sidecars, and two
  packs, and official `make pack` checks pass. Terminal package SHA-256 is
  `6db6e6b537cbadfe8e4f7e1db4d631cf7f4a744c7294a36d374514b97a2e8b26` and VT
  0.0.14 SHA-256 is
  `c95054417477a6a80e111265b1e84d3f514b1e7128ae46a4499287b22a80feda`. The
  candidate remains local; no public release or application run occurred.

- P80: Validate and enqueue a native insert's snapshot synchronously in region
  callback order. A same-turn Backspace can no longer overtake the combined
  bytes-plus-compose request. Red: the unchanged handler sent Backspace first.
  Green: four focused terminal tests pass, covering ordering, empty and
  unchanged snapshots, combined delivery, and missing-snapshot rejection.
  The test UI tree was rebuilt; no application or package build was run.

- P78: Send committed native insert bytes with the same input-document update's strict resulting compose snapshot. Apply that snapshot to `terminal.compose` before queueing the combined VT request, and reject an insert without the snapshot before sending bytes. Red: the owning test failed against unchanged production because the insert request omitted its resulting compose snapshot. Green: the test UI build resolves 9 modules and 2 contract fakes; 10 focused terminal and neighboring native-input cases pass (14 test results including four marked-range subcases). The package remains unreleased.

- P75-3: Keep the render status's required-nullable meaning in the status description and remove an unsupported `description` member from its nested schema. Red: the official diagnostic pack refused the manifest because the schema reader does not accept that member. Green: the owning manifest case passes, P77 `make check` passes, and the official diagnostics pack contains both `diagnostics.json` and the required nullable cursor render schema.

- P75-2: Preserve raw fractional CTFont/CTLine glyph bounds relative to the leading cell, including negative coordinates and overhang beyond a cell. Keep cursor rectangles frame-absolute and inside the raster. Red: the consumer rejected raw Hangul overhang; the signed glyph-rectangle parser accepted a negative absolute cursor rectangle. Green: the owning tests accept finite overhang and reject zero-width/non-finite glyph bounds and negative cursor rectangles atomically. No application was run.

- P75-1: Match the sidecar's cursor draw state and width-2 glyph span. A visible cursor with blinking off has no rectangle or color; a drawn normal cursor requires both its rectangle and effective color. Red: the owning consumer test rejected valid blink-off and width-2 Hangul frames. Green: the focused render metadata test passed. Its original outside-span rejection was later corrected by P75-2 because S78.1 reports raw unclipped CoreText bounds. No application was run.

- P77: Run copied-case, view, exposure, engines, events and records validation from the same `CORE_PLUGIN_API_DIR`, defaulting to the installed plugin API directory. Red: the fixture SDK received only the view check; four other tools ran through pinned `pnpm`. Without preflight, a missing checker produced an unqualified Node module error. Green: the owning check-target test passes 6/6, including all five local entry points and a path-specific missing-checker error. Full `make check` with current core source passes 52 copied cases, view literal, exposure, engines, census, event catalog and records. No pin or release metadata changed.

- P75: Publish the sidecar's required nullable screen render metadata as `terminal.cursor.render` in the same update as its screen frame, cursor and preedit. Validate the complete render object and exact frame binding before changing screen state; project the terminal-only field out before calling the SDK screen hash. A state cursor update clears both frame and render. Red: unchanged production had no render status, accepted screen messages without the required field, and had no frame-bound metadata validation. Green: focused renderer and cursor-state cases pass; the terminal and manifest tests pass 171/171. The plugin is not released.

- P76: Run the SDK view literal checker from `make check`. The target uses installed `soksak-view-check`, or `view-check.js` under the local `CORE_PLUGIN_API_DIR` override, with `view-check.json` and the copied screen-message vector. Red: the owning check-target test failed against the unchanged Makefile because the command and both files were absent from its dry-run. Green: `test/check-target.test.mjs` passes 5/5; with current core source, `make check` passes 52 copied cases, the view literal and exposure before the existing P69 `soksak-engines` version gate fails. SDK pins and release metadata are unchanged.

- P74-1: Add the nine core-published screen hash cases used by 15 valid screen message projections to the terminal test fake. Reuse one case for identical projections. Red: the owning consumer test reported 15 unlisted `screenHash` inputs and set `terminal.session.error`. Green: the same test passes 1/1 with no screen or session errors; the copied-case checker validates 52 cases against the current core API source, and exposure, event catalog and record checks pass. The test UI build resolves 9 modules and 2 contract fakes. No production code, SDK pin or release changed.

- P74: Publish the frame from each validated screen event in `terminal.cursor` with that event's cursor and preedit in one status update. The status frame is required and nullable; cursor changes from unframed state events clear it to `null`, and state events cannot supply a non-null frame. Invalid screen frames preserve the prior status and use the existing screen error path. Red: the public frame/preedit screen case returned `undefined`; a later state cursor also retained the previous frame, and a state cursor carrying a frame replaced the screen tuple. Green: targeted frame/state tests pass 5/5, invalid inputs preserve status, and the terminal/manifest tests pass 168/168. The copied contract table passes 43 cases against current core source. Fifteen valid screen projections lacked hash inputs in the finite test fake; P74-1 adds the nine matching core-published hash cases. The pinned `make check` stops at the separate P69 SDK version gate. The change is not released.

- P73: Remove unsupported `required` keys from the terminal exposure schemas. The official CLI Red was `terminal exposes terminal.cursor schema.preedit: unknown field required` against unchanged manifests; the writer accepts only `type`, `properties`, `items`, and `enum`. Green: normal and diagnostic CLI 379 packs pass, manifest tests pass 9/9, focused marked-range runtime tests pass 7/7, and candidate exposure, engines, events, records, and 41 copied contract cases pass. The pinned `make check` still fails at its separate P69 gate because installed SDK 0.0.20 rejects `^0.0.21`. Runtime validation is unchanged; no package was released. The CLI build log was not preserved.

- P72-1: The IME trace test now expects one `terminal-input` record for each of the four input operations it sends. The previous expectation included a fifth record with no matching operation. Red: the original terminal implementation produced four records while the test expected five. Green: the focused trace test passes 1/1 and the terminal/manifest files pass 163/163. No runtime behavior changed.

- P72: The terminal preserves the native compose `markedRange` as UTF-16 offsets relative to the complete compose text, sends it unchanged to VT, and requires it in both compose status and cursor preedit. Missing, malformed, out-of-text and grapheme-splitting ranges are rejected before status mutation or queueing; invalid sidecar state does not mutate the session or flush queued input. Red: the unchanged terminal omitted marked ranges and accepted invalid ranges, and malformed state changed the session. Green: focused compose, state and manifest tests pass 9/9; the test UI build succeeds. The owning terminal and manifest files pass 162/163; the remaining IME trace expectation fails the same way against the original terminal source and is tracked by P72-1. The change is not released.

- P71: The test-build guard now checks SDK dependencies through parsed module imports instead of scanning raw test source text. Manifest package keys remain ordinary data, while actual SDK imports remain rejected. Red: `node --test test/build-test.test.mjs` failed both the manifest-data case and the actual-import case because the broad string guard ran before parsing. Green: the focused build-guard and manifest tests pass 16/16, and `node scripts/build-test.mjs` builds the test UI tree.

- P70: A native insert can commit a prefix while the Korean input method keeps the same preedit, so no changed compose callback follows it. The terminal previously cleared that preedit on every insert and briefly hid the remaining input. Red: `a partial native insert preserves the remaining input-method preedit` fails on the unchanged handler with actual compose `""` instead of `"ㅏㅏ"`. Green: the handler keeps compose state until a compose event changes it; the same test verifies insert-before-empty-compose ordering, and six focused terminal IME tests pass. The correction is unreleased; P70-1 tracks the package and registry release.

- P69: Terminal `0.0.15` now declares `engines.soksak` `^0.0.21` because published core `v0.0.20` requires `surface.module` and refuses its view manifest. Red: `test/core-version.test.mjs` fails with `">=0.0.11" !== "^0.0.21"`. Green: the same test passes 1/1, and current core `engines-check.js` accepts the range. No SDK pin, plugin version, archive or registry changed; publication remains pending a matching core release.

- P68: Require VT sidecar 0.0.12 or later, which declares the required process display identity, and bump the terminal plugin to 0.0.15. Red: the manifest test rejected `^0.0.11`; Green: it passes with `^0.0.12`.

- P66: A primary pointer press in the terminal view runs the declared `terminal.focus` command through the shared exposure binder, so it requests keyboard focus for the native image region. The separate view no longer depends on pointer bubbling to the main document card. Focus failures reach the session and the surface error path; disposal removes the binding, and a refused binding releases the terminal session and composition. Four owning tests fail before the correction and pass after it. The 16 owning page tests and the pointer propagation case pass on darwin arm64 with Node 26.11.1, and the declared plugin checks pass with the current core API source. The correction is unreleased (P66-1); pre-existing documentation differences are tracked by P67.

- P65: The view page begins with its doctype and holds no import map, and the view literal holds no `viewImports`. The host inserts the view import map after the doctype, for the core checklist item F212.12-1-10-6. Red: the module test failed on the page with the map, and the core `checkViewPage` and `checkViewLiteral` reported the map and the `viewImports` member. Green: `make test` passes 194 of 194, and the core checks accept both files.
- P63: The view declares its exposure entries once: in a diagnostic build the start values already hold the diagnostics.json entries, and the page no longer adds them again, so the mount no longer fails with `is declared twice`.
- P60: The pre-push hook runs `make push-check`, which runs `make test`, `make check` and the commit message check of the pushed range, as the ci workflow does. Red: `.githooks/pre-push` did not exist. Green: the hook runs the checks; `make test` passes 191 of 191 tests, and `make check` fails at the pinned SDK on the clipboard contract file, which P61 records.

- F252-terminal-1: The exposure port of the view reports a reply that the host refuses, as core createExpose requires.
- F252-contract-terminal: The copied screen-hash cases follow core origin/main. Three single-call cases are added to the table; the other five screen-hash cases are not covered because they have several calls or no page export.
- F252-terminal: The terminal page refuses a state event without a string `sessionId`, a null or non-object `cursor`, and an origin that is not `{directory}` with a path or null (`null` included). Each surface sink is required. A screen message without a cursor is refused before the screen changes. Dropped `sequence.rejected` reasons are counted (`session.rejectedShed`), and an unknown sidecar event is logged as `sidecar.unknown`. A diagnostics status other than not-found is refused. A refused `runtime.log` record is reported through `runtime.error` with `where` `log`. Red and Green: `test/terminal.test.mjs`, `test/terminal-view.test.mjs`, `test/view-log.test.mjs` (see docs/features.md F252-terminal).
- P54.1: The CI and release workflows run `make check` after `make test`. `ci.yml` had no `make check` step, and `release.yml` ran `make check` only as the prerequisite of `make pack`. Red: `test/workflows.test.mjs` failed on the unchanged workflows (`ci.yml` targets `test`; `release.yml` targets `pack`). Green: both cases pass. On the pinned release, `make check` fails at its first step until P58 moves the pin.

- P54.2: `test/test-script.test.mjs` checks that the test command of package.json selects every test file under `test/`, including its subdirectories. The unchanged command `node --test test/` already selects nested files, so no command changed. Red: a fault-injected flat glob command failed the case with the nested probe file `test/nested/probe.test.mjs`. Green: the unchanged command passes the case with the same probe file.

- P54.3: The copied core contract cases and the view literal match core main. The 38 copied cases of `scripts/test-sdk-cases.json` and the view-start digest equal the published core main values, and `checkViewLiteral` of core main reports no difference for `view-check.json`. No file changed; the conformance check remains `make check` with `CORE_PLUGIN_API_DIR`, and the pinned run of the view literal waits on P58.

- F238-b-12: the page no longer calls `runtime.log.enabled`. It hashes each accepted `screen` message and passes the `frame` record to `runtime.log.debug`, and the writer of the event log decides whether the class `frame` is stored. The page reads no log level, so the cost of the hash of each screen message is not gated by the level.
- P59: The release lists `ui/view-sidecar.js`, which the view page imports, so the installed release serves it. `test/release-files.test.mjs` checks that every relative import of `ui/*.js` and every relative script `src` of `ui/*.html` resolves to a listed file, except the declared diagnostic module. Red: on the unchanged `package.json`, the test failed with `ui/terminal-view.js -> ui/view-sidecar.js` and `ui/view.js -> ui/view-sidecar.js`. Green: `make test` passes 177/177 and `make check` with the core plugin-api source passes all four tools.

- P57: The view page names its sidecar `@soksak/sidecar-vt-alacritty` in each sidecar call and subscription. The sidecar port moved to `ui/view-sidecar.js` (P57.1). Red: `test/view-sidecar.test.mjs` failed on the unchanged port with the sidecar missing from the `runtime.sidecar.send` params and with undefined sidecar names for `on` and `onFailure`; `test/module.test.mjs` failed 7 of 9 cases once the view fixture refused a nameless sidecar. Green: `make test` passes 175 of 175. `make check` stops at its first step, which needs `contract/clipboard.json` in the pinned release (P58); its four SDK validators pass when run directly.

- P49.4: The view clipboard serves a PNG payload. A PNG read returns the bytes of the payload, and `persistPNG` persists bytes through the call route of the view and returns the persisted path with its shell-quoted form (core F241). The clipboard entries of the view moved to `ui/view-clipboard.js`.

- P49.5: Forward log correlation options through the terminal view route using the terminal-owned view-log adapter. Red: the input record lost the native insert chain. Green: 170/170 plugin tests and the core-source check pass. SDK pins and release gates are unchanged.

- F238-c-23/P56.1/P56.2: `scripts/build-test.mjs` fails when required dependencies or peers are unresolved, or a reachable UI import escapes `build/test/ui`; absent optional dependencies and optional peers remain allowed. Package resolution follows real package paths and excludes package development-only dependencies. Acorn replaces import regexes, decodes module specifiers before SDK fake checks, and makes non-literal dynamic imports and `require` fail closed. Red: the original build returned status 0 for missing required edges and the escaped helper; it left a Unicode-escaped SDK import unreplaced and accepted a computed dynamic import. Green: `node --test test/build-test.test.mjs` passes 6/6; `pnpm test` passes 169/169. The escaped helper fixture asserts the actual resolved path exists. SDK release pins are unchanged.

- F238-c-13/c-18/c-19/c-21/c-23/c-28: `scripts/build-test.mjs` copies reachable `ui/` modules to `build/test/` and replaces only table-listed API exports with strict one-call fakes copied from core contracts; it checks test devDependency reachability and fails on unlisted SDK imports. The table contains 38 copied cases for `shellQuotePath`, `screenFromMessage` and `screenHash`; malformed rows, columns, cells and segments remain refused with debug logging off. The test-only binder algorithm was removed; the local registry only dispatches registered terminal handlers. `test/census.test.mjs` remains deleted and `make check` owns the terminal census. Red: the strict fakes exposed unlisted screen inputs until core published the needed cases. Green: `pnpm test` 163/163; `make check CORE_PLUGIN_API_DIR=<core plugin-api source>` passes the table comparison and all available validators. Default `make check` is blocked because the installed API pin does not publish `contract/clipboard.json`; `soksak-view-check` is not installed either. `docs/spec/plugins.md` requires a release-tag dependency, so no pin, release, or substitute was used; the c11 view-literal comparison remains open.

- F238-c-21: Removed `test/census.test.mjs`, whose tests spawned the SDK census CLI and duplicated generic scanner assertions. Core `packages/plugin-api/test/events-check.test.mjs` owns those cases; `make check` scans the terminal repository. `test/events.test.mjs` and terminal behavior assertions remain. Green: core census tests 27/27, `make test` 163/163, and terminal `make check` passes with the core-source table override.

- P49: The surface moved to a view that carries its image region (core F212.10), which closes P49.3: `plugin.json` declares the composition `{kind: "view", page: "ui/terminal.html"}` with the image region and the five overlays and no `module`; the view page reads the start values `window.sokSurface`, builds the surface context over the view bridge, addresses the sidecar session with the surface identifier, registers the declared statuses, commands and dom names through the view exposure relay, and starts `ui/terminal.js` unchanged; `ui/terminal-module.js` and the page-mount context are removed. `@soksak/plugin-api` comes from a commit of core main that holds the view bridge and its composition. Red: the 8 view cases of `test/module.test.mjs` failed on the tree before the move (`ENOENT ... ui/terminal.html`, `Cannot find module ... ui/view.js`). Green: `make test` passes 161 of 161 tests with the exposure, engines, census, catalog and record checks on macOS 26.6 arm64. The route of a view serves no PNG clipboard read or persistence and carries no `cids` of a record; the waiting items P49.4 and P49.5 record both gaps.

- P48: new commits are authored as `min-0-max <max@blue.tools>`; `.mailmap` maps the former name `min-median-max`, and published commits are not rewritten.

## 0.0.14 (2026-10-18)

- P47: Release version 0.0.14, which requires the terminal service `^0.0.11`; the service 0.0.11 refuses an `open` without `image` for a drawn surface, so a terminal shown again after a tab of its card hid it draws its output; the tag `v0.0.14` publishes `terminal-0.0.14.tgz`.

## 0.0.13 (2026-10-14)

- P46: Release version 0.0.13 with the drawn preedit in `terminal.cursor` (P45); the tag `v0.0.13` publishes `terminal-0.0.13.tgz`.
- P45: `terminal.cursor` holds the preedit that the service drew in `cursor.preedit` of a `screen` event (null when none), and a preedit of another shape is refused as an invalid screen cursor.

## 0.0.12 (2026-10-14)

- P44: Release version 0.0.12 with the frame of a screen read (P42); it requires the terminal service `^0.0.10`, which carries the `frame` of the `screen` event, and the tag `v0.0.12` publishes `terminal-0.0.12.tgz`.
- P42: `terminal.screen.read` resolves with `{ rows, frame }`, where `frame` is the `frame` of the latest `screen` event (null for a surface without an image), and a `screen` event whose `frame` is absent or of another shape is refused as an invalid screen message.
- P43: `make hooks` sets `.githooks` as the hook folder, so a commit whose message breaks the commit form or the term rules, or whose records break the record rules, is refused when it is made.

## 0.0.11 (2026-10-13)

- P41: Release version 0.0.11 with the event contract (P30), the screen hash (P32), the wheel records (P38.1) and the context menu (P39); the tag `v0.0.11` publishes `terminal-0.0.11.tgz`.
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
