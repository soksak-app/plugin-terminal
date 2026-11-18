# Submit command

[한국어](submit.ko.md)

The command `terminal.submit` sends one sentence to the terminal session and then sends Enter as a separate key action, so that a program in the terminal receives the sentence as typed text and then the key that submits it.

## Contract

- Name: `terminal.submit`.
- Input: `{text}`, where `text` is a string.
- Refusals, each an explicit error that names the command and the reason, raised before any input is sent:
  - `text` is not a string, or it is an empty string.
  - `text` contains a carriage return (U+000D) or a line feed (U+000A).
- Writes, in this order, each sent as one input of the terminal session (the same input path as `terminal.input` and the keyboard):
  1. One insert action with `text`, with no change of the replacement range and no attributed text.
  2. One key action with `key` `Enter` and `shift`, `alt` and `ctrl` all `false`, sent as a separate input after the insert has been sent.
- Result: `null`. The result means that both writes were sent to the session. It does not mean that the target program accepted the text or the Enter.
- Confirmation: the caller confirms the submit from status, not from the result. The input line of `terminal.screen` and the busy state of the program show whether the program took the sentence and started to work.
- The command does not wait for a timer or a delay between the two writes. The order of the writes follows the order of the input queue of the session.

## Errors

A refusal ends the command with an error and sends no input, so a caller that receives an error knows that nothing was sent. A failure of either write is reported as an error of the command by the same path as `terminal.input`.
