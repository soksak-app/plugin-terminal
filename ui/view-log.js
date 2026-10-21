// Terminal-owned adapter from surface log calls to the view route.
const LEVELS = ["error", "warn", "info", "debug", "trace"];
export function createViewLog(calls, report) {
  const send = (params) => calls.request("runtime.log", params)
    .then(undefined, (error) => report("view call runtime.log: " + (error?.message ?? error)));
  return Object.fromEntries(LEVELS.map((level) => [level,
    (event, fields, { cids } = {}) => send({ level, event,
      fields: typeof fields === "function" ? fields() : fields,
      ...(cids === undefined ? {} : { cids }) })]));
}
