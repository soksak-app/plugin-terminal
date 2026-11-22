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

A tab shows an owned session with `core.layout.open {card, plugin, params: {session}}`. The view of the tab does not start a session of its own. It sends the sidecar `{operation: "attach", session}` on its surface. From then on the view gets that session's output, sends its input to it, and sends its settings (font among them) through its configure exactly as it does for a session of its own; the configure recomputes the grid of the session and resizes its PTY. Core sends `core.session.resize` with the frame size of the card when the tab is shown and when the frame changes, and the sidecar applies it to the attached session. Ending the view detaches it and leaves the session open. A session has at most one attached view; the sidecar refuses a second attach.

The sidecar's rules and replies are in its own specification (`docs/spec/vt-core.md`, section Owned session operations).

The view of the owner surface also receives the owner event `session.program` through its sidecar subscription. Core reads that event for `core.sessions`; the view handles it by an explicit branch that changes no state, because the program state of a tab comes from OSC 7501 records only (core `docs/spec/terminal-state.md`), and it does not list the event in `unsupported` of `terminal.session`.

## Open decisions

- None in this specification. The attach request carries no font; the font of the view reaches the session through the configure.
