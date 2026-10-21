# Terminal plugin acceptance

[한국어](acceptance.ko.md)

This plugin holds these two criteria of terminal image regions. Core keeps the generic criteria of [surface composition](https://github.com/soksak-app/core/blob/main/docs/spec/surface-composition.md#acceptance).

- A terminal image preserves its logical text while resizing: narrowing reduces terminal columns and reflows long logical rows onto multiple screen rows; widening increases columns and reflows those rows back without truncation or permanent narrow wrapping.
- Terminal cell width and height are stable presentation metrics during layout; divider movement changes the surface and raster geometry, not the font or cell metrics, and native geometry changes do not animate.
