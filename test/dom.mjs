// A jsdom document as the global document of a test.
import { JSDOM } from "jsdom";

/** Creates one window of url, without touching the globals of the test process. */
export function createWindow(url = "https://app.test/") {
  const dom = new JSDOM("", { url, pretendToBeVisual: true });
  return { window: dom.window };
}

/** Serves window as the global document of the test process. */
export function useWindow(window) {
  for (const name of ["window", "document", "navigator", "MutationObserver", "getComputedStyle", "requestAnimationFrame",
    "cancelAnimationFrame", "addEventListener", "removeEventListener", "Node", "HTMLElement", "Element", "Range",
    "KeyboardEvent", "InputEvent", "Event", "CustomEvent", "SubmitEvent", "FocusEvent", "MouseEvent", "Window"]) {
    Object.defineProperty(globalThis, name, { value: name === "window" ? window : window[name], configurable: true, writable: true });
  }
}
