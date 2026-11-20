import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adapterFor, assertLaunchPath, claudeLaunch, codexLaunch, firstMessage, identityText } from "../ui/agent-role.js";

// The shared case file of core docs/spec/cases/agent-roles/fingerprint.json, copied to test/fixtures/agent-roles-fingerprint.json.
// Its texts are the English texts that soksak gives an agent; the tests compare the module output with them after the placeholders
// are filled.
const CASES = JSON.parse(readFileSync(new URL("./fixtures/agent-roles-fingerprint.json", import.meta.url), "utf8"));
const fill = (text, values) => Object.entries(values).reduce((out, [key, value]) => out.split(key).join(value), text);

const ROLE_FILE = "/Users/example/config/agents/surface-1/role.md";
const IDENTITY_FILE = "/Users/example/config/agents/surface-1/identity.txt";

test("the identity text names the role file and equals the pinned text", () => {
  assert.equal(identityText(ROLE_FILE), fill(CASES.texts.identity, { "<role file>": ROLE_FILE }));
});

test("the Claude Code launch adds the identity file to the system prompt by flag", () => {
  assert.deepEqual(claudeLaunch(IDENTITY_FILE), ["--append-system-prompt-file", IDENTITY_FILE]);
});

test("the Codex launch passes the identity inline as a TOML string after --no-daemon", () => {
  const identity = fill(CASES.texts.identity, { "<role file>": ROLE_FILE });
  assert.deepEqual(codexLaunch(ROLE_FILE), ["--no-daemon", "-c", `developer_instructions="${identity}"`]);
});

test("the first message of a CLI without an adapter is the identity and the first-message suffix", () => {
  const identity = fill(CASES.texts.identity, { "<role file>": ROLE_FILE });
  assert.equal(firstMessage(ROLE_FILE), `${identity}\n${CASES.texts.first_message_suffix}`);
});

test("the adapter table holds Claude Code and Codex and no other CLI", () => {
  assert.deepEqual(adapterFor("claude").launch({ roleFile: ROLE_FILE, identityFile: IDENTITY_FILE }), ["--append-system-prompt-file", IDENTITY_FILE]);
  assert.deepEqual(adapterFor("codex").launch({ roleFile: ROLE_FILE, identityFile: IDENTITY_FILE }), codexLaunch(ROLE_FILE));
  assert.equal(adapterFor("aider"), null);
});

test("a role file path with a quote or a control character refuses the launch and names the path", () => {
  for (const path of [`/Users/example/a"b/role.md`, "/Users/example/a'b/role.md", "/Users/example/a\nb/role.md"]) {
    assert.throws(() => assertLaunchPath(path), (error) => error.message.startsWith("agent launch refused: ") &&
      error.message.includes(JSON.stringify(path)), `path ${JSON.stringify(path)} must refuse the launch`);
  }
  assert.equal(assertLaunchPath(ROLE_FILE), undefined);
});
