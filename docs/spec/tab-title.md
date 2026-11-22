# Tab title

[한국어](tab-title.ko.md)

The opener of a terminal tab names the tab with the tab parameter `title`, such as `core.layout.open {card, plugin: "terminal", params: {session, title}}`. `surface.params` of `plugin.json` declares `title` as a string member beside `session`, and core checks the params of a tab against it (core `docs/spec/plugins.md`).

## Rules

- A tab whose params carry `title` reports it through `tab.title` (core `docs/spec/plugins.md#tab-reports`) when the view starts, and the tab shows it in place of its name.
- The view of such a tab reports no program title (OSC 0 and OSC 2) to the tab, and the setting `title` does not apply to it. The program title stays unused: the card footer of a terminal shows its working directory (core `docs/spec/plugins.md`, `tab.footer`), so the footer does not take it.
- The value follows the text rule of `tab.title`: a string of 1 to 256 characters without control characters (U+0000–U+001F and U+007F–U+009F). Any other value, such as a number, an empty string or a text with a control character, refuses the start of the view with `tab title must be a text of 1 to 256 characters without control characters`, before the view opens or attaches a session. The schema grammar of `surface.params` has no length or character keyword, so the view checks the rest of the rule.
- `title` combines with `session`, with `program`, `args` and `role`, and with the shell. A tab without `title`, or with `title` `null`, shows the program title or its name as the setting `title` selects.
