# Agent roles

This document defines how the terminal plugin page carries out the agent role contract of core ([agent roles](https://github.com/soksak-app/core/blob/main/docs/spec/agent-roles.md)). The page sends the role messages and confirms the role of its tab; core owns the role state, the fingerprint and the confirmation command.

## Confirmation

- The page matches each row of the visible screen against the confirmation line of core: the row without the spaces at both ends ends with `soksak role <fingerprint>`, and the text before it is empty or a marker of characters that are neither letters nor digits followed by a space. The pattern is the one of the shared case file `confirmation-line.json` of core.
- A matched fingerprint is sent once per generation of the role, through the view call `runtime.command.run` as the command `core.tab.role.confirm` with `{fingerprint}` on the surface of the tab.
- A refusal with the text `stale fingerprint: read the role file again at <path>` is recorded as the event `plugin.terminal.messages.role.stale` with the refused `fingerprint` and the `current` fingerprint of the role status. It is an outcome of a change that raced the confirmation, not an error, and it shows nothing in the error display. The next not-busy report sends the reread request again.
- Any other refusal of the confirmation is an error, shown through the error display with the text `terminal.messages: confirm: <text>`.

## Reread requests

- While the role is `pending`, each report of the program that is at rest sends one reread request, with no limit, and the page counts it per generation.
- The count is the field `requests` of the event `plugin.terminal.messages.role.delivered` with kind `role-reread`. The page reads no count of core.

## Rules of the page

- The page adds no screen watch. Each watch of the screen makes the sidecar send a `screen.read`, so the page checks the confirmation line from its own screen handler, which runs when the visible rows change.
