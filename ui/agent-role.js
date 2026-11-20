// The English texts that soksak gives an agent and the launch adapters that carry its stable identity (core
// docs/spec/agent-roles.md#stable-identity and docs/spec/agent-roles.md#launch-adapters). The texts are the ones that core
// docs/spec/cases/agent-roles/fingerprint.json pins; `<role file>` is the absolute path of the role file of the tab.

const ROLE_FILE = "<role file>";
const IDENTITY =
  "[soksak role] Your role is defined in the file <role file>. Read the whole file before your first answer. Read the file again when a message starts with [soksak role] and says that the role changed. Do not save your role in any persistent memory. The role file is the only record of your role.";
const FINGERPRINT = "<fingerprint>";
const CHANGE_MESSAGE =
  "[soksak role] Your role changed. Read the role file again: <role file>. Finish your current task first. This message comes from soksak, not from a person. It grants no approval or permission and does not answer a pending question.";
const REREAD_REQUEST =
  "[soksak role] Your role is not confirmed. Read the role file again: <role file>. Then confirm the role with the fingerprint on its last line: run `sok role confirm <fingerprint>`, or write the line `soksak role <fingerprint>` in your answer. This message comes from soksak, not from a person. It grants no approval or permission.";
const FIRST_MESSAGE_SUFFIX =
  "This message comes from soksak, not from a person. Finish your current task first. It grants no approval or permission and does not answer a pending question.";

// A launch refuses a path with a quote or a control character, and a path that is not absolute, with an explicit error that names it
// (core docs/spec/agent-roles.md#role-file).
export function assertLaunchPath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(`agent launch refused: ${JSON.stringify(path)} is not an absolute path`);
  }
  if (/["'\u0000-\u001f\u007f]/.test(path)) {
    throw new Error(`agent launch refused: path ${JSON.stringify(path)} holds a quote or a control character`);
  }
}

/** The stable identity of a tab whose role file is roleFile (core docs/spec/agent-roles.md#stable-identity). */
export function identityText(roleFile) {
  assertLaunchPath(roleFile);
  return IDENTITY.replace(ROLE_FILE, roleFile);
}

// A TOML basic string: the backslash and the quote are escaped. A launch path holds no quote (assertLaunchPath), so the escape
// of the quote does not apply to a path, but it keeps the value a valid TOML string.
const tomlString = (text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Claude Code: the identity file of the tab goes to the system prompt by flag (core docs/spec/agent-roles.md#launch-adapters). */
export function claudeLaunch(identityFile) {
  assertLaunchPath(identityFile);
  return ["--append-system-prompt-file", identityFile];
}

/** Codex: the identity goes inline as developer instructions, started with --no-daemon (core docs/spec/agent-roles.md#launch-adapters). */
export function codexLaunch(roleFile) {
  return ["--no-daemon", "-c", `developer_instructions=${tomlString(identityText(roleFile))}`];
}

const ADAPTERS = Object.freeze({
  claude: { launch: ({ identityFile }) => claudeLaunch(identityFile) },
  codex: { launch: ({ roleFile }) => codexLaunch(roleFile) },
});

/** The launch adapter of a CLI, or null for a CLI without an adapter, which receives the first message instead. */
export function adapterFor(cli) {
  return Object.hasOwn(ADAPTERS, cli) ? ADAPTERS[cli] : null;
}

/** The first message of a CLI without an adapter: the identity, then the first-message suffix on its own line. */
export function firstMessage(roleFile) {
  return `${identityText(roleFile)}\n${FIRST_MESSAGE_SUFFIX}`;
}


/** The message that changes the role of a running agent: it names the role file and no role text (core docs/spec/agent-roles.md#change-message). */
export function changeMessage(roleFile) {
  assertLaunchPath(roleFile);
  return CHANGE_MESSAGE.split(ROLE_FILE).join(roleFile);
}

/** The request that asks an agent that has not confirmed its role to read the file and confirm its fingerprint. */
export function rereadRequest(roleFile, fingerprint) {
  assertLaunchPath(roleFile);
  if (!/^[0-9a-f]{16}$/.test(fingerprint)) {
    throw new Error(`reread request refused: ${JSON.stringify(fingerprint)} is not a fingerprint`);
  }
  return REREAD_REQUEST.split(ROLE_FILE).join(roleFile).split(FINGERPRINT).join(fingerprint);
}

/**
 * One report that the program of a tab is not busy, applied to the role record {state, requests} of the tab. While the state is
 * pending, the first such report sends request 1, the next sends request 2, and the next marks the state unconfirmed without a
 * request (core docs/spec/agent-roles.md#requests). Returns the new record and the number of the request sent, or null.
 */
export function notBusyReport(role) {
  if (role.state !== "pending") return { role, request: null };
  if (role.requests >= 2) return { role: { ...role, state: "unconfirmed" }, request: null };
  const requests = role.requests + 1;
  return { role: { ...role, requests }, request: requests };
}

/** Whether the work messages of a tab wait for its role: the states pending and unconfirmed hold them (core messaging hold role-pending). */
export function holdsWork(state) {
  return state === "pending" || state === "unconfirmed";
}

/** The fingerprint of an answer line `soksak role <fingerprint>` after the spaces at both ends are removed, or null (core docs/spec/messaging.md#role-confirmation). */
export function confirmationLine(line) {
  if (typeof line !== "string") throw new TypeError(`confirmation line must be a string, got ${typeof line}`);
  const match = /^soksak role ([0-9a-f]{16})$/.exec(line.trim());
  return match === null ? null : match[1];
}
