// The fixture of @soksak/plugin-api/screen-hash. The page passes each screen message to applyScreenMessage and each full screen to
// screenHash; the fixture records the calls and returns the answers that the test arranges.
import { createRecorder } from "./record.mjs";

const screen = createRecorder("screen-hash");

/** Hashes a full screen; the answer is arranged by the test. */
export function screenHash(...args) {
  return screen.answer("screenHash", args);
}

/** Applies a screen message to the held screen; the answer is arranged by the test. */
export function applyScreenMessage(...args) {
  return screen.answer("applyScreenMessage", args);
}

screenHash.arrange = (answer) => screen.arrange("screenHash", answer);
applyScreenMessage.arrange = (answer) => screen.arrange("applyScreenMessage", answer);
screenHash.calls = screen.calls;
applyScreenMessage.calls = screen.calls;
screenHash.reset = screen.reset;
applyScreenMessage.reset = screen.reset;
