// The view clipboard over a fake view port of the call route of a view (core docs/spec/native-surfaces.md#view-surfaces, view
// calls) and a fake fetch of the binary path of the view document (core docs/spec/plugin-processes.md#binary-path): a PNG read
// answers {present, type, binary}, whose bytes the page downloads, and runtime.clipboard.persistPNG takes {binary}, the id of an
// upload, and answers {path, shellQuotedPath}. The fake port serves no other call and records each call as [command, params]; the
// fake fetch records each request with its address resolved against the address of a view document.
import assert from "node:assert/strict";
import test from "node:test";
import { viewClipboard } from "../build/test/ui/view-clipboard.js";

const DOCUMENT = "soksak://probe/ui/terminal.html";
const ID = "0123456789abcdef0123456789abcdef";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PERSISTED = Object.freeze({ path: "/config/clipboard/pasted-image.png", shellQuotedPath: "'/config/clipboard/pasted-image.png'" });

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

/**
 * Replaces fetch for one test. Each request takes the next of responses, {status, json}, {status, bytes} or an Error that the
 * fetch rejects with, and is recorded as {url, method, type, body}.
 */
function fakeFetch(t, responses) {
  const requests = [];
  const { fetch: original } = globalThis;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init = {}) => {
    requests.push({
      url: new URL(url, DOCUMENT).href,
      method: init.method ?? "GET",
      type: init.headers?.["Content-Type"] ?? null,
      body: init.body ?? null,
    });
    if (responses.length === 0) throw new Error(`the fake fetch has no response for ${url}`);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.json,
      arrayBuffer: async () => Uint8Array.from(response.bytes).buffer,
    };
  };
  return requests;
}

test("the view clipboard downloads the bytes of the binary id of a PNG read", async (t) => {
  const requests = fakeFetch(t, [{ status: 200, bytes: PNG }]);
  const port = fakeViewPort({
    "runtime.clipboard.read": (type) => (type === "png" ? { present: true, type: "png", binary: ID } : null),
  });
  const png = await viewClipboard(port).read("png");
  assert.ok(png instanceof Uint8Array, "the read returns bytes");
  assert.deepEqual([...png], [...PNG], "the read returns the bytes of the id");
  assert.deepEqual(port.calls, [["runtime.clipboard.read", "png"]]);
  assert.deepEqual(requests, [{ url: `soksak://probe/.binary/${ID}`, method: "GET", type: null, body: null }]);
});

test("the view clipboard answers null for a clipboard without a PNG and downloads nothing", async (t) => {
  const requests = fakeFetch(t, []);
  const port = fakeViewPort({ "runtime.clipboard.read": () => null });
  assert.equal(await viewClipboard(port).read("png"), null);
  assert.deepEqual(requests, []);
});

test("the view clipboard returns a text read as the call answers it", async (t) => {
  const requests = fakeFetch(t, []);
  const port = fakeViewPort({ "runtime.clipboard.read": () => "text of the clipboard" });
  assert.equal(await viewClipboard(port).read("text"), "text of the clipboard");
  assert.deepEqual(requests, []);
});

test("the view clipboard uploads PNG bytes to the binary path and sends their id", async (t) => {
  const requests = fakeFetch(t, [{ status: 200, json: { id: ID, length: PNG.length } }]);
  let uploaded = 0;
  const port = fakeViewPort({
    "runtime.clipboard.persistPNG": () => {
      uploaded = requests.length;
      return PERSISTED;
    },
  });
  const clipboard = viewClipboard(port);
  assert.equal(typeof clipboard.persistPNG, "function", "the view clipboard has persistPNG");
  const persisted = await clipboard.persistPNG(PNG);
  assert.deepEqual(persisted, PERSISTED);
  assert.deepEqual(requests, [{ url: "soksak://probe/.binary", method: "POST", type: "image/png", body: PNG }]);
  assert.equal(uploaded, 1, "the call follows the upload");
  assert.deepEqual(port.calls, [["runtime.clipboard.persistPNG", { binary: ID }]], "the call carries only the binary id");
});

test("the view clipboard refuses a PNG read whose answer carries another type", async (t) => {
  const requests = fakeFetch(t, []);
  const port = fakeViewPort({
    "runtime.clipboard.read": () => ({ present: true, type: "text", binary: ID }),
  });
  await assert.rejects(viewClipboard(port).read("png"), /clipboard png response is invalid/);
  assert.deepEqual(requests, []);
});

test("the view clipboard refuses a PNG read without a binary id", async (t) => {
  const requests = fakeFetch(t, []);
  const answers = [
    { present: true, type: "png", data: "iVBORw==" },
    { present: true, type: "png", binary: "not an id" },
    { present: true, type: "png", binary: ID.toUpperCase() },
    { present: false, type: "png", binary: ID },
  ];
  for (const answer of answers) {
    const port = fakeViewPort({ "runtime.clipboard.read": () => answer });
    await assert.rejects(viewClipboard(port).read("png"), /clipboard png response is invalid/, JSON.stringify(answer));
  }
  assert.deepEqual(requests, []);
});

test("the view clipboard reports a failed download with its status and reason", async (t) => {
  fakeFetch(t, [{ status: 404, json: { error: "binary id is not stored" } }]);
  const port = fakeViewPort({ "runtime.clipboard.read": () => ({ present: true, type: "png", binary: ID }) });
  await assert.rejects(viewClipboard(port).read("png"), new RegExp(`binary download of ${ID} failed with 404: binary id is not stored`));
});

test("the view clipboard passes on a download that the fetch refuses", async (t) => {
  fakeFetch(t, [new Error("the fetch of the download failed")]);
  const port = fakeViewPort({ "runtime.clipboard.read": () => ({ present: true, type: "png", binary: ID }) });
  await assert.rejects(viewClipboard(port).read("png"), /the fetch of the download failed/);
});

test("the view clipboard reports a failed upload with its status and reason and sends no call", async (t) => {
  fakeFetch(t, [{ status: 413, json: { error: "the upload is over 16 MiB" } }]);
  const port = fakeViewPort({});
  await assert.rejects(viewClipboard(port).persistPNG(PNG), /binary upload failed with 413: the upload is over 16 MiB/);
  assert.deepEqual(port.calls, []);
});

test("the view clipboard refuses an upload that answers no binary id and sends no call", async (t) => {
  fakeFetch(t, [{ status: 200, json: { id: "not an id", length: PNG.length } }]);
  const port = fakeViewPort({});
  await assert.rejects(viewClipboard(port).persistPNG(PNG), /binary upload answered no binary id/);
  assert.deepEqual(port.calls, []);
});

test("the view clipboard passes on an upload that the fetch refuses and sends no call", async (t) => {
  fakeFetch(t, [new Error("the fetch of the upload failed")]);
  const port = fakeViewPort({});
  await assert.rejects(viewClipboard(port).persistPNG(PNG), /the fetch of the upload failed/);
  assert.deepEqual(port.calls, []);
});

test("the view clipboard refuses a persistence answer of another form", async (t) => {
  fakeFetch(t, [{ status: 200, json: { id: ID, length: PNG.length } }]);
  const port = fakeViewPort({ "runtime.clipboard.persistPNG": () => ({ path: PERSISTED.path }) });
  await assert.rejects(viewClipboard(port).persistPNG(PNG), /clipboard PNG persistence response is invalid/);
});

test("the view clipboard refuses a persist of anything but bytes and uploads nothing", async (t) => {
  const requests = fakeFetch(t, []);
  await assert.rejects(viewClipboard(fakeViewPort({})).persistPNG("iVBORw=="), TypeError);
  assert.deepEqual(requests, []);
});
