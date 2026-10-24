# Terminal plugin acceptance

[한국어](acceptance.ko.md)

This plugin holds the criteria of terminal image regions. Core keeps the generic criteria of [surface composition](https://github.com/soksak-app/core/blob/main/docs/spec/surface-composition.md#acceptance).

- A terminal image preserves its logical text while resizing: narrowing reduces terminal columns and reflows long logical rows onto multiple screen rows; widening increases columns and reflows those rows back without truncation or permanent narrow wrapping.
- Terminal cell width and height are stable presentation metrics during layout; divider movement changes the surface and raster geometry, not the font or cell metrics, and native geometry changes do not animate.

- A primary pointer press on the terminal view runs the declared `terminal.focus` command through the shared exposure binder. The command transfers keyboard ownership to the native image region. The view prevents default DOM focus, reports a failed focus in `terminal.session` and through the surface error path, and removes the binding when the page is disposed. A separate view document does not depend on pointer bubbling to a card in the main document.
- A native insert commits only its text. It does not imply that the remaining input-method preedit ended; a later compose event, including an empty one, owns that state change. A partial commit therefore keeps the current preedit displayed with the committed prefix and sends the insert without first clearing the preedit. The insert does not delete pending native document text.
