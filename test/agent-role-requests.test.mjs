import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { changeMessage, confirmationLine, rereadRequest } from "../ui/agent-role.js";

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

// The shared case file of the confirmation line of core, which the page matcher runs against every case (core docs/spec/agent-roles.md#confirmation).
const CONFIRMATION = JSON.parse(readFileSync(new URL("./fixtures/agent-roles-confirmation-line.json", import.meta.url), "utf8"));

test("the confirmation line matcher gives the verdict of each shared case of the confirmation line", () => {
  assert.equal(CONFIRMATION.cases.length, 15);
  for (const { row, match } of CONFIRMATION.cases) {
    const fingerprint = confirmationLine(row);
    assert.equal(fingerprint !== null, match, `row ${JSON.stringify(row)}`);
    if (match) assert.equal(fingerprint, row.trim().slice(-16), `row ${JSON.stringify(row)} carries its fingerprint`);
  }
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
