# Window checks

[한국어](window-checks.ko.md)

The window checks of the terminal view run in this repository, against the published core application of one core release, through `@soksak/window-check` ([window checks of a plugin](https://github.com/soksak-app/core/blob/main/docs/spec/plugins.md#window-checks-of-a-plugin)). They read no source of core and name no path of its repository.

## Run

```sh
make install     # once: installs the locked dependencies, among them @soksak/window-check
make test-app    # pnpm exec sok-test-app
```

`make test-app` runs on a computer with a display, only locally. No workflow of this repository runs it, because the checks need a running application that presents frames; `make test` and `make check` are the checks of CI.

`package.json` names the release file of the package as a development dependency, `https://github.com/soksak-app/core/releases/download/v<version>/soksak-window-check-<version>.tgz`, and the version is a core release inside `engines.soksak`. The version of the installed package selects the application of the run: `sok-test-app` downloads the application zip of that core release into `build/app-cache/<version>/`, packs this repository with `make pack OUT={out}`, installs the plugin and its sidecar into a new configuration folder under `build/test-app/`, starts the application with that folder, runs `node --test` on the files under `e2e/`, and quits the application. A passed run removes its folder; a failed run keeps it. The package holds `@soksak/client`, `@soksak/log-contract` and `@soksak/plugin-api` inside its release file, so pnpm installs it with its default settings; `pnpm-workspace.yaml` allows the build script of `@parcel/watcher`, which the package uses to watch folders.

The same checks run against development builds of core and against development checkouts of this plugin and of its sidecar: each application of the run starts from its build with `--config-dir <root>/soksak-check-<app>`, whose `plugins/installed.json` lists the plugin, the start probe of `@soksak/window-check` and the sidecar, and whose plugin and sidecar folders are symbolic links to the checkouts; `node --test e2e/` then runs with `SOKSAK_CONFIG_ROOT=<root>` and `SOKSAK_BINARY_WAILSV3`, `SOKSAK_BINARY_TAURIV2` and `SOKSAK_BINARY_MYGO` set to the executables of the builds. The checks start no application in either run.

`test/window-checks.test.mjs` checks the declaration: the development dependency names a core release file of the package inside the `engines.soksak` range, `e2e/` holds the check, and `make test-app` runs `pnpm exec sok-test-app`.

## Checks

`e2e/submit.test.mjs` runs one test for each application of the run, with a time limit of 180 seconds, with the shell `e2e/check-shell`: the program `e2e/paste-burst` reads its terminal in raw mode with bracketed paste mode on and takes a carriage return that follows typed text within 100 milliseconds as a new line of its input, as an agent with a paste burst rule does; `terminal.submit` sends its text, and the check requires the line `submitted: <text>` that the program prints for a carriage return that submits (`docs/spec/submit.md`).

`e2e/injection.test.mjs` runs three tests for each application of the run, each with a time limit of 180 seconds, in a project window with a receiver tab and a sender tab and the shell `e2e/check-shell`; it writes each message with `sok message send` of the application for the surface of the sender and judges the reply, `terminal.messages` of the receiver and its screen (core `docs/spec/messaging.md#injected-message`). The shell reports no OSC 133 mark, so the submitted line is judged by the error line of the shell, `[메시지: not found` or the syntax error of the parenthesis of the report request.

- A running command: the receiver runs `cat <named pipe> > /dev/null; echo command-ended`; the reply shows `held: null`, `terminal.messages` reports the message as `injected` while the command runs, and after the check writes the pipe the shell submits the injected line after the line `command-ended`.
- A blocked program: the receiver runs `e2e/blocked-prompt`, which reports `state=blocked:kind=permission` with OSC 7501, shows `Proceed? [y/N]` and reads one line; the reply shows the hold `blocked` of kind `permission`, `terminal.messages` holds one message with no decision, and the screen shows no byte of it; after the answer `y` through `terminal.input` the program prints `answer=y`, and the page then injects the message, which the shell submits after that line.
- A report: the sender writes a message, which holds the request `(끝나면 결과를 sok message send --reply <sender folder> "<보고>"로 보고하라)` with the folder of the sender (core `docs/spec/messaging.md#report-request`) and is injected into the receiver; the check then writes `sok message send --reply <sender folder> done` for the surface of the receiver, whose file `<receiver>.report-<token>.txt` holds `done` alone, and `terminal.messages` of the sender reports it as `injected`.

`e2e/owned-session.test.mjs` runs one test for each application of the run, with a time limit of 180 seconds: an owner tab opens an owned session with `core.session.open` that runs `e2e/program-state`, which reports the program state `working` with OSC 7501, waits for a line and then reports `idle`; a second tab shows the session with `core.layout.open` and the params `{session, title}`. The check requires the states `working` and then `idle` of the session in `core.sessions`, the title as the `label` of the tab in `core.grid` (`docs/spec/tab-title.md`), and an empty `unsupported` in `terminal.session` of both tabs, so neither view lists the owner event `session.program` as a sidecar event that it does not handle.
