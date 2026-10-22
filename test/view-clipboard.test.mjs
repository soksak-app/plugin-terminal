// The view clipboard over a fake view port of the call route of a view (core docs/spec/native-surfaces.md#view-surfaces, view
// calls): runtime.clipboard.read png answers {present, type, data} with base64 data, and runtime.clipboard.persistPNG takes
// {data} and answers {path, shellQuotedPath}. The fake serves no other call and records each call as [command, params].
import assert from "node:assert/strict";
import test from "node:test";
import { viewClipboard } from "../build/test/ui/view-clipboard.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PERSISTED = Object.freeze({ path: "/config/clipboard/pasted-image.png", shellQuotedPath: "'/config/clipboard/pasted-image.png'" });
const base64 = (bytes) => Buffer.from(bytes).toString("base64");

/** A fake view port: request(command, params) answers from answers and records the call. */
function fakeViewPort(answers) {
  const calls = [];
  return {
    calls,
    request: async (command, params) => {
      calls.push([command, params]);
      if (!Object.hasOwn(answers, command)) throw new Error(`the fake view port serves no call ${command}`);
      return answers[command](params);
    },
  };
}

test("the view clipboard reads a PNG payload as the bytes that the surface clipboard reads", async () => {
  const port = fakeViewPort({
    "runtime.clipboard.read": (type) => (type === "png" ? { present: true, type: "png", data: base64(PNG) } : null),
  });
  const clipboard = viewClipboard(port);
  const png = await clipboard.read("png");
  assert.deepEqual(png, PNG, "the read returns the PNG bytes of the payload");
  assert.deepEqual(port.calls, [["runtime.clipboard.read", "png"]]);
});

test("the view clipboard persists PNG bytes through the call route and returns the persisted path", async () => {
  const port = fakeViewPort({
    "runtime.clipboard.persistPNG": ({ data }) => (data === base64(PNG) ? PERSISTED : null),
  });
  const clipboard = viewClipboard(port);
  assert.equal(typeof clipboard.persistPNG, "function", "the view clipboard has persistPNG");
  const persisted = await clipboard.persistPNG(PNG);
  assert.deepEqual(persisted, PERSISTED);
  assert.deepEqual(port.calls, [["runtime.clipboard.persistPNG", { data: base64(PNG) }]]);
});

test("the view clipboard refuses a PNG read whose answer carries another type", async () => {
  const port = fakeViewPort({
    "runtime.clipboard.read": () => ({ present: true, type: "text", data: base64(PNG) }),
  });
  await assert.rejects(viewClipboard(port).read("png"), /clipboard png response is invalid/);
});
