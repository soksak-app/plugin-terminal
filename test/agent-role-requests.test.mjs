import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { changeMessage, confirmationLine, holdsWork, notBusyReport, rereadRequest } from "../ui/agent-role.js";

// The pinned texts of core docs/spec/cases/agent-roles/fingerprint.json (test/fixtures/agent-roles-fingerprint.json).
const CASES = JSON.parse(readFileSync(new URL("./fixtures/agent-roles-fingerprint.json", import.meta.url), "utf8"));
const fill = (text, values) => Object.entries(values).reduce((out, [key, value]) => out.split(key).join(value), text);

const ROLE_FILE = "/Users/example/config/agents/surface-1/role.md";
const FINGERPRINT = "33796c71bac2615d";

test("the change message names the role file and equals the pinned text", () => {
  assert.equal(changeMessage(ROLE_FILE), fill(CASES.texts.change_message, { "<role file>": ROLE_FILE }));
});

test("the reread request names the role file and the fingerprint in both places and equals the pinned text", () => {
  assert.equal(rereadRequest(ROLE_FILE, FINGERPRINT),
    fill(CASES.texts.reread_request, { "<role file>": ROLE_FILE, "<fingerprint>": FINGERPRINT }));
});

test("a not-busy report while pending sends request 1, then request 2, then marks unconfirmed without a send", () => {
  const first = notBusyReport({ state: "pending", requests: 0 });
  assert.deepEqual(first, { role: { state: "pending", requests: 1 }, request: 1 });
  const second = notBusyReport(first.role);
  assert.deepEqual(second, { role: { state: "pending", requests: 2 }, request: 2 });
  const third = notBusyReport(second.role);
  assert.deepEqual(third, { role: { state: "unconfirmed", requests: 2 }, request: null });
  assert.deepEqual(notBusyReport(third.role), { role: { state: "unconfirmed", requests: 2 }, request: null });
});

test("a not-busy report sends nothing in ready and in no role", () => {
  assert.deepEqual(notBusyReport({ state: "ready", requests: 0 }), { role: { state: "ready", requests: 0 }, request: null });
  assert.deepEqual(notBusyReport({ state: null, requests: 0 }), { role: { state: null, requests: 0 }, request: null });
});

test("the work messages are held while the state is pending or unconfirmed, and not in ready or without a role", () => {
  assert.equal(holdsWork("pending"), true);
  assert.equal(holdsWork("unconfirmed"), true);
  assert.equal(holdsWork("ready"), false);
  assert.equal(holdsWork(null), false);
});

test("a confirmation line matches only the exact line form with 16 lowercase hexadecimal characters", () => {
  assert.equal(confirmationLine(`soksak role ${FINGERPRINT}`), FINGERPRINT);
  assert.equal(confirmationLine(`   soksak role ${FINGERPRINT}  `), FINGERPRINT);
  assert.equal(confirmationLine(FINGERPRINT), null, "the bare fingerprint of the file does not match");
  assert.equal(confirmationLine("soksak role <fingerprint>"), null, "the placeholder does not match");
  assert.equal(confirmationLine(`soksak role ${FINGERPRINT.toUpperCase()}`), null);
  assert.equal(confirmationLine(`soksak role ${FINGERPRINT.slice(1)}`), null, "15 characters do not match");
  assert.equal(confirmationLine(`soksak role  ${FINGERPRINT}`), null, "a second space is not the line form");
  assert.equal(confirmationLine(`say soksak role ${FINGERPRINT}`), null);
});
