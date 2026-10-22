// The clipboard of the terminal view page (core docs/spec/native-surfaces.md#view-surfaces, view calls), over the call route of
// the view. It imports no SDK module, so the page and its tests share it.

/** The clipboard entries of the surface context, which run through the calls of the view. */
export function viewClipboard(calls) {
  return {
    read: (type) => calls.request("runtime.clipboard.read", type),
    writeText: (text) => calls.request("runtime.clipboard.writeText", text),
  };
}
