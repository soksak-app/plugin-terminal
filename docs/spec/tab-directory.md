# Tab directory

[한국어](tab-directory.ko.md)

The opener of a terminal tab names the directory that the session starts in with the tab parameter `directory`, such as `core.layout.open {card, plugin: "terminal", params: {program, args, directory}}`. `surface.params` of `plugin.json` declares `directory` as a string member beside `session` and `title`, and core checks the params of a tab against it (core `docs/spec/plugins.md`).

## Rules

- A tab whose params carry `directory` opens its session in that directory: the `open` request of the sidecar carries `directory` with that value, and the footer of the card shows it, as the start directory of the session.
- The value must be an absolute path by the rule of core `docs/spec/native-surfaces.md` (origin refusal): it starts with `/`, does not start with `//` or `/<letter>:`, and holds no NUL byte. Any other value, including an empty string, refuses the start of the view with `tab directory must be an absolute path: <value>` before the view opens a session, so no session starts.
- Without `directory`, or with `directory` `null`, the session starts in the origin directory of the tab, then the project root, then the home directory, as core `docs/spec/plugins.md` states for a surface that starts in a working directory; a `directory` param takes the place of the origin directory and leaves the rest of that order unchanged.
- The directory of the tab is the start directory only. The shell report of the directory (OSC 7) changes the footer and the directory that a replaced service reopens, as before.
- `directory` combines with `program`, `args`, `role`, `title` and the shell. It does not combine with `session`: a tab that names an owned session attaches to it and starts no session, so its `directory` is not read.
