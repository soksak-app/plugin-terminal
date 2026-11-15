// The fixture of @soksak/plugin-api/diagnostic-view-frames, which only a diagnostic build imports. It records the call of
// observeViewDocumentFrames; the answer is arranged by the test.
import { createRecorder } from "./record.mjs";

const frames = createRecorder("observeViewDocumentFrames");

/** Starts the observation of the frames of a view document; the answer is arranged by the test. */
export function observeViewDocumentFrames(...args) {
  return frames.answer("observeViewDocumentFrames", args);
}
observeViewDocumentFrames.arrange = (answer) => frames.arrange("observeViewDocumentFrames", answer);
observeViewDocumentFrames.calls = frames.calls;
observeViewDocumentFrames.reset = frames.reset;
