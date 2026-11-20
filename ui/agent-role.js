// The English texts that soksak gives an agent: the identity of its stable role and the messages that carry it (core
// docs/spec/agent-roles.md#stable-identity). The texts are the ones that core
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

/** The first message of a program launched with a role: the identity, then the first-message suffix on its own line (core docs/spec/agent-roles.md#first-message). */
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

// The row pattern of core docs/spec/cases/agent-roles/confirmation-line.json: an optional marker of characters that are neither
// letters nor digits, followed by at least one space, before the line form.
const CONFIRMATION_ROW = /^(?:[^\p{L}\p{N}]+ +)?soksak role ([0-9a-f]{16})$/u;

/** Whether a refusal of core.tab.role.confirm is the stale refusal: the confirmation belongs to an earlier file (core docs/spec/agent-roles.md#confirmation). */
export function isStaleConfirmation(text) {
  return /^stale fingerprint: read the role file again at /.test(text);
}

/**
 * The fingerprint of a screen row that holds the confirmation line `soksak role <fingerprint>`, or null. The row matches when, after
 * the spaces at both ends are removed, it ends with the line, and the text before the line is empty or a marker such as the answer
 * glyph of a CLI (core docs/spec/agent-roles.md#confirmation).
 */
export function confirmationLine(row) {
  if (typeof row !== "string") throw new TypeError(`confirmation row must be a string, got ${typeof row}`);
  const match = CONFIRMATION_ROW.exec(row.trim());
  return match === null ? null : match[1];
}

const ROLE_IDENTIFIER = /^[a-z][a-z0-9-]*$/;
const isText = (value) => typeof value === "string" && value !== "";

/**
 * The launch of a terminal tab from its start parameters `{program, args, role}` (core docs/spec/agent-roles.md#start-parameters).
 * Absent parameters, or a null program, start the shell. Returns {program, args, role} with program null for the shell.
 */
export function launchOf(params) {
  if (params !== null && params !== undefined && (typeof params !== "object" || Array.isArray(params))) {
    throw new Error("tab parameters must be an object");
  }
  const { program: rawProgram = null, args: rawArgs = null, role: rawRole = null } = params ?? {};
  if (rawArgs !== null && (!Array.isArray(rawArgs) || !rawArgs.every(isText))) {
    throw new Error("launch args must be an array of texts");
  }
  const args = rawArgs ?? [];
  if (rawProgram !== null && !isText(rawProgram)) throw new Error("launch program must be a non-empty text");
  const program = rawProgram;
  if (program === null && args.length > 0) throw new Error("args require program");
  if (rawRole !== null && (typeof rawRole !== "string" || rawRole.length > 64 || !ROLE_IDENTIFIER.test(rawRole))) {
    throw new Error(`invalid role identifier ${JSON.stringify(rawRole)}`);
  }
  if (program === null && rawRole !== null) throw new Error("role requires program");
  return { program, args, role: rawRole };
}

/**
 * Whether a report of a program is at rest: it has an idle or done record and no working, blocked or error record, so the program
 * waits at its own prompt (core docs/spec/terminal-state.md#program-status). Only a report at rest is a not-busy report.
 */
export function isAtRest({ records }) {
  const states = new Set(records.map((record) => record.state));
  return (states.has("idle") || states.has("done")) && !states.has("working") && !states.has("blocked") && !states.has("error");
}
