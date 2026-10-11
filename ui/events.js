const LEVELS = new Set(["error", "warn", "info", "debug", "trace"]);

/**
 * Returns `emitEvent(level, name, fields)`, which stores an event of the plugin `pluginId` through `runtime.log`
 * (core docs/spec/plugins.md#logging). `name` is the full catalog name `plugin.<pluginId>.<event>`; the log adds that prefix.
 * `fields` is an object, or a function that builds it, which the emitter calls when it stores the event.
 */
export function createEmitter(runtime, pluginId) {
  const prefix = `plugin.${pluginId}.`;
  return function emitEvent(level, name, fields) {
    if (!LEVELS.has(level)) throw new TypeError(`emitEvent requires a level of ${[...LEVELS].join(", ")}, got ${String(level)}`);
    if (typeof name !== "string" || !name.startsWith(prefix)) throw new TypeError(`emitEvent requires a name that starts with ${prefix}`);
    const built = typeof fields === "function" ? fields() : fields;
    if (built === null || typeof built !== "object" || Array.isArray(built)) throw new TypeError("emitEvent requires fields as an object");
    runtime.log[level](name.slice(prefix.length), built);
  };
}
