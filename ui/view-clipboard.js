// The clipboard of the terminal view page (core docs/spec/native-surfaces.md#view-surfaces, view calls), over the call route of
// the view. The route carries a PNG payload as base64: a PNG read answers {present, type, data} or null, and the page reads the
// payload as the bytes that the clipboard of a surface reads. runtime.clipboard.persistPNG takes {data} as base64 and answers
// the persisted path with its shell-quoted form. The module imports no SDK module, so the page and its tests share it.

/** Decodes the base64 of a PNG payload into bytes, and refuses a response of another form. */
function pngBytes(value) {
  if (value === null || typeof value !== "object" || value.present !== true || value.type !== "png" || typeof value.data !== "string") {
    throw new Error(`clipboard png response is invalid: ${JSON.stringify(value)}`);
  }
  const binary = atob(value.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Encodes PNG bytes as the base64 that the route carries. */
function base64Of(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** The clipboard entries of the surface context, which run through the calls of the view. */
export function viewClipboard(calls) {
  return {
    read: async (type) => {
      const value = await calls.request("runtime.clipboard.read", type);
      return type === "png" && value !== null ? pngBytes(value) : value;
    },
    writeText: (text) => calls.request("runtime.clipboard.writeText", text),
    persistPNG: async (bytes) => {
      if (!(bytes instanceof Uint8Array)) throw new TypeError("persistPNG requires the PNG bytes as a Uint8Array");
      const persisted = await calls.request("runtime.clipboard.persistPNG", { data: base64Of(bytes) });
      if (persisted === null || typeof persisted !== "object" || typeof persisted.path !== "string" || typeof persisted.shellQuotedPath !== "string") {
        throw new Error(`clipboard PNG persistence response is invalid: ${JSON.stringify(persisted)}`);
      }
      return { path: persisted.path, shellQuotedPath: persisted.shellQuotedPath };
    },
  };
}
