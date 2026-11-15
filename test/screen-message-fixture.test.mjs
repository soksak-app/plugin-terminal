import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const vectors = JSON.parse(readFileSync(new URL("./fixtures/screen-message.json", import.meta.url), "utf8"));

test("the terminal owns one screen vector", () => {
  assert.deepEqual(Object.keys(vectors), ["vectors"]);
  assert.equal(vectors.vectors.length, 1);
  const vector = vectors.vectors[0];
  assert.deepEqual(Object.keys(vector).sort(), ["message", "name"]);
  assert.equal(vector.name, "empty one cell");
  assert.equal(vector.message.event, "screen");
  assert.equal(vector.message.sequence, 2);
});
