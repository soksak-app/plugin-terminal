import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const vector = JSON.parse(readFileSync(new URL("./fixtures/screen-message.json", import.meta.url), "utf8"));

test("the terminal owns one screen vector and the SDK literal uses that same vector", () => {
  assert.deepEqual(Object.keys(vector).sort(), ["hash", "message", "name"]);
  assert.equal(vector.name, "empty one cell");
  assert.equal(vector.message.event, "screen");
  assert.equal(vector.message.sequence, 2);
  assert.equal(vector.hash, "0b1b5a155fc09ab5d44c3aab7da1069acfbd4bb865de6831a15f2cfb8f8161a0");
  const literal = JSON.parse(readFileSync(new URL("../view-check.json", import.meta.url), "utf8"));
  assert.deepEqual(literal.screenMessage, vector, "the check literal differs from the vector that the terminal test uses");
});
