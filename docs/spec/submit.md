# Submit command

[한국어](submit.ko.md)

The command `terminal.submit` sends one sentence to the terminal session as a paste and then sends Enter as a separate input after the reply of the paste, so that a program in the terminal receives the sentence as one pasted line and then the key that submits it. A program that takes fast typed text as a paste, as an agent with a paste burst rule does, takes an Enter that follows typed text closely as a new line of its input; a bracketed paste and an Enter after its reply are a line and its submit for such a program. The page injects a message of core `docs/spec/messaging.md#injected-message` through the same function.

## Contract

- Name: `terminal.submit`.
- Input: `{text}`, where `text` is a string.
- Refusals, each an explicit error that names the command and the reason, raised before any input is sent:
  - `text` is not a string, or it is an empty string.
  - `text` contains a carriage return (U+000D) or a line feed (U+000A).
- Writes, in this order, each sent as one input of the terminal session through its input queue:
  1. One `paste` with `text`, which the sidecar writes as a bracketed paste when the program enabled bracketed paste mode (mode 2004) and as the text otherwise.
  2. After the reply of the paste, one key action with `key` `Enter` and `shift`, `alt` and `ctrl` all `false`.
- Result: `null` after the sidecar answered both writes. It does not mean that the target program accepted the text or the Enter.
- Confirmation: the caller confirms the submit from status, not from the result. The input line of `terminal.screen` and the busy state of the program show whether the program took the sentence and started to work.
- The command waits for no timer between the two writes; the Enter follows the reply of the paste.

## Errors

A refusal ends the command with an error and sends no input, so a caller that receives an error knows that nothing was sent. A reply of the sidecar that refuses a write, such as `guardRefused` of the destructive command guard, ends the command with the error `terminal.submit: <error>: <reason>`, which the error display of the terminal shows; a refused paste sends no Enter. A failure of either write is reported as an error of the command by the same path as `terminal.input`.
