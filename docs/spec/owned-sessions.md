# Owned sessions

[한국어](owned-sessions.ko.md)

The terminal plugin declares `sessions: true` in `plugin.json` and takes part in owned sessions of core (`docs/spec/plugins.md#owned-sessions`, `docs/spec/persistent-services.md#owned-sessions`). A terminal surface opens a terminal session that no tab holds, and a tab shows that session on request instead of starting a program of its own.

## Declaration

- `plugin.json` has `"sessions": true`.
- The plugin keeps exactly one sidecar in `dependencies`, `@soksak/sidecar-vt-alacritty`, which is `transport: "persistent"`. The core refuses `sessions` without a surface or without exactly one sidecar.
- `background` is unchanged. A background session is not an owned session.

## Sidecar operations

The terminal sidecar answers the owned-session messages of core with the bodies that its own specification (`docs/spec/vt-core.md` of the sidecar repository, section Owned session operations) defines. The plugin sends none of them itself; core sends them for `core.session.open`, `core.session.resize` and `core.session.end`.

- `open` creates a PTY session of the owner surface at the requested size. The sidecar converts the size to cells with the metrics of its own font: each of `floor(width × scale / cellWidth)` columns and `floor(height × scale / cellHeight)` rows, where `width` and `height` are in points and the cell size is in device pixels. A size that gives no whole cell is refused.
- `params` of `open` is the launch request of the terminal `open` (`shell` or `program` with `args`, and `directory`), the same fields that a terminal surface sends. An invalid value is refused with the reason of that request.
- `resize` changes the cell grid of an open session to the new size and sends the new size to the PTY.
- `end` ends the PTY session and its process.

## Tab attachment

A tab shows an owned session with `core.layout.open {card, plugin, params: {session}}`. Core then sends the frame size of the card with `core.session.resize`. The attach request from the tab to the sidecar is not defined yet, so a tab currently starts its own session as before. This part is open: see `docs/features.md`.

## Open decisions

- The font of an owned session before a tab attaches: the sidecar uses the default font at its default size (13 points, the size of an unconfigured surface). A tab that shows the session with a configured font gets a different cell grid, so the font for the metrics of an owned session needs a decision.
- The wire of the attach request from a tab to an open session. The core contract names only `core.layout.open` with `params.session`.
