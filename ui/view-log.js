// Terminal-owned adapter from surface log calls to the view route.
const LEVELS = ["error", "warn", "info", "debug", "trace"];

/** The text of a thrown value: the message of an Error, and the value itself for any other thrown value. */
export const errorText = (error) => error instanceof Error ? error.message : String(error);

/**
 * A refused record keeps its console line, and the refusal goes to the error route of the view with where log, so the
 * record is not lost silently. text names the record and the refusal.
 */
export function reportRefusedLog(calls, text, refusal) {
  console.error(`runtime.log ${text}`);
  return calls.request("runtime.error", { where: "log", text: `${text} (refused: ${errorText(refusal)})` })
    .then(undefined, (error) => console.error(`runtime.error log ${errorText(error)}`));
}

/** The reporter of this page: each record is written to the application log through the call runtime.log (core docs/spec/logging.md). */
export function createReporter(calls) {
  return (text) => calls.request("runtime.log", { level: "error", event: "plugin.terminal.report", fields: { text } })
    .then(undefined, (error) => reportRefusedLog(calls, text, error));
}

export function createViewLog(calls) {
  const send = (params) => calls.request("runtime.log", params)
    .then(undefined, (error) => reportRefusedLog(calls, `${params.event}`, error));
  return Object.fromEntries(LEVELS.map((level) => [level,
    (event, fields, { cids } = {}) => send({ level, event,
      fields: typeof fields === "function" ? fields() : fields,
      ...(cids === undefined ? {} : { cids }) })]));
}
