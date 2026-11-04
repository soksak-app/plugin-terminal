// The clipboard of the terminal view page (core docs/spec/native-surfaces.md#view-surfaces, view calls), over the call route of
// the view. A PNG travels through the binary path of the view document (core docs/spec/plugin-processes.md#binary-path): a PNG read
// answers {present, type, binary} or null, and the page downloads the bytes of that id, which are the bytes that the clipboard of
// a surface reads. runtime.clipboard.persistPNG takes {binary}, the id of an upload of the bytes, and answers the persisted path
// with its shell-quoted form. The module imports no SDK module, so the page and its tests share it.

/** The binary path of the document, relative to its origin soksak://<plugin>, which the host owns. */
const BINARY_PATH = "/.binary";
/** A binary id: 32 lowercase hexadecimal characters. */
const BINARY_ID = /^[0-9a-f]{32}$/;

/** Stores PNG bytes in the binary store of the document and returns their id. A refusal answers {error}. */
async function uploadPNG(bytes) {
  const response = await fetch(BINARY_PATH, { method: "POST", headers: { "Content-Type": "image/png" }, body: bytes });
  const answer = await response.json();
  if (!response.ok) throw new Error(`binary upload failed with ${response.status}: ${answer.error}`);
  if (!BINARY_ID.test(answer.id)) throw new Error(`binary upload answered no binary id: ${JSON.stringify(answer)}`);
  return answer.id;
}

/** Downloads the bytes of the binary id of a PNG read, which releases the id, and refuses a response of another form. */
async function downloadPNG(value) {
  if (value === null || typeof value !== "object" || value.present !== true || value.type !== "png" || !BINARY_ID.test(value.binary)) {
    throw new Error(`clipboard png response is invalid: ${JSON.stringify(value)}`);
  }
  const response = await fetch(`${BINARY_PATH}/${value.binary}`);
  if (!response.ok) throw new Error(`binary download of ${value.binary} failed with ${response.status}: ${(await response.json()).error}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The clipboard entries of the surface context, which run through the calls of the view. */
export function viewClipboard(calls) {
  return {
    read: async (type) => {
      const value = await calls.request("runtime.clipboard.read", type);
      return type === "png" && value !== null ? downloadPNG(value) : value;
    },
    writeText: (text) => calls.request("runtime.clipboard.writeText", text),
    persistPNG: async (bytes) => {
      if (!(bytes instanceof Uint8Array)) throw new TypeError("persistPNG requires the PNG bytes as a Uint8Array");
      const persisted = await calls.request("runtime.clipboard.persistPNG", { binary: await uploadPNG(bytes) });
      if (persisted === null || typeof persisted !== "object" || typeof persisted.path !== "string" || typeof persisted.shellQuotedPath !== "string") {
        throw new Error(`clipboard PNG persistence response is invalid: ${JSON.stringify(persisted)}`);
      }
      return { path: persisted.path, shellQuotedPath: persisted.shellQuotedPath };
    },
  };
}
