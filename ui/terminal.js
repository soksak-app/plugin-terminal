import { shellQuotePath } from "@soksak/plugin-api";
import { screenFromMessage, screenHash } from "@soksak/plugin-api/screen-hash";

// 터미널 표면의 부팅과 동작을 처리한다.
//
// startTerminal 함수는 인자로 받은 의존성을 사용하므로 브라우저와 Node 환경에서 모두 부를 수 있다.

function fileURLPath(value) {
  if (typeof value !== "string") throw new Error("clipboard file URL is not a string");
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`clipboard file URL is invalid: ${error.message}`);
  }
  if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) {
    throw new Error(`clipboard file URL is not local: ${value}`);
  }
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch (error) {
    throw new Error(`clipboard file URL path is invalid: ${error.message}`);
  }
  if (!path.startsWith("/") || path.length === 1) throw new Error("clipboard file URL path is empty");
  return path;
}

/**
 * The correlation identifiers of the input that a region event reports (core docs/spec/logging.md#correlation-identifier):
 * none for an event without `cids`, and an error for a value that is no list of identifiers.
 */
function cidsOf(event) {
  if (event.cids === undefined) return [];
  if (!Array.isArray(event.cids) || event.cids.some((cid) => typeof cid !== "string" || cid === "")) {
    throw new Error(`region event cids must be a list of identifiers, got ${JSON.stringify(event.cids)}`);
  }
  return event.cids;
}

const CURSOR_SHAPES = new Set(["block", "underline", "beam"]);
const CURSOR_BLINK_MODES = new Set(["Never", "Off", "On", "Always"]);
const CURSOR_UNFOCUSED = new Set(["hollow", "solid", "underline", "beam", "unchanged"]);
const PROGRAM_CLIPBOARD_POLICIES = new Set(["deny", "allow"]);
const NOTIFICATION_POLICIES = new Set(["tab", "system"]);
const DEFAULT_CURSOR = Object.freeze({
  row: 0, col: 0, shape: "block", visible: true, blinking: false, focused: false,
  blink: "Off", interval: 750, idleTimeout: 5000, unfocused: "hollow", hollow: false,
  blinkVisible: true, drawn: Object.freeze({ shape: "block", blinking: false }), frame: null, render: null, caret: null, preedit: null,
});

// terminal.session.rejected 에 남기는 거부한 시퀀스의 수.
const REJECTED_KEPT = 8;

// 사이드카가 화면에 그린 커서 모양. 프로그램의 요청과 초점 규칙이 적용된 값이다.
const DRAWN_SHAPES = { Block: "block", Underline: "underline", Beam: "beam", HollowBlock: "hollowBlock", Hidden: "hidden" };
const DRAWN_SHAPE_KEYS = new Set([...Object.keys(DRAWN_SHAPES), ...Object.values(DRAWN_SHAPES)]);

// The frame of a screen event (docs/spec/terminal-runtime.md in core): null for a surface without an image, or an object of
// exactly the non-negative integers generation, raster and sequence, which names the frame that shows the screen.
const SCREEN_FRAME_KEYS = ["generation", "raster", "sequence"];
function isScreenFrame(frame) {
  if (frame === null) return true;
  if (typeof frame !== "object" || Array.isArray(frame) || Object.keys(frame).length !== SCREEN_FRAME_KEYS.length) return false;
  return SCREEN_FRAME_KEYS.every((key) => Number.isInteger(frame[key]) && frame[key] >= 0);
}

function screenCaretError(cursor, rows, cols, frame) {
  if (!Object.hasOwn(cursor, "caret")) return "cursor.caret is required";
  const caret = cursor.caret;
  if (caret === null) return null;
  if (!caret || typeof caret !== "object" || Array.isArray(caret) || Object.keys(caret).length !== 2 ||
      !Object.hasOwn(caret, "row") || !Object.hasOwn(caret, "col") ||
      !Number.isInteger(caret.row) || caret.row < 0 || !Number.isInteger(caret.col) || caret.col < 0) {
    return "cursor.caret must be null or contain nonnegative integer row and col";
  }
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(cols) || cols < 1 || caret.row >= rows || caret.col >= cols) {
    return `cursor.caret is outside the screen grid ${cols}x${rows}`;
  }
  if (frame === null) return "cursor.caret must be null when screen frame is null";
  return null;
}

function normalizeRange(range) {
  if (range === null || range === undefined) return null;
  if (!range || typeof range !== "object" || Array.isArray(range) ||
      !Number.isInteger(range.location) || !Number.isInteger(range.length) ||
      range.location < 0 || range.length < 0) {
    throw new Error("IME range must contain nonnegative integer location and length");
  }
  return { location: range.location, length: range.length };
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function markedRangeError(range, text) {
  if (range === undefined) return "IME markedRange is required";
  if (range === null) return null;
  if (!range || typeof range !== "object" || Array.isArray(range) || Object.keys(range).length !== 2 ||
      !Object.hasOwn(range, "location") || !Object.hasOwn(range, "length") ||
      !Number.isSafeInteger(range.location) || !Number.isSafeInteger(range.length) ||
      range.location < 0 || range.length < 0) {
    return "IME markedRange must contain nonnegative integer location and length";
  }
  const end = range.location + range.length;
  if (!Number.isSafeInteger(end) || end > text.length) {
    return "IME markedRange must fit text in UTF-16 units";
  }
  const boundaries = new Set([0, text.length]);
  for (const { index } of graphemeSegmenter.segment(text)) boundaries.add(index);
  if (!boundaries.has(range.location) || !boundaries.has(end)) {
    return "IME markedRange must align with grapheme boundaries";
  }
  return null;
}

function normalizeMarkedRange(range, text) {
  const error = markedRangeError(range, text);
  if (error !== null) throw new Error(error);
  if (range === null) return null;
  return { location: range.location, length: range.length };
}

// The preedit that the service drew in the cursor of a screen event (docs/spec/terminal-runtime.md in core): the composition
// text, its ranges and the attributed flag, the shape of the compose state. The service omits the key when it draws no preedit.
function preeditError(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "must be an object or null";
  const isRange = (range) => range === null || range === undefined || (typeof range === "object" && !Array.isArray(range) &&
    Number.isInteger(range.location) && Number.isInteger(range.length) && range.location >= 0 && range.length >= 0);
  if (typeof value.text !== "string") return "text must be a string";
  if (typeof value.attributed !== "boolean") return "attributed must be a boolean";
  if (!isRange(value.selectedRange)) return "selectedRange is invalid";
  if (!isRange(value.replacementRange)) return "replacementRange is invalid";
  return markedRangeError(value.markedRange, value.text);
}

function isPreedit(value) {
  return preeditError(value) === null;
}

function normalizePreedit(value) {
  if (value === null || value === undefined) return null;
  const error = preeditError(value);
  if (error !== null) throw new Error(`cursor.preedit is invalid: ${error}`);
  return {
    text: value.text, selectedRange: normalizeRange(value.selectedRange),
    replacementRange: normalizeRange(value.replacementRange), markedRange: normalizeMarkedRange(value.markedRange, value.text),
    attributed: value.attributed,
  };
}

// Renderer metadata belongs to one screen frame. Null means that the producer
// has no draw metadata for that frame; an incomplete object is a protocol error.
function normalizeScreenRender(value, frame) {
  if (value === null) return null;
  const object = (item, name) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`render.${name} must be an object`);
    return item;
  };
  const integer = (item, name, positive = false) => {
    if (!Number.isInteger(item) || item < (positive ? 1 : 0)) throw new Error(`render.${name} must be ${positive ? "a positive" : "a non-negative"} integer`);
  };
  const finite = (item, name, positive = false, signed = false) => {
    if (typeof item !== "number" || !Number.isFinite(item) || (positive ? item <= 0 : !signed && item < 0)) {
      throw new Error(`render.${name} must be a ${positive ? "positive" : signed ? "signed" : "non-negative"} finite number`);
    }
  };
  const string = (item, name) => {
    if (typeof item !== "string" || item.length === 0) throw new Error(`render.${name} must be a non-empty string`);
  };
  const color = (item, name) => {
    if (typeof item !== "string" || !/^#[0-9a-f]{6}$/.test(item)) throw new Error(`render.${name} must be an opaque lowercase sRGB color`);
  };
  const rect = (item, name) => {
    if (item === null) return;
    object(item, name);
    for (const key of ["x", "y", "width", "height"]) {
      finite(item[key], `${name}.${key}`, key === "width" || key === "height", key === "x" || key === "y");
    }
    return item;
  };
  const result = object(value, "metadata");
  if (!isScreenFrame(result.frame) || !frame || result.frame.generation !== frame.generation ||
      result.frame.raster !== frame.raster || result.frame.sequence !== frame.sequence) {
    throw new Error("render.frame must match screen frame");
  }
  const pixel = object(result.pixel, "pixel");
  for (const key of ["width", "height"]) integer(pixel[key], `pixel.${key}`, true);
  integer(pixel.bytesPerRow, "pixel.bytesPerRow", true);
  if (pixel.bytesPerRow < pixel.width * 4) throw new Error("render.pixel.bytesPerRow is smaller than its BGRA8 row");
  if (pixel.format !== "bgra8" || pixel.alpha !== "premultiplied" || pixel.colorSpace !== "sRGB" || pixel.origin !== "top-left") {
    throw new Error("render.pixel format is invalid");
  }
  const grid = object(result.grid, "grid");
  for (const key of ["rows", "cols", "cellWidth", "cellHeight"]) integer(grid[key], `grid.${key}`, true);
  const origin = object(grid.origin, "grid.origin");
  integer(origin.x, "grid.origin.x"); integer(origin.y, "grid.origin.y");
  if (grid.cols * grid.cellWidth > pixel.width || grid.rows * grid.cellHeight > pixel.height ||
      origin.x + grid.cols * grid.cellWidth > pixel.width || origin.y + grid.rows * grid.cellHeight > pixel.height) {
    throw new Error("render.grid exceeds pixel dimensions");
  }
  const font = object(result.font, "font");
  string(font.family, "font.family");
  for (const key of ["size", "ascent", "descent", "leading", "baselineFromCellTop"]) finite(font[key], `font.${key}`);
  finite(font.size, "font.size", true);
  const underline = object(result.underline, "underline");
  finite(underline.positionFromBaseline, "underline.positionFromBaseline", false, true);
  finite(underline.thickness, "underline.thickness", true);
  if (underline.positionCoordinate !== "CoreText y-up" || underline.minimumThickness !== 1 || underline.colorSource !== "glyph.foreground") {
    throw new Error("render.underline policy is invalid");
  }
  const cursor = object(result.cursor, "cursor");
  if (!["block", "underline", "beam", "hollowBlock", "hidden"].includes(cursor.shape)) throw new Error("render.cursor.shape is invalid");
  for (const key of ["visible", "blinkVisible", "focused"]) if (typeof cursor[key] !== "boolean") throw new Error(`render.cursor.${key} must be a boolean`);
  if (!["normal", "difference"].includes(cursor.blend)) throw new Error("render.cursor.blend is invalid");
  rect(cursor.rect, "cursor.rect");
  if (cursor.rect && (cursor.rect.x < 0 || cursor.rect.y < 0 ||
      cursor.rect.x + cursor.rect.width > pixel.width || cursor.rect.y + cursor.rect.height > pixel.height)) {
    throw new Error("render.cursor.rect must be inside the pixel raster");
  }
  finite(cursor.border, "cursor.border");
  if (cursor.color !== null) color(cursor.color, "cursor.color");
  const cursorDrawn = cursor.visible && cursor.blinkVisible && cursor.shape !== "hidden";
  if (cursorDrawn !== (cursor.rect !== null)) {
    throw new Error("render.cursor.rect must match whether the cursor is drawn");
  }
  if ((!cursorDrawn || cursor.blend === "difference") && cursor.color !== null) {
    throw new Error("render.cursor.color must be null for a non-color cursor");
  }
  if (cursorDrawn && cursor.blend === "normal" && cursor.color === null) {
    throw new Error("render.cursor.color is required for a visible normal cursor");
  }
  if (!Array.isArray(result.glyphs)) throw new Error("render.glyphs must be an array");
  result.glyphs.forEach((glyph, index) => {
    object(glyph, `glyphs[${index}]`);
    for (const key of ["row", "col"]) integer(glyph[key], `glyphs[${index}].${key}`);
    for (const key of ["width", "fontRuns"]) integer(glyph[key], `glyphs[${index}].${key}`, true);
    if (glyph.row >= grid.rows || glyph.col + glyph.width > grid.cols) throw new Error(`render.glyphs[${index}] is outside the grid`);
    string(glyph.grapheme, `glyphs[${index}].grapheme`);
    color(glyph.foreground, `glyphs[${index}].foreground`);
    color(glyph.background, `glyphs[${index}].background`);
    rect(glyph.bounds, `glyphs[${index}].bounds`);
    rect(object(glyph.underline, `glyphs[${index}].underline`).rect, `glyphs[${index}].underline.rect`);
  });
  return result;
}

// 커서 상태를 검사한다. 값은 이전 상태에 사이드카가 알린 필드를 덮은 전체 상태이므로 모든 필드가 있어야 한다.
function normalizeCursor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cursor must be an object");
  }
  const cursor = value;
  const shapes = { block: "block", Block: "block", underline: "underline", Underline: "underline", beam: "beam", Beam: "beam", HollowBlock: "block", Hidden: "block" };
  if (typeof cursor.shape !== "string" || !Object.hasOwn(shapes, cursor.shape)) {
    throw new Error(`cursor.shape is invalid: ${String(cursor.shape)}`);
  }
  if (!CURSOR_BLINK_MODES.has(cursor.blink)) throw new Error(`cursor.blink is invalid: ${String(cursor.blink)}`);
  const integer = (field) => {
    if (!Number.isInteger(cursor[field]) || cursor[field] < 0) throw new Error(`cursor.${field} is invalid`);
    return cursor[field];
  };
  const number = (field) => {
    if (typeof cursor[field] !== "number" || !Number.isFinite(cursor[field]) || cursor[field] < 0) {
      throw new Error(`cursor.${field} is invalid`);
    }
    return cursor[field];
  };
  const boolean = (field) => {
    if (typeof cursor[field] !== "boolean") throw new Error(`cursor.${field} is invalid`);
    return cursor[field];
  };
  if (!CURSOR_UNFOCUSED.has(cursor.unfocused)) throw new Error(`cursor.unfocused is invalid: ${String(cursor.unfocused)}`);
  if (!cursor.drawn || typeof cursor.drawn !== "object") throw new Error("cursor.drawn is invalid");
  if (!isScreenFrame(cursor.frame)) throw new Error(`cursor.frame is invalid: ${JSON.stringify(cursor.frame)}`);
  if (!Object.hasOwn(cursor, "render")) throw new Error("cursor.render is required");
  if (!Object.hasOwn(cursor, "caret")) throw new Error("cursor.caret is required");
  if (cursor.caret !== null && (!cursor.caret || typeof cursor.caret !== "object" || Array.isArray(cursor.caret) ||
      Object.keys(cursor.caret).length !== 2 || !Number.isInteger(cursor.caret.row) || cursor.caret.row < 0 ||
      !Number.isInteger(cursor.caret.col) || cursor.caret.col < 0)) {
    throw new Error("cursor.caret is invalid");
  }
  return {
    row: integer("row"),
    col: integer("col"),
    shape: shapes[cursor.shape],
    visible: boolean("visible"),
    blinking: boolean("blinking"),
    focused: boolean("focused"),
    blink: cursor.blink,
    interval: number("interval"),
    idleTimeout: number("idleTimeout"),
    unfocused: cursor.unfocused,
    hollow: boolean("hollow"),
    blinkVisible: boolean("blinkVisible"),
    drawn: cursor.drawn,
    frame: cursor.frame,
    render: normalizeScreenRender(cursor.render, cursor.frame),
    caret: cursor.caret === null ? null : { row: cursor.caret.row, col: cursor.caret.col },
    preedit: normalizePreedit(cursor.preedit),
  };
}

// 커서 정책을 검사한다. 설정과 사이드카의 cursor 답은 다섯 필드를 모두 담는다.
function normalizeCursorPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("cursor policy must be an object");
  const { shape, blink, unfocused } = value;
  if (!CURSOR_SHAPES.has(shape)) throw new Error(`cursor policy shape is invalid: ${String(shape)}`);
  if (!CURSOR_BLINK_MODES.has(blink)) throw new Error(`cursor policy blink is invalid: ${String(blink)}`);
  if (!CURSOR_UNFOCUSED.has(unfocused)) throw new Error(`cursor policy unfocused is invalid: ${String(unfocused)}`);
  const integer = (name, minimum) => {
    if (!Number.isInteger(value[name]) || value[name] < minimum) throw new Error(`cursor policy ${name} is invalid`);
    return value[name];
  };
  return {
    shape,
    blink,
    interval: integer("interval", 1),
    idleTimeout: integer("idleTimeout", 0),
    unfocused,
  };
}


/**
 * 터미널 표면을 초기화하고 사이드카와 연결한다.
 *
 * @param {Object} options - 의존성 객체
 * @param {Element} options.view - 터미널 표시 영역
 * @param {Function} options.attachImage - 이미지 영역 붙이기 함수
 * @param {Object} options.sidecar - 사이드카 포트
 * @param {Object} options.expose - 공개 항목 등록 함수 모음
 * @param {Object} options.window - window 객체 (글로벌 window 가 기본값이다)
 * @returns {Promise<void>}
 */
// 첫 칸의 bold 속성을 뒤집은 screen 메시지. 진단 command terminal.screen.alter 가 사이드카와 페이지 사이의 변경을 흉내 낸다.
// 속성은 어느 칸에서나 유효하므로 바뀐 메시지도 검사를 통과하고 다른 화면으로 hash 된다. 칸이 없는 메시지는 그대로다.
function alteredScreen(body) {
  if (!Array.isArray(body.cells) || body.cells.length === 0 || !Number.isInteger(body.cells[0]?.attributes)) return body;
  const [first, ...rest] = body.cells;
  return { ...body, cells: [{ ...first, attributes: first.attributes ^ 0x01 }, ...rest] };
}

// screen 메시지의 attributes byte 의 flag 와 그 이름(core docs/spec/replay.md#screen-hash).
const ATTRIBUTE_FLAGS = [[0x01, "bold"], [0x02, "dim"], [0x04, "italic"], [0x08, "underline"], [0x10, "blink"], [0x20, "inverse"],
  [0x40, "hidden"], [0x80, "strikethrough"]];

export async function startTerminal({ id, view, attachImage, detachRegions, sidecar, expose, theme,
  // Aborts when the removal of the surface starts, before its regions are detached (context.closing). Required.
  closing,
  // padding 은 변마다 view 둘레를 칠하는 overlay 요소 {top, right, bottom, left} 다. 없으면 칠하지 않는다.
  padding: paddingStrips = null,
  settings, clipboard, scrollbar = null, reportSurfaceError, diagnostics = null,
  // 탭 알림(docs/spec/plugins.md#tab-reports)과 이 탭을 만든 카드의 작업 디렉터리. Required; origin is {directory} with a path or null.
  tab, origin,
  // 표면 창의 프로젝트. 없으면 null 이다.
  project = null,
  // 링크 열기(docs/spec/plugins.md#opening-links).
  links = null,
  // 이 표면의 실제 글자 배율(docs/spec/text-size.md). Required.
  textSize,
  // The runtime of the surface, of which the terminal uses the event log (context.runtime.log, core
  // docs/spec/plugins.md#logging). Required.
  runtime,
  window: globalWindow = globalThis.window }) {
  // 브라우저 환경에서 필요한 객체들
  const window = globalWindow;

  if (!id) {
    throw new Error("startTerminal requires explicit surface id");
  }
  // Each sink of the surface is required: a missing sink is refused by name, and no default stands in for it.
  if (typeof reportSurfaceError !== "function") throw new TypeError("startTerminal requires reportSurfaceError");
  if (tab === null || typeof tab !== "object") throw new TypeError("startTerminal requires tab");
  if (textSize === null || typeof textSize !== "object" || typeof textSize.read !== "function" || typeof textSize.on !== "function") {
    throw new TypeError("startTerminal requires textSize {read, on}");
  }
  if (runtime === null || typeof runtime !== "object" || runtime.log === null || typeof runtime.log !== "object") {
    throw new TypeError("startTerminal requires runtime.log");
  }
  if (closing === null || typeof closing !== "object" || typeof closing.aborted !== "boolean") throw new TypeError("startTerminal requires closing, an AbortSignal");
  // The origin is {directory} whose directory is a path or null (core docs/spec/native-surfaces.md, start values); null is refused.
  if (origin === null || typeof origin !== "object" || !("directory" in origin) ||
      (origin.directory !== null && (typeof origin.directory !== "string" || origin.directory === ""))) {
    throw new TypeError(`startTerminal requires origin {directory} with a path or null, found ${JSON.stringify(origin)}`);
  }
  // 공개 status 마다 값이 바뀔 때 호출할 함수
  const watchers = { session: new Set(), screen: new Set(), compose: new Set(), cursor: new Set() };
  const changed = (name) => {
    for (const fn of watchers[name]) fn(read[name]());
  };
  const watch = (name) => (fn) => {
    watchers[name].add(fn);
    return () => watchers[name].delete(fn);
  };

  // 확인 응답만 있고 따로 처리할 결과가 없는 사이드카 연산.
  const ACKNOWLEDGED = new Set(["selection.start", "selection.update", "paste"]);
  // 현재 세션 상태
  let session = {
    sessionId: "", cols: 80, rows: 24, cellWidth: 8, cellHeight: 16, unsupported: [],
    inlineImages: [],
    // 사이드카가 답한 선택 해제의 수. 해제의 결과(복사 또는 빈 선택)가 도착했음을 알린다.
    selectionReleases: 0,
    mouse: { inputId: null, phase: null, x: null, y: null, pressed: false, shift: false, alt: false, ctrl: false,
      reported: false, written: false, modes: { click: false, drag: false, motion: false }, bytes: null, error: null },
    // 왼쪽 버튼을 누른 선택 제스처가 진행 중인지.
    selecting: false,
    // 뷰포트가 가장 새 출력보다 위에 있는 줄 수와 보관된 기록 줄 수.
    scrollback: { offset: 0, history: 0 },
    // 포인터 아래 칸의 OSC 8 링크 URI. 없으면 null.
    link: null,
    // OSC 22 로 프로그램이 정한 포인터 모양(CSS cursor 값). 링크 칸 위에서는 손 모양이 우선한다.
    pointer: "default",
    // 엔진이 거부한 프로그램 출력 시퀀스의 최근 이유. 프로그램의 출력이므로 터미널 오류가 아니다.
    rejected: [],
    // The sequence.rejected reasons that the rejected list dropped; the list keeps the last REJECTED_KEPT reasons.
    rejectedShed: 0,
    vendor: { directory: null, hyperlink: null, notification: null, shell: null },
    compose: { text: "", markedRange: null, selectedRange: null, replacementRange: null, attributed: false },
    theme: "dark",
  };
  let screen = [];
  // The frame of the latest screen event, which terminal.screen.read returns with the rows.
  let screenFrame = null;
  let compose = session.compose;
  // 네이티브 입력 callback 과 터미널 입력 작업을 받는 함수. 진단 빌드의 진단 모듈만 등록한다.
  const inputObservers = new Set();
  const screenObservers = new Set();
  // 진단 command terminal.screen.alter 가 다음 screen 메시지를 바꾸도록 요청했는지.
  let alterNextScreen = false;
  const pointerObservers = new Set();
  const notifyPointer = (entry) => {
    if (pointerObservers.size === 0) return;
    for (const fn of pointerObservers) fn({ time: performance.now(), ...entry });
  };
  const notifyInput = (entry) => {
    for (const fn of inputObservers) fn(entry);
  };
  const screenSnapshot = () => screenFrame === null ? null : JSON.parse(JSON.stringify({
    frame: screenFrame,
    rows: screen,
    cols: session.cols,
    cursor,
    render: cursor.render,
  }));
  const notifyScreen = (snapshot) => {
    for (const fn of screenObservers) fn(snapshot);
  };
  // The trace records each report-bearing input scope as one ordered transaction, including its final preedit and errors.
  const traceNative = (kind, event) => {
    runtime.log.debug("ime", () => ({ kind, ...event }));
  };
  let cursor = { ...DEFAULT_CURSOR };
  if (!settings || typeof settings.read !== "function") throw new Error("terminal settings reader is required");
  const initialSettings = settings.read();
  let programClipboardPolicy = initialSettings["clipboard.program"];
  if (!PROGRAM_CLIPBOARD_POLICIES.has(programClipboardPolicy)) {
    throw new Error(`clipboard.program setting is invalid: ${String(programClipboardPolicy)}`);
  }
  let notificationPolicy = initialSettings.notifications;
  if (!NOTIFICATION_POLICIES.has(notificationPolicy)) {
    throw new Error(`notifications setting is invalid: ${String(notificationPolicy)}`);
  }
  settings.on((next) => {
    if (!NOTIFICATION_POLICIES.has(next.notifications)) {
      throw new Error(`notifications setting is invalid: ${String(next.notifications)}`);
    }
    notificationPolicy = next.notifications;
  });

  const read = {
    // 세션 상태
    session: () => session,
    screen: () => screen,
    compose: () => compose,
    cursor: () => cursor,
  };

  // 터미널 사이드카가 이 표면의 VT 세션을 실행한다. 보내는 모든 메시지는 본문 전체와 결과를, 받는 모든 이벤트는 본문 전체를
  // trace 로 남긴다(docs/spec/diagnostics.md).
  const terminal = {
    async send(surface, body, cids = []) {
      runtime.log.debug("send", () => ({ body }), { cids });
      const started = performance.now();
      const micros = () => Math.round((performance.now() - started) * 1000);
      try {
        const result = await sidecar.send(surface, body, cids);
        runtime.log.debug("send.result", () => ({ operation: body?.operation ?? null, ok: true, micros: micros() }));
        return result;
      } catch (error) {
        const code = typeof error?.code === "number" ? error.code : -32603;
        runtime.log.warn("send.result", () => ({ operation: body?.operation ?? null, ok: false, micros: micros(),
          error: `${code}: ${error?.message ?? String(error)}` }));
        throw error;
      }
    },
    on(surface, handler) {
      return sidecar.on(surface, (body) => {
        runtime.log.trace("sidecar.event", () => ({ body }));
        return handler(body);
      });
    },
  };

  // 이미지 영역 생성 및 사이드카 메시지 핸들링
  let region = null;
  region = attachImage(view, "view");
  if (!region) throw new Error("Failed to attach image region");
  // detachRegions 는 이 표면의 영역을 뗀다. 반복 호출은 같은 해제를 기다린다.
  if (typeof detachRegions !== "function") throw new TypeError("startTerminal requires detachRegions()");
  // Every event of the image region is recorded with its type and its whole body before its handler runs.
  const onRegion = (type, handler) => region.on(type, (event) => {
    runtime.log.trace("region", () => ({ type, ...event }));
    return handler(event);
  });

  const normalizeCompose = (event, strict = false) => {
    if (strict && (!event || typeof event !== "object" || Array.isArray(event))) {
      throw new Error("native input preedit must be an object");
    }
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.text !== "string") {
      throw new Error("terminal.compose.update requires a text string");
    }
    if (strict && ["text", "markedRange", "selectedRange", "replacementRange", "attributed"].some((key) => !Object.hasOwn(event, key))) {
      throw new Error("native input preedit requires text, markedRange, selectedRange, replacementRange and attributed");
    }
    if (strict && ["selectedRange", "replacementRange"].some((key) => event[key] === undefined)) {
      throw new Error("native input preedit ranges must be explicit objects or null");
    }
    if (event.attributed !== undefined && typeof event.attributed !== "boolean") {
      throw new Error("IME attributed must be a boolean");
    }
    return {
      text: event.text,
      markedRange: normalizeMarkedRange(event.markedRange, event.text),
      selectedRange: normalizeRange(event.selectedRange),
      replacementRange: normalizeRange(event.replacementRange),
      attributed: event.attributed === true,
    };
  };
  const applyCompose = (nextCompose) => {
    compose = nextCompose;
    session = { ...session, compose: nextCompose };
    changed("session");
    changed("compose");
  };
  const updateCompose = async (event) => {
    const cids = cidsOf(event);
    const nextCompose = normalizeCompose(event);
    applyCompose(nextCompose);
    await enqueueInput({ type: "input", actions: [], preedit: nextCompose }, cids);
    return null;
  };
  const exactKeys = (value, keys, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new Error(`${label} must contain exactly ${expected.join(", ")}`);
    }
  };
  const normalizeNativeAction = (action, index) => {
    if (!action || typeof action !== "object" || Array.isArray(action) || typeof action.type !== "string") {
      throw new Error(`native input action ${index} must be an object with a type`);
    }
    if (action.type === "insert") {
      exactKeys(action, ["type", "text", "replacementRange", "attributed"], `native input action ${index}`);
      if (typeof action.text !== "string") throw new Error(`native input action ${index} text must be a string`);
      if (action.replacementRange === undefined) throw new Error(`native input action ${index} replacementRange must be explicit`);
      if (typeof action.attributed !== "boolean") throw new Error(`native input action ${index} attributed must be a boolean`);
      if (action.replacementRange !== null) exactKeys(action.replacementRange, ["location", "length"], `native input action ${index} replacementRange`);
      return { type: "insert", text: action.text, replacementRange: normalizeRange(action.replacementRange), attributed: action.attributed };
    }
    if (action.type === "key") {
      if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error(`native input action ${index} must be an object`);
      const fields = Object.hasOwn(action, "text")
        ? ["type", "key", "text", "shift", "alt", "ctrl"]
        : ["type", "key", "shift", "alt", "ctrl"];
      exactKeys(action, fields, `native input action ${index}`);
      if (typeof action.key !== "string" || action.key.length === 0 ||
          (Object.hasOwn(action, "text") && typeof action.text !== "string") ||
          (action.key === "Char" && typeof action.text !== "string") ||
          (action.key !== "Char" && Object.hasOwn(action, "text"))) {
        throw new Error(`native input action ${index} requires a key and character text when key is Char`);
      }
      if (![action.shift, action.alt, action.ctrl].every((value) => typeof value === "boolean")) {
        throw new Error(`native input action ${index} modifiers must be booleans`);
      }
      return {
        type: "key", key: action.key,
        ...(Object.hasOwn(action, "text") ? { text: action.text } : {}),
        shift: action.shift, alt: action.alt, ctrl: action.ctrl,
      };
    }
    if (action.type === "command") {
      exactKeys(action, ["type", "selector"], `native input action ${index}`);
      if (typeof action.selector !== "string" || action.selector.length === 0) {
        throw new Error(`native input action ${index} selector must be a non-empty string`);
      }
      return { type: "command", selector: action.selector };
    }
    if (action.type === "focus") {
      exactKeys(action, ["type", "focused"], `native input action ${index}`);
      if (typeof action.focused !== "boolean") throw new Error(`native input action ${index} focused must be a boolean`);
      return { type: "focus", focused: action.focused };
    }
    throw new Error(`native input action ${index} has unknown type ${action.type}`);
  };
  const normalizeNativeInput = (event) => {
    exactKeys(event, ["type", "actions", "preedit", "errors", "cids"], "native input event");
    if (event.type !== "input") throw new Error(`native input event type must be input, got ${String(event.type)}`);
    if (!Array.isArray(event.actions)) throw new Error("native input actions must be an array");
    if (!Array.isArray(event.errors)) throw new Error("native input errors must be an array");
    const cids = cidsOf(event);
    if (cids.length !== 1) throw new Error(`native input requires exactly one scope correlation identifier, got ${cids.length}`);
    const actions = event.actions.map(normalizeNativeAction);
    const errors = event.errors.map((item, index) => {
      exactKeys(item, ["reason"], `native input error ${index}`);
      if (typeof item.reason !== "string" || item.reason.length === 0) throw new Error(`native input error ${index} reason must be a non-empty string`);
      return { reason: item.reason };
    });
    exactKeys(event.preedit, ["text", "markedRange", "selectedRange", "replacementRange", "attributed"], "native input preedit");
    for (const range of [event.preedit.markedRange, event.preedit.selectedRange, event.preedit.replacementRange]) {
      if (range !== null) exactKeys(range, ["location", "length"], "native input preedit range");
    }
    const preedit = normalizeCompose(event.preedit, true);
    return { actions, preedit, errors, cids };
  };

  // 세션이 생겼는지 추적한다. 래스터 크기는 페이지가 아니라 호스트 configure가 정한다.
  let sessionOpen = false;
  let nativeFocused = false;
  const focusWaiters = new Set();

  let inputChain = Promise.resolve();
  const inputQueue = [];
  const MAX_QUEUE_SIZE = 1024;

  // 세션 오류. 출처마다 마지막 메시지를 두며 session.error 는 가장 최근에 남은 오류다. 스냅샷
  // 출처(state, session, theme, screen, trace)의 오류는 같은 종류의 다음 유효한 이벤트가 해소하고,
  // 다른 출처의 오류는 표면이 닫힐 때까지 남는다. 관련 없는 이벤트는 오류를 지우지 않는다.
  const errors = new Map();
  const setError = (source, message) => {
    console.error(message);
    runtime.log.error("error", { source, message });
    errors.delete(source);
    errors.set(source, message);
    session = { ...session, error: message };
    changed("session");
  };
  // 반환값은 session 을 바꿨는지다. 호출자가 changed("session") 을 알린다.
  const resolveError = (source) => {
    if (!errors.delete(source)) return false;
    session = { ...session, error: [...errors.values()].at(-1) };
    return true;
  };
  const reportInputError = (error, source = "input") => {
    const message = error instanceof Error ? error.message : String(error);
    setError(source, `terminal input failed: ${message}`);
  };
  // 프로그램이 정한 마지막 제목(OSC 0/2). 설정 title 이 program 이면 탭에 보이고, name 이면 지운다.
  // 탭이 거부한 제목은 세션 오류이며 다음에 받아들여진 제목이 그 오류를 해소한다.
  let programTitle = null;
  const applyTitle = () => {
    const shown = settings.read().title === "program" ? programTitle : null;
    try {
      tab.title(shown);
      if (resolveError("title")) changed("session");
    } catch (error) {
      setError("title", `terminal title failed: ${error.message}`);
      reportSurfaceError(error);
    }
  };

  // 터미널은 카드의 색을 쓴다. 배경은 --card, 글자와 커서는 --fg, 선택 배경은 강조 레일 --rail 이다
  // (docs/spec/terminal-runtime.md). 색의 검사는 사이드카가 한다.
  const setTheme = async (mode, tokens = {}) => {
    if (mode !== "dark" && mode !== "light") throw new Error(`terminal theme mode is invalid: ${String(mode)}`);
    await terminal.send(id, { operation: "theme", mode, background: tokens["--card"],
      foreground: tokens["--fg"], cursor: tokens["--fg"], selection: tokens["--rail"] });
  };
  // terminal.cursor 는 사이드카가 정책을 적용하고 다시 그린 뒤 보내는 cursor 응답으로 바뀐다.
  const setCursorPolicy = async (value) => {
    const policy = normalizeCursorPolicy(value);
    await terminal.send(id, { operation: "cursor", ...policy });
    return policy;
  };
  // 터미널 글꼴 family 우선순위 목록(`;` 로 구분)을 사이드카에 보낸다. 사이드카는 설치된 첫 family 를
  // 적용하고 font 확인 이벤트로 그 family 를 알린다.
  // 글꼴 크기는 13포인트에 이 표면의 글자 배율을 곱한 값이다. family 나 크기가 바뀌면 둘을 함께 보낸다.
  const BASE_FONT_SIZE = 13;
  let fontFamily = null;
  let textFactor = textSize.read();
  let requested = null;
  // 마지막으로 적용한 테마. 연결이 다시 맺히면 그 값으로 다시 보낸다(V5-106).
  let lastTheme = null;
  const sendFont = async () => {
    if (fontFamily === null) return;
    const size = BASE_FONT_SIZE * textFactor;
    if (requested?.family === fontFamily && requested?.size === size) return;
    requested = { family: fontFamily, size };
    await terminal.send(id, { operation: "font", family: fontFamily, size });
  };
  const setFont = async (family) => {
    if (typeof family !== "string" || family.length === 0) throw new Error("font.family setting is invalid");
    fontFamily = family;
    await sendFont();
  };
  const setTextSize = async (factor) => {
    if (!Number.isFinite(factor) || factor <= 0) throw new Error(`text size factor is invalid: ${String(factor)}`);
    textFactor = factor;
    await sendFont();
  };
  const sendPaste = async (text) => {
    if (typeof text !== "string" || text.length === 0) throw new Error("terminal paste text is empty");
    await enqueueInput({ type: "input", actions: [{ type: "insert", text, replacementRange: null, attributed: false }], preedit: compose });
    return null;
  };
  const dropFileURLs = (value) => {
    if (!Array.isArray(value) || value.length === 0) throw new Error("terminal file drop has no file URLs");
    return value.map((url) => shellQuotePath(fileURLPath(url))).join(" ");
  };
  const dropFiles = async ({ urls } = {}) => sendPaste(dropFileURLs(urls));
  const pasteText = async () => {
    if (!clipboard || typeof clipboard.read !== "function") {
      throw new Error("terminal.paste requires a clipboard capability");
    }
    // 뗌의 복사가 아직 오지 않았으면 그 text가 clipboard에 쓰이기를 기다린다.
    await waitForCopy;
    const text = await clipboard.read("text");
    if (text !== null) {
      if (typeof text !== "string") throw new Error("text clipboard returned a non-text value");
      return sendPaste(text);
    }
    const urls = await clipboard.read("fileURLs");
    if (urls !== null) {
      if (!Array.isArray(urls) || urls.length === 0) throw new Error("file clipboard is empty");
      return sendPaste(urls.map((url) => shellQuotePath(fileURLPath(url))).join(" "));
    }
    const png = await clipboard.read("png");
    if (png !== null) {
      if (!clipboard || typeof clipboard.persistPNG !== "function") {
        throw new Error("PNG clipboard persistence is unavailable");
      }
      const persisted = await clipboard.persistPNG(png);
      if (!persisted || typeof persisted.shellQuotedPath !== "string" || persisted.shellQuotedPath.length === 0) {
        throw new Error("PNG clipboard persistence returned no shell path");
      }
      return sendPaste(persisted.shellQuotedPath);
    }
    throw new Error("clipboard has no text, file, or PNG payload");
  };
  const rejectClipboardQuery = async (requestId, reason) => {
    if (!Number.isInteger(requestId) || requestId < 0) throw new Error("clipboard query requestId is invalid");
    await terminal.send(id, { operation: "clipboard.reject", requestId, reason });
  };
  const handleClipboardStore = async (body) => {
    if (programClipboardPolicy !== "allow") throw new Error("program clipboard store denied by policy");
    if (body.selection !== "clipboard") throw new Error(`unsupported program clipboard target: ${String(body.selection)}`);
    if (typeof body.text !== "string") throw new Error("program clipboard store requires text");
    if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("program clipboard store requires a clipboard capability");
    await clipboard.writeText(body.text);
  };
  const handleClipboardQuery = async (body) => {
    if (!Number.isInteger(body.requestId) || body.requestId < 0) throw new Error("clipboard query requestId is invalid");
    if (programClipboardPolicy !== "allow") {
      await rejectClipboardQuery(body.requestId, "program clipboard query denied by policy");
      return;
    }
    if (body.selection !== "clipboard") {
      await rejectClipboardQuery(body.requestId, `unsupported program clipboard target: ${String(body.selection)}`);
      return;
    }
    if (!clipboard || typeof clipboard.read !== "function") {
      await rejectClipboardQuery(body.requestId, "program clipboard query requires a clipboard capability");
      return;
    }
    const text = await clipboard.read("text");
    if (text === null) {
      await rejectClipboardQuery(body.requestId, "text clipboard is empty");
      return;
    }
    if (typeof text !== "string") {
      await rejectClipboardQuery(body.requestId, "program clipboard query returned a non-text value");
      return;
    }
    await terminal.send(id, { operation: "clipboard.resolve", requestId: body.requestId, text });
  };
  const releasedSelection = () => {
    session = { ...session, selectionReleases: session.selectionReleases + 1 };
    changed("session");
  };
  // 사이드카는 뗌의 복사 event를 그 뗌이 그린 raster 뒤에 보내므로 복사의 도착이 뗌보다 늦다. 붙어넣기가 clipboard를
  // 읽기 전에 자기 표면의 마지막 뗌의 복사를 기다리게 한다. 대기자는 뗌마다 하나씩 들어가고 도착하는 복사 event가
  // 앞에서부터 하나씩 끝낸다. 세션이 닫히면 남은 대기자를 모두 끝낸다.
  const copyWaiters = [];
  let waitForCopy = Promise.resolve();
  const armCopyWait = () => {
    let settle;
    waitForCopy = new Promise((resolve) => { settle = resolve; });
    copyWaiters.push(settle);
  };
  const settleNextCopy = () => copyWaiters.shift()?.();
  const endCopyWaits = () => { while (copyWaiters.length > 0) settleNextCopy(); };
  const handleSelectionCopy = async (body) => {
    if (body.userInitiated !== true) throw new Error("selection.copy requires userInitiated true");
    if (typeof body.text !== "string" || body.text.length === 0) throw new Error("selection.copy requires non-empty text");
    if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("selection.copy requires a clipboard capability");
    await clipboard.writeText(body.text);
  };

  const observeInput = (promise) => promise.then(undefined, (error) => {
    reportInputError(error);
  });
  const recoverInputTail = () => undefined;

  const inputBody = (entry) => ({ operation: "input", actions: entry.actions, preedit: entry.preedit });
  const sendEntry = async (entry, cids) => {
    if (entry.type === "input") {
      await terminal.send(id, inputBody(entry), cids);
    } else {
      throw new Error(`unknown terminal input type: ${entry.type}`);
    }
  };

  const scheduleInput = (entry, cids) => {
    const request = inputChain.then(() => sendEntry(entry, cids));
    // 복구된 tail은 다음 요청의 실행만 허용한다. 원래 요청은 호출자에게
    // 거절된 상태로 남는다. native callback은 observeInput으로 그 거절을
    // 관측하고 오류를 세션 status에 발행한다.
    inputChain = request.catch(recoverInputTail);
    return request;
  };

  // 사이드카가 보낸 커서 값을 status 에 반영하고 입력기 caret 을 그 칸에 둔다.
  // value 는 사이드카 원본, fields 는 반영할 값이다. 잘못된 값은 오류로 알린다.
  const applyCursor = (value, fields) => {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("cursor must be an object");
      cursor = normalizeCursor({ ...cursor, ...fields });
      changed("cursor");
      if (cursor.caret !== null && typeof region.setCaret === "function") {
        Promise.resolve(region.setCaret({
          x: cursor.caret.col * session.cellWidth,
          y: cursor.caret.row * session.cellHeight,
          width: session.cellWidth,
          height: session.cellHeight,
        })).catch(reportInputError);
      }
    } catch (error) {
      setError("cursor", `invalid cursor from sidecar: ${error.message}`);
    }
  };

  const enqueueInput = (entry, cids = []) => {
    const input = inputBody(entry);
    notifyInput({ kind: "terminal-input", input, cids });
    // The trace records each input with every field that it carries, the text included, and whether it waits for the session.
    const { type, ...fields } = entry;
    runtime.log.debug("input", () => ({ kind: type, ...fields, queued: !sessionOpen, queue: inputQueue.length }), { cids });
    if (!sessionOpen) {
      if (inputQueue.length >= MAX_QUEUE_SIZE) {
        runtime.log.warn("input.overflow", { kind: type, max: MAX_QUEUE_SIZE, queue: inputQueue.length });
        const error = new Error(`Input queue overflow (max ${MAX_QUEUE_SIZE})`);
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => inputQueue.push({ entry, cids, resolve, reject }));
    }
    return scheduleInput(entry, cids);
  };

  const flushInputQueue = () => {
    const pending = inputQueue.splice(0);
    runtime.log.debug("input.flush", { count: pending.length });
    for (const { entry, cids, resolve, reject } of pending) {
      scheduleInput(entry, cids).then(resolve, reject);
    }
  };

  // The region reports all callbacks from one native input scope as one strict transaction.
  onRegion("input", async (event) => {
    let transaction;
    try {
      transaction = normalizeNativeInput(event);
    } catch (error) {
      reportInputError(error);
      return;
    }
    const { actions, preedit, errors: inputErrors, cids } = transaction;
    const traceInput = { actions, preedit, errors: inputErrors };
    notifyInput({ kind: "native-input", input: traceInput, cids });
    traceNative("native-input", { input: traceInput, cids });
    applyCompose(preedit);
    for (const action of actions) {
      if (action.type === "focus") {
        nativeFocused = action.focused;
        notifyPointer({ kind: "pointer-focus", focused: nativeFocused });
      }
    }
    try {
      await enqueueInput({ type: "input", actions, preedit }, cids);
    } catch (error) {
      reportInputError(error);
    }
    for (const { reason } of inputErrors) reportInputError(reason);
    if (nativeFocused) {
      for (const resolve of focusWaiters) resolve();
      focusWaiters.clear();
    }
  });

  onRegion("error", (event) => {
    const message = `native image: ${event.reason}`;
    setError("native image", message);
    reportSurfaceError(new Error(message));
  });

  // Edit 메뉴 동작은 선언된 명령을 레지스트리로 실행한다(docs/spec/terminal-runtime.md).
  const ACTIONS = { paste: "terminal.paste", copy: "terminal.copy" };
  onRegion("action", async (event) => {
    const command = ACTIONS[event?.name];
    if (!command) {
      reportInputError(new Error(`unknown native action: ${String(event?.name)}`));
      return;
    }
    await observeInput(Promise.resolve().then(() => expose.run(command, {})));
  });

  // 네이티브 포커스를 받은 뒤 DOM 기본 동작이 키보드 소유권을 되찾지 않게 한다.
  const preventDefaultFocus = (event) => event.preventDefault();
  view.addEventListener("pointerdown", preventDefaultFocus);
  let selectionPointerId = null;
  let selectionStart = null;
  let selectionStarted = false;
  // 누름은 뷰 안이어야 한다. 누른 뒤 끄는 포인터가 뷰 밖으로 나가면 뷰 안의 가장 가까운 점으로 맞춘다.
  // 줄의 처음이나 끝을 고르는 끌기는 포인터가 뷰 가장자리를 지나기 쉽다.
  const selectionPoint = (event, nearest = false) => {
    const rect = view.getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("terminal selection pointer has no position");
    if (nearest) {
      x = Math.min(rect.width - 1, Math.max(0, x));
      y = Math.min(rect.height - 1, Math.max(0, y));
    } else if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) {
      throw new Error("terminal selection pointer is outside the view");
    }
    return { x, y };
  };
  // 포인터 아래 칸의 OSC 8 링크. 사이드카의 selection_cell 과 같이 CSS 칸 크기로 칸을 정한다.
  const linkAt = (event) => {
    const rect = view.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (!(session.cellWidth > 0 && session.cellHeight > 0 && session.cols > 0 && session.rows > 0)) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    const col = Math.min(Math.floor(x / session.cellWidth), session.cols - 1);
    const row = Math.min(Math.floor(y / session.cellHeight), session.rows - 1);
    const link = screen[row]?.[col]?.link;
    return typeof link === "string" ? link : null;
  };
  // 포인터 입력을 사이드카에 알린다. 프로그램이 마우스 보고를 켰으면 사이드카가 보고로 바꾸고, 아니면 무시한다.
  // 버튼 없는 움직임은 칸이 바뀔 때만 보낸다.
  let hoverCell = null;
  // 마우스 보고와 선택 연산은 같은 PTY 상태를 갱신한다. 요청을 동시에 보내면
  // transport 응답 순서가 달라져 selection.update 가 selection.start 보다 먼저
  // 처리될 수 있다. 제스처 전체를 하나의 순서열로 보낸다.
  let pointerInputChain = Promise.resolve();
  const mouseInputs = new Map();
  const queuePointerInput = (body) => {
    notifyPointer({ kind: "pointer-queued", body });
    const request = pointerInputChain.then(async () => {
      if (body.operation === "mouse") {
        if (mouseInputs.size >= 4096) throw new Error("unanswered mouse input capacity exceeded");
        mouseInputs.set(body.inputId, body.phase);
      }
      notifyPointer({ kind: "pointer-sent", body });
      try {
        return await terminal.send(id, body);
      } catch (error) {
        if (body.operation === "mouse") mouseInputs.delete(body.inputId);
        notifyPointer({ kind: "pointer-error", inputId: body.inputId, error: String(error) });
        throw error;
      }
    });
    pointerInputChain = request.catch(recoverInputTail);
    observeInput(request);
    return request;
  };
  const sendMouse = (phase, point, event, pressed) => {
    queuePointerInput({ operation: "mouse", inputId: crypto.randomUUID(), phase, ...point, pressed,
      shift: event.shiftKey === true, alt: event.altKey === true, ctrl: event.ctrlKey === true });
  };
  const hoverMouse = (event) => {
    if (selectionPointerId !== null || !(session.cellWidth > 0 && session.cellHeight > 0)) return;
    const rect = view.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= rect.width || y >= rect.height) return;
    const cell = `${Math.floor(x / session.cellWidth)},${Math.floor(y / session.cellHeight)}`;
    if (cell === hoverCell) return;
    hoverCell = cell;
    sendMouse("move", { x, y }, event, false);
  };
  // 프로그램이 정한 포인터 모양. 기본값은 페이지의 커서다.
  const pointerStyle = () => (session.pointer === "default" ? "" : session.pointer);
  // 링크 칸 위의 포인터는 손 모양이다.
  const hoverLink = (event) => {
    const link = event.type === "pointerleave" ? null : linkAt(event);
    if (link === session.link) return;
    view.style.cursor = link ? "pointer" : pointerStyle();
    session = { ...session, link };
    changed("session");
  };
  const beginSelection = (event) => {
    if (event.button !== 0 || selectionPointerId !== null) return;
    // Command 와 함께 누른 링크 칸은 선언된 명령으로 링크를 열고 선택을 시작하지 않는다.
    const link = event.metaKey ? linkAt(event) : null;
    if (link) {
      event.preventDefault();
      observeInput(Promise.resolve().then(() => expose.run("terminal.link.open", { uri: link })));
      return;
    }
    try {
      const point = selectionPoint(event);
      // pointer capture가 소유권 경계다. 브라우저가 capture를 확인하기 전에는
      // selecting 상태를 발행하거나 mouse down을 대기열에 넣지 않는다.
      view.setPointerCapture(event.pointerId);
      sendMouse("down", point, event, true);
      selectionPointerId = event.pointerId;
      selectionStart = point;
      selectionStarted = false;
      session = { ...session, selecting: true };
      changed("session");
      event.preventDefault();
    } catch (error) {
      reportInputError(error);
    }
  };
  const updateSelection = (event) => {
    if (event.pointerId !== selectionPointerId) return;
    try {
      const point = selectionPoint(event, true);
      event.preventDefault();
      sendMouse("move", point, event, true);
      if (!selectionStarted) {
        if (point.x === selectionStart.x && point.y === selectionStart.y) return;
        selectionStarted = true;
        queuePointerInput({ operation: "selection.start", ...selectionStart });
      }
      queuePointerInput({ operation: "selection.update", ...point });
    } catch (error) {
      reportInputError(error);
    }
  };
  const endSelection = (event) => {
    if (event.pointerId !== selectionPointerId) return;
    selectionPointerId = null;
    const started = selectionStarted;
    const start = selectionStart;
    selectionStart = null;
    selectionStarted = false;
    session = { ...session, selecting: false };
    changed("session");
    try {
      view.releasePointerCapture(event.pointerId);
    } catch (error) {
      // 브라우저가 이 경계 전에 이미 capture를 해제했을 수 있다.
      // 실패는 관측 가능하게 두지만, terminal 해제 순서를 포기하거나
      // 다음 gesture가 이 호출에 의존하게 두지 않는다.
      reportInputError(error);
    }
    event.preventDefault();
    // 움직이지 않은 클릭은 누른 칸에서 빈 선택을 시작하고 끝낸다. 빈 선택의 뗌은 이전 선택을 지운다.
    if (!started) queuePointerInput({ operation: "selection.start", ...start });
    armCopyWait();
    // 보내기가 실패하면 올 복사 event가 없으므로 대기자를 바로 끝낸다.
    queuePointerInput({ operation: "selection.end" }).catch(settleNextCopy);
    // 뗌은 선택 연산 뒤에 보낸다. 사이드카는 마우스 보고 제스처의 선택 연산을 뗌 전에 받아 선택하지 않는다.
    try {
      sendMouse("up", selectionPoint(event, true), event, false);
    } catch (error) {
      reportInputError(error);
    }
  };
  // 휠은 스크롤 제스처다. 이동량을 정수 줄로 바꿔 포인터 칸과 함께 보낸다(docs/spec/terminal-runtime.md).
  // 한 줄보다 작은 픽셀 이동은 누적한다. 양수 줄은 오래된 출력 쪽이다.
  let wheelLines = 0;
  const scrollWheel = (event) => {
    event.preventDefault();
    const { cols, rows, cellWidth, cellHeight } = session;
    const delta = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * rows : event.deltaY / cellHeight;
    wheelLines -= delta;
    const lines = Math.trunc(wheelLines);
    wheelLines -= lines;
    // Each gesture is recorded, a move that sends no line included, so the log tells a gesture that never arrived from one
    // that did not add up to a line.
    runtime.log.debug("wheel", () => ({ deltaY: event.deltaY, deltaMode: event.deltaMode, cellHeight, lines, carry: wheelLines }));
    if (lines === 0) return;
    const rect = view.getBoundingClientRect();
    const col = Math.min(cols - 1, Math.max(0, Math.floor((event.clientX - rect.left) / cellWidth)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((event.clientY - rect.top) / cellHeight)));
    observeInput(terminal.send(id, { operation: "scroll", lines, col, row }));
  };
  view.addEventListener("wheel", scrollWheel, { passive: false });

  // 스크롤바는 터미널이 기록을 보관하는 동안 보인다(docs/spec/terminal-runtime.md).
  const thumbGeometry = () => {
    const { rows, scrollback: { offset, history } } = session;
    const height = scrollbar.track.getBoundingClientRect().height;
    const size = Math.min(height, Math.max(16, height * rows / (rows + history)));
    const top = Math.min(height - size, height * (history - offset) / (rows + history));
    return { height, size, top };
  };
  // 스크롤바 설정(docs/spec/terminal-runtime.md). 잘못된 값은 입력 오류로 보고하고 적용하지 않는다.
  const COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
  const scrollbarStyle = { track: "terminal", thumb: "#8f98a080", width: 10, shape: "rounded" };
  let terminalBackground = null;
  const applyScrollbarSettings = (values) => {
    const next = { track: values["scrollbar.track"], thumb: values["scrollbar.thumb"], width: values["scrollbar.width"], shape: values["scrollbar.shape"] };
    if (next.track === "terminal" || (typeof next.track === "string" && COLOR.test(next.track))) scrollbarStyle.track = next.track;
    else reportInputError(new Error(`scrollbar.track setting is invalid: ${String(next.track)}`));
    if (typeof next.thumb === "string" && COLOR.test(next.thumb)) scrollbarStyle.thumb = next.thumb;
    else reportInputError(new Error(`scrollbar.thumb setting is invalid: ${String(next.thumb)}`));
    if (Number.isInteger(next.width) && next.width >= 4 && next.width <= 24) scrollbarStyle.width = next.width;
    else reportInputError(new Error(`scrollbar.width setting is invalid: ${String(next.width)}`));
    if (next.shape === "rounded" || next.shape === "square") scrollbarStyle.shape = next.shape;
    else reportInputError(new Error(`scrollbar.shape setting is invalid: ${String(next.shape)}`));
    paintScrollbar();
  };
  // padding 설정(pt). 그림 영역과 셀 격자는 padding 안쪽을 차지하고, 스크롤바는 영역의 오른쪽 가장자리에 놓인다.
  const PADDING_SIDES = ["top", "right", "bottom", "left"];
  const padding = { top: 0, right: 0, bottom: 0, left: 0 };
  const applyPaddingSettings = (values) => {
    for (const side of PADDING_SIDES) {
      const value = values[`padding.${side}`];
      if (Number.isInteger(value) && value >= 0 && value <= 64) padding[side] = value;
      else reportInputError(new Error(`padding.${side} setting is invalid: ${String(value)}`));
    }
    view.style.position = "absolute";
    for (const side of PADDING_SIDES) view.style[side] = `${padding[side]}px`;
    if (scrollbar) for (const side of ["top", "right", "bottom"]) scrollbar.track.style[side] = `${padding[side]}px`;
    if (paddingStrips) {
      // 위아래 띠는 폭 전체를, 왼쪽과 오른쪽 띠는 그 사이를 덮는다.
      const strip = (side, box) => {
        Object.assign(paddingStrips[side].style, box);
        paddingStrips[side].hidden = padding[side] === 0;
      };
      strip("top", { top: "0px", left: "0px", right: "0px", height: `${padding.top}px` });
      strip("bottom", { bottom: "0px", left: "0px", right: "0px", height: `${padding.bottom}px` });
      strip("left", { top: `${padding.top}px`, bottom: `${padding.bottom}px`, left: "0px", width: `${padding.left}px` });
      strip("right", { top: `${padding.top}px`, bottom: `${padding.bottom}px`, right: "0px", width: `${padding.right}px` });
    }
    paintPadding();
  };
  // padding 은 터미널의 현재 기본 배경색을 보인다.
  const paintPadding = () => {
    if (!paddingStrips) return;
    // default: 첫 화면의 배경을 받기 전에는 padding 을 아직 색칠하지 않는다.
    for (const side of PADDING_SIDES) paddingStrips[side].style.background = terminalBackground ?? "";
  };
  // 트랙은 네이티브 그림이 잘린 자리를 칠한다. terminal 은 터미널의 현재 기본 배경색이다.
  const paintScrollbar = () => {
    if (!scrollbar) return;
    scrollbar.track.style.width = `${scrollbarStyle.width}px`;
    // default: 첫 화면의 배경을 받기 전에는 트랙을 아직 색칠하지 않는다.
    scrollbar.track.style.background = scrollbarStyle.track === "terminal" ? (terminalBackground ?? "") : scrollbarStyle.track;
    scrollbar.thumb.style.background = scrollbarStyle.thumb;
    scrollbar.thumb.style.borderRadius = scrollbarStyle.shape === "square" ? "0px" : "999px";
  };
  const drawScrollbar = () => {
    if (!scrollbar) return;
    scrollbar.track.hidden = session.scrollback.history === 0;
    if (scrollbar.track.hidden) return;
    const { size, top } = thumbGeometry();
    scrollbar.thumb.style.height = `${size}px`;
    scrollbar.thumb.style.top = `${top}px`;
  };
  // 손잡이를 끄는 동안 포인터 아래의 오프셋으로 선언된 명령을 실행한다.
  let thumbDrag = null;
  const beginThumbDrag = (event) => {
    if (event.button !== 0 || thumbDrag) return;
    event.preventDefault();
    event.stopPropagation();
    const { top } = thumbGeometry();
    thumbDrag = { pointerId: event.pointerId, grab: event.clientY - scrollbar.track.getBoundingClientRect().top - top, sent: null };
    // 끄는 동안 손잡이는 쥔 손 포인터를 보인다.
    scrollbar.thumb.dataset.dragging = "";
    scrollbar.thumb.setPointerCapture(event.pointerId);
  };
  const moveThumb = (event) => {
    if (!thumbDrag || event.pointerId !== thumbDrag.pointerId) return;
    event.preventDefault();
    const { rows, scrollback: { history } } = session;
    const { height } = thumbGeometry();
    const top = event.clientY - scrollbar.track.getBoundingClientRect().top - thumbDrag.grab;
    const offset = Math.min(history, Math.max(0, Math.round(history - top / height * (rows + history))));
    if (offset === thumbDrag.sent) return;
    thumbDrag.sent = offset;
    observeInput(Promise.resolve().then(() => expose.run("terminal.scrollback.set", { offset })));
  };
  const endThumbDrag = (event) => {
    if (!thumbDrag || event.pointerId !== thumbDrag.pointerId) return;
    scrollbar.thumb.releasePointerCapture(event.pointerId);
    delete scrollbar.thumb.dataset.dragging;
    thumbDrag = null;
  };
  if (scrollbar) {
    scrollbar.thumb.addEventListener("pointerdown", beginThumbDrag);
    scrollbar.thumb.addEventListener("pointermove", moveThumb);
    scrollbar.thumb.addEventListener("pointerup", endThumbDrag);
    scrollbar.thumb.addEventListener("pointercancel", endThumbDrag);
    drawScrollbar();
  }
  view.addEventListener("pointerdown", beginSelection);
  view.addEventListener("pointermove", updateSelection);
  view.addEventListener("pointermove", hoverLink);
  view.addEventListener("pointermove", hoverMouse);
  view.addEventListener("pointerleave", hoverLink);
  view.addEventListener("pointerup", endSelection);
  view.addEventListener("pointercancel", endSelection);
  // 카드 전환이나 창 비활성화로 캡처가 풀리면 pointerup이 오지 않을 수 있다. 선택 포인터와
  // 사이드카의 누른 상태를 같은 경계에서 닫아 다음 카드 복귀 뒤 새 드래그를 허용한다.
  view.addEventListener("lostpointercapture", endSelection);
  const pointerTraceTypes = ["pointerdown", "pointermove", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture"];
  const tracePointer = (event) => notifyPointer({ kind: "pointer-dom", type: event.type,
    pointerId: event.pointerId, buttons: event.buttons, button: event.button,
    x: event.clientX, y: event.clientY, shift: event.shiftKey === true,
    captured: view.hasPointerCapture(event.pointerId), selectionPointerId, nativeFocused,
    trusted: event.isTrusted, defaultPrevented: event.defaultPrevented });
  if (diagnostics) for (const type of pointerTraceTypes) view.addEventListener(type, tracePointer);

  // 세션 열기는 크기를 보내지 않는다. 호스트가 네이티브 영역을 적용하며 보낸 configure만
  // 이미지와 PTY 크기의 권위 있는 입력이다.
  // 세션은 설정 shell 이 가리키는 셸을 연다(login 은 계정의 로그인 셸). 설정이 없으면 다른 셸로 대신하지 않는다.
  const shell = settings.read().shell;
  if (typeof shell !== "string" || shell.length === 0) throw new Error("terminal shell setting is missing");
  // 터미널에서 쪼갠 터미널은 그 터미널이 마지막으로 알린 디렉터리에서, 아니면 프로젝트 루트에서 시작한다.
  // 프로젝트가 없는 창에서는 홈 디렉터리에서 시작한다(docs/spec/terminal-runtime.md).
  // default: 분할 출처에 디렉터리가 없으면 프로젝트 루트, 프로젝트도 없으면 홈 디렉터리에서 연다.
  const directory = origin.directory ?? project?.root ?? null;
  // 카드 발은 작업 디렉터리를 보인다. 홈 디렉터리에서 시작하면 셸이 알릴 때까지 경로를 모른다.
  if (directory !== null) tab.footer(directory);
  // 서비스가 교체되어 새 셸을 열 때는 셸이 마지막으로 알린 디렉터리에서 시작해 사람이 이어서 쓴다. 다른 컴퓨터의
  // 디렉터리(path null)는 기록을 지우므로 탭이 시작한 디렉터리로 돌아간다.
  let working = directory;
  const openSession = () => {
    runtime.log.info("session.open", { shell, directory: working });
    return terminal.send(id, { operation: "open", image: "view", shell,
      ...(working === null ? {} : { directory: working }) });
  };
  const settingsPolicy = () => {
    const values = settings.read();
    return {
      shape: values["cursor.shape"],
      blink: values["cursor.blink"],
      interval: values["cursor.interval"],
      idleTimeout: values["cursor.idleTimeout"],
      unfocused: values["cursor.unfocused"],
    };
  };
  // 세션 부트스트랩: 처음과 연결이 다시 맺길 때 같은 값을 같은 순서로 보낸다(V5-106).
  // 보존 세션에서 열기는 아무 일도 하지 않고, 재스폰된 서비스에서는 새 세션을 연다.
  // 새 연결의 서비스는 테마·글꼴·커서 정책을 모르므로 다시 보낸다 — 글꼴의 중복 제거
  // 캐시(requested)를 지우고 같은 값을 다시 보낸다.
  const bootstrapSession = async () => {
    applyTitle();
    await openSession();
    if (lastTheme) await setTheme(lastTheme.scheme, lastTheme.tokens);
    requested = null;
    await setFont(settings.read()["font.family"]).catch((error) => {
      reportInputError(error);
    });
    await setCursorPolicy(settingsPolicy());
  };
  // 재실행은 하나의 순서열로 보낸다 — 두 연결 이벤트가 겹쳐도 부트스트랩은 순서대로
  // 완료된다. 꼬리의 실패 삼킴은 다음 재실행을 막지 않기 위함이고, 오류 자체는
  // 연결 이벤트 처리가 관측한다. 정의는 사이드카 수신 등록보다 앞선다 — 연결 이벤트가
  // 첫 부팅 중에도 도착할 수 있으므로.
  let bootstrapChain = Promise.resolve();
  // 꼬리 회복: 실패한 부트스트랩이 다음 재실행을 막지 않게 한다. 그 실패 자체는
  // rerunBootstrap 을 부른 연결 이벤트 처리가 관측한다.
  const recoverBootstrapTail = () => undefined;
  const rerunBootstrap = () => {
    const run = bootstrapChain.then(bootstrapSession);
    bootstrapChain = run.catch(recoverBootstrapTail);
    return run;
  };

  // screen.read 응답을 기다리는 resolver
  let pendingScreenRead = null;
  // pty.pending 측정 응답을 기다리는 resolver. 진단 명령이 한 번에 하나만 요청한다.
  let pendingPtyRead = null;

  // 사이드카 메시지 수신
  const stopSidecar = await terminal.on(id, (body) => {
    // The regions detach at the removal; an event after it would operate on a detached region.
    if (closing.aborted) return;
    if (body.event === "state") {
      // 숫자 필드의 유효성을 확인한다. 계약 위반이면 오류로 보고한다.
      const errorDetails = [];
      if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
        errorDetails.push(`sessionId: ${typeof body.sessionId === "string" ? "empty" : "missing or wrong type"}`);
      }
      if (body.cursor !== undefined && (body.cursor === null || typeof body.cursor !== "object")) {
        errorDetails.push("cursor: must be an object when present");
      }
      if (typeof body.cols !== "number" || body.cols <= 0) {
        errorDetails.push(`cols: ${typeof body.cols === "number" ? `invalid value ${body.cols}` : `missing or wrong type`}`);
      }
      if (typeof body.rows !== "number" || body.rows <= 0) {
        errorDetails.push(`rows: ${typeof body.rows === "number" ? `invalid value ${body.rows}` : `missing or wrong type`}`);
      }
      if (typeof body.cellWidth !== "number" || body.cellWidth <= 0) {
        errorDetails.push(`cellWidth: ${typeof body.cellWidth === "number" ? `invalid value ${body.cellWidth}` : `missing or wrong type`}`);
      }
      if (typeof body.cellHeight !== "number" || body.cellHeight <= 0) {
        errorDetails.push(`cellHeight: ${typeof body.cellHeight === "number" ? `invalid value ${body.cellHeight}` : `missing or wrong type`}`);
      }
      if (body.cursor && typeof body.cursor === "object" && !Array.isArray(body.cursor)) {
        if (Object.hasOwn(body.cursor, "frame") && body.cursor.frame !== null) {
          errorDetails.push("cursor.frame: a state event cannot identify a screen frame");
        }
        if (Object.hasOwn(body.cursor, "caret") && body.cursor.caret !== null) {
          errorDetails.push("cursor.caret: a state event cannot identify a frame-effective caret");
        }
        if (Object.hasOwn(body.cursor, "render") && body.cursor.render !== null) {
          errorDetails.push("cursor.render: a state event cannot identify screen render metadata");
        }
        try {
          normalizeCursor({ ...cursor, ...body.cursor, frame: null, render: null, caret: null, preedit: body.cursor.preedit ?? null });
        } catch (error) {
          errorDetails.push(`invalid cursor: ${error.message}`);
        }
      }

      if (errorDetails.length > 0) {
        setError("state", `invalid state from sidecar: ${errorDetails.join("; ")}`);
        return;
      }

      session = {
        ...session,
        sessionId: body.sessionId,
        cols: body.cols,
        rows: body.rows,
        cellWidth: body.cellWidth,
        cellHeight: body.cellHeight,
        unsupported: session.unsupported,
      };
      resolveError("state");
      if (body.cursor !== undefined) applyCursor(body.cursor, { ...body.cursor, frame: null, render: null, caret: null, preedit: body.cursor.preedit ?? null });
      sessionOpen = true;
      runtime.log.info("session.gate", { open: true, event: "state" });
      changed("session");
      flushInputQueue();
    } else if (body.event === "session") {
      if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
        reportInputError("invalid persistent session event", "session");
        return;
      }
      session = { ...session, sessionId: body.sessionId };
      resolveError("session");
      // A preserved session answers a reattached surface with this event, so the input that waited during the
      // reconnection flows now.
      sessionOpen = true;
      runtime.log.info("session.gate", { open: true, event: "session" });
      changed("session");
      flushInputQueue();
    } else if (body.event === "connection") {
      // 영속 사이드카의 연결이 다시 맺혔다(V5-106). 이전 연결이 남긴 사이드카 오류는
      // 해소하고 세션을 다시 연다 — 재스폰된 서비스에는 이 표면의 세션이 없다. 실패했으면
      // 연결 끊김과 그 까닭을 세션 오류로 남긴다. 입력은 다시 열릴 때까지 대기열에 쌓인다.
      sessionOpen = false;
      runtime.log.info("session.gate", { open: false, event: "connection", connected: body.connected });
      if (body.connected === true) {
        if (resolveError("sidecar")) changed("session");
        rerunBootstrap().catch((error) => reportInputError(error));
      } else {
        const reason = typeof body.reason === "string" && body.reason.length > 0 ? `: ${body.reason}` : "";
        setError("sidecar", `sidecar connection failed${reason}`);
      }
    } else if (body.event === "screen") {
      // 진단 command terminal.screen.alter 가 요청한 변경은 메시지를 검사하고 hash 하기 전에, 중간에 바뀐 것처럼 적용한다.
      if (alterNextScreen) {
        alterNextScreen = false;
        body = alteredScreen(body);
      }
      // screen 이벤트를 처리한다. screen.read 응답이나 화면 변화 알림.
      // 메시지가 화면을 모두 담으므로(docs/spec/terminal-runtime.md in core) 메시지는 항상 검사하고, frame 이벤트의 hash 는
      // 메시지만으로 계산한다. screenHash 는 SHA-256 이라 비동기이므로 fields 는 builder 가 아니라 hash 가 나온 뒤의 객체다.
      // 거부된 메시지는 screen 출처의 오류이고 처리하지 않는다.
      let message;
      try {
        // The cursor is part of each screen message (docs/spec/replay.md), so a message without it is refused before any update.
        const { col, row, visible, focused, shape, blinking } = body.cursor ?? {};
        const cursorIsObject = body.cursor !== null && typeof body.cursor === "object" && !Array.isArray(body.cursor);
        const preeditFailure = cursorIsObject ? preeditError(body.cursor.preedit) : null;
        if (body.cursor === null || typeof body.cursor !== "object" || !Number.isInteger(col) || !Number.isInteger(row) || typeof visible !== "boolean" ||
          (focused !== undefined && typeof focused !== "boolean") || (blinking !== undefined && typeof blinking !== "boolean") ||
          (shape !== undefined && !DRAWN_SHAPE_KEYS.has(shape) || !cursorIsObject || preeditFailure !== null)) {
          if (preeditFailure !== null) throw new Error(`invalid screen cursor preedit from sidecar: ${preeditFailure}`);
          throw new Error(`invalid screen cursor from sidecar: ${JSON.stringify(body.cursor)}`);
        }
        if (!isScreenFrame(body.frame)) {
          throw new Error(`invalid screen frame from sidecar: ${JSON.stringify(body.frame)}`);
        }
        const caretFailure = cursorIsObject ? screenCaretError(body.cursor, body.rows, body.cols, body.frame) : null;
        if (caretFailure !== null) throw new Error(`invalid screen cursor caret from sidecar: ${caretFailure}`);
        if (!Object.hasOwn(body, "render")) throw new Error("screen render is required");
        body.render = normalizeScreenRender(body.render, body.frame);
        // render is a terminal consumer field; the SDK screen hash owns the
        // screen-message projection and does not include raster diagnostics.
        const { render: _render, ...hashMessage } = body;
        message = screenFromMessage(hashMessage);
      } catch (error) {
        reportInputError(error, "screen");
        return;
      }
      // frame 기록은 gate 없이 runtime.log.debug 로 넘기며, 저장 여부는 event log 의 writer 가 class 로 정한다(docs/spec/logging.md).
      // 페이지는 log level 을 읽지 않는다. screenHash 는 비동기이므로 fields 는 hash 가 나온 뒤의 객체다.
      // The session of the sidecar, which its frame records name (docs/spec/replay.md#records in core).
      const { sequence, segment } = body;
      const { sessionId } = session;
      screenHash(message).then(
        (hash) => runtime.log.debug("frame", { session: sessionId, segment, sequence, rows: message.rows, cols: message.cols, hash }),
        (error) => reportInputError(error, "screen"),
      );
      // 링크와 screen.read 는 글자, 폭, 링크만 쓴다. 색과 속성은 래스터가 그린다.
      screen = body.cells.reduce((rows, cell, index) => {
        if (index % body.cols === 0) rows.push([]);
        // 빈 칸과 넓은 글자의 이어지는 칸은 글자가 없다. 읽는 쪽은 그 폭을 공백으로 센다. 켜진 속성 flag 는 이름으로 담는다.
        const flags = {};
        for (const [bit, name] of ATTRIBUTE_FLAGS) if (cell.attributes & bit) flags[name] = true;
        rows[rows.length - 1].push({
          ...(cell.grapheme === "" ? {} : { ch: cell.grapheme }), width: cell.width, ...flags,
          ...(cell.link === undefined ? {} : { link: cell.link }),
        });
        return rows;
      }, []);
      screenFrame = body.frame;
      changed("screen");
      if (typeof body.background === "string" && body.background !== terminalBackground) {
        terminalBackground = body.background;
        paintScrollbar();
        paintPadding();
      }
      if (body.scrollback !== undefined) {
        const { offset, history } = body.scrollback;
        if (!Number.isInteger(offset) || !Number.isInteger(history) || offset < 0 || history < 0) {
          reportInputError(`invalid screen scrollback from sidecar: ${JSON.stringify(body.scrollback)}`, "screen");
        } else if (offset !== session.scrollback.offset || history !== session.scrollback.history) {
          session = { ...session, scrollback: { offset, history } };
          changed("session");
          drawScrollbar();
        }
      }
      // 화면의 커서는 현재 위치·표시·포커스와 그린 모양이다. 그린 모양은 표시 규칙이 적용된 값이므로 정책 값을 바꾸지 않고
      // drawn 에 둔다.
      {
        // 해시가 덮는 멤버는 col, row, visible 이고 focused, shape, blinking 은 있을 때만 검사해 반영한다.
        const { col, row, visible, focused, shape, blinking } = body.cursor;
        const drawn = { ...cursor.drawn };
        if (shape !== undefined) drawn.shape = DRAWN_SHAPES[shape] ?? shape;
        if (blinking !== undefined) drawn.blinking = blinking;
        applyCursor(body.cursor, {
          col, row, visible, ...(focused === undefined ? {} : { focused }), drawn, frame: body.frame,
          render: body.render, caret: body.cursor.caret, preedit: body.cursor.preedit ?? null,
        });
        notifyScreen(screenSnapshot());
        if (resolveError("screen")) changed("session");
      }
      if (pendingScreenRead) {
        pendingScreenRead({ rows: screen, frame: screenFrame });
        pendingScreenRead = null;
      }
    } else if (body.event === "cursor") {
      try {
        const policy = normalizeCursorPolicy(body);
        cursor = { ...cursor, ...policy };
        changed("cursor");
      } catch (error) {
        reportInputError(new Error(`invalid cursor policy from sidecar: ${error.message}`));
      }
    } else if (body.event === "theme") {
      if (body.mode !== "dark" && body.mode !== "light") {
        reportInputError(new Error("invalid theme acknowledgement from sidecar"), "theme");
        return;
      }
      // 사이드카가 적용한 기본 배경을 함께 알린다. 검사는 이 값으로 테마가 적용되었음을 안다.
      session = { ...session, theme: body.mode, background: typeof body.background === "string" ? body.background : null };
      resolveError("theme");
      changed("session");
    } else if (body.event === "mouse") {
      notifyPointer({ kind: "pointer-result", body });
      if (typeof body.inputId !== "string" || mouseInputs.keys().next().value !== body.inputId ||
          mouseInputs.get(body.inputId) !== body.phase) {
        reportInputError(new Error(`unexpected mouse inputId: ${String(body.inputId)}`));
        return;
      }
      mouseInputs.delete(body.inputId);
      const modes = body.modes;
      if (!["down", "move", "up"].includes(body.phase) || !modes ||
          !["click", "drag", "motion"].every((key) => typeof modes[key] === "boolean") ||
          typeof body.reported !== "boolean" || typeof body.written !== "boolean" ||
          (body.bytes !== null && typeof body.bytes !== "string")) {
        reportInputError(new Error("invalid mouse measurement from sidecar"));
        return;
      }
      session = { ...session, mouse: {
        inputId: body.inputId,
        phase: body.phase, x: body.x, y: body.y, pressed: body.pressed, shift: body.shift,
        alt: body.alt, ctrl: body.ctrl, reported: body.reported, written: body.written,
        modes, bytes: body.bytes, error: typeof body.error === "string" ? body.error : null,
      }};
      changed("session");
      // 실패한 mouse 연산도 자기 inputId 의 결과로 답한다. 짝은 위에서 맞췄고, 실패는 입력 오류로 보인다.
      if (typeof body.error === "string") reportInputError(new Error(body.error));
    } else if (body.event === "pty.pending") {
      // 진단 측정의 답이다. 요청이 없으면 계약 위반이고 오류는 요청을 거절한다.
      if (!pendingPtyRead) {
        reportInputError(new Error("unexpected pty.pending response from sidecar"));
        return;
      }
      const waiter = pendingPtyRead;
      pendingPtyRead = null;
      if (typeof body.error === "string") {
        waiter.reject(new Error(body.error));
      } else if (!Number.isInteger(body.pending) || body.pending < 0 || !Number.isInteger(body.written) || body.written < 0) {
        const error = new Error(`invalid pty.pending measurement from sidecar: ${JSON.stringify(body)}`);
        reportInputError(error);
        waiter.reject(error);
      } else {
        waiter.resolve({ pending: body.pending, written: body.written });
      }
    } else if (body.event === "clipboard.store") {
      handleClipboardStore(body).catch(reportInputError);
    } else if (body.event === "clipboard.query") {
      handleClipboardQuery(body).catch(reportInputError);
    } else if (body.event === "clipboard.rejected") {
      reportInputError(new Error(typeof body.reason === "string" ? body.reason : "program clipboard query rejected"));
    } else if (body.event === "selection.copy") {
      handleSelectionCopy(body).catch(reportInputError).finally(settleNextCopy);
      releasedSelection();
    } else if (body.event === "copy") {
      // 복사 명령의 답이다. 선택이 없으면 사이드카가 copied false 로 알리고 클립보드는 그대로 둔다.
      if (body.copied === false) return;
      handleSelectionCopy(body).catch(reportInputError);
    } else if (body.ack === true && ACKNOWLEDGED.has(body.event)) {
      // 사이드카가 연산을 적용했다는 확인이다. 결과는 이미지나 뒤따르는 이벤트로 온다.
    } else if (body.event === "selection.end") {
      // 글자를 담지 않은 선택의 해제다. 사이드카가 선택을 지웠고 복사할 것이 없다.
      if (body.copied !== false) reportInputError(new Error("selection.end requires copied false"));
      releasedSelection();
      settleNextCopy();
    } else if (body.event === "directory") {
      if (typeof body.uri !== "string" || body.uri.length === 0 || (body.path !== null && typeof body.path !== "string")) {
        reportInputError(new Error("invalid directory event from sidecar"));
        return;
      }
      session = { ...session, vendor: { ...session.vendor, directory: body.uri } };
      // default: 다른 컴퓨터의 디렉터리(path null)는 기록을 지우므로 다음 열기는 탭이 시작한 디렉터리를 쓴다.
      working = body.path === null ? directory : body.path;
      changed("session");
      // 다른 컴퓨터의 디렉터리(path null)는 기록한 디렉터리를 지우고, 발에는 그 주소를 보인다.
      try {
        tab.directory(body.path);
        tab.footer(body.path ?? body.uri);
      } catch (error) {
        reportInputError(error);
      }
    } else if (body.event === "title") {
      if (typeof body.title !== "string") {
        reportInputError(new Error("invalid title event from sidecar"));
        return;
      }
      // 빈 제목은 제목이 없다는 뜻이다.
      programTitle = body.title === "" ? null : body.title;
      applyTitle();
    } else if (body.event === "title.reset") {
      programTitle = null;
      applyTitle();
    } else if (body.event === "hyperlink") {
      if (typeof body.id !== "string" || (body.uri !== null && typeof body.uri !== "string")) {
        reportInputError(new Error("invalid hyperlink event from sidecar"));
        return;
      }
      session = { ...session, vendor: { ...session.vendor, hyperlink: { id: body.id, uri: body.uri } } };
      changed("session");
    } else if (body.event === "pointer") {
      if (typeof body.shape !== "string" || body.shape.length === 0) {
        reportInputError(new Error("invalid pointer event from sidecar"));
        return;
      }
      session = { ...session, pointer: body.shape };
      if (!session.link) view.style.cursor = pointerStyle();
      changed("session");
    } else if (body.event === "notification") {
      if (typeof body.message !== "string" || body.message.length === 0) {
        reportInputError(new Error("invalid notification event from sidecar"));
        return;
      }
      session = { ...session, vendor: { ...session.vendor, notification: body.message } };
      changed("session");
      // 보이지 않는 탭이면 워크벤치가 탭에 알림을 둔다. 거부된 알림은 세션 오류다.
      try {
        tab.notify(body.message, notificationPolicy);
      } catch (error) {
        setError("notification", `terminal notification failed: ${error.message}`);
        reportSurfaceError(error);
      }
    } else if (body.event === "vendor.shell.state") {
      const markers = new Set(["prompt.start", "prompt.end", "command.start", "command.finished"]);
      if (!markers.has(body.marker) || !Array.isArray(body.params) || body.params.some((value) => typeof value !== "string")) {
        reportInputError(new Error("invalid shell state event from sidecar"));
        return;
      }
      session = { ...session, vendor: { ...session.vendor, shell: { marker: body.marker, params: body.params } } };
      changed("session");
    } else if (body.event === "image.inline" && body.command === "display" && typeof body.name === "string") {
      if (!session.inlineImages.includes(body.name)) {
        session = { ...session, inlineImages: [...session.inlineImages, body.name] };
        changed("session");
      }
    } else if (body.event === "image.inline.deleted" && typeof body.name === "string") {
      if (session.inlineImages.includes(body.name)) {
        session = { ...session, inlineImages: session.inlineImages.filter((name) => name !== body.name) };
        changed("session");
      }
    } else if (body.event === "sequence.rejected") {
      if (typeof body.reason !== "string" || body.reason.length === 0) {
        reportInputError(new Error("invalid sequence.rejected event from sidecar"));
        return;
      }
      const rejected = [...session.rejected, body.reason];
      const shed = Math.max(0, rejected.length - REJECTED_KEPT);
      session = { ...session, rejected: rejected.slice(-REJECTED_KEPT), rejectedShed: session.rejectedShed + shed };
      // Each reason that the list drops is counted, and the record states the running count.
      if (shed > 0) runtime.log.info("session.rejected.shed", { count: session.rejectedShed });
      changed("session");
    } else if (body.event === "error") {
      // error 이벤트를 session 상태에 저장한다
      const error = new Error(typeof body.reason === "string" ? body.reason : (typeof body.error === "string" ? body.error : "Unknown sidecar error"));
      setError("sidecar", error.message);
      reportSurfaceError(error);
    } else if (body.event === "font" && typeof body.family === "string") {
      session = { ...session, font: body.family, fontSystem: body.system === true, fontSize: body.size };
      changed("session");
    } else if (body.error) {
      // 오류 응답 처리: {"error":"invalidParams","reason":"...",...}
      // reason 을 버리지 않고 오류에 실어 보낸다.
      const message = typeof body.reason === "string" ? `${body.error}: ${body.reason}` : body.error;
      setError("sidecar", message);
      reportSurfaceError(new Error(message));
    } else if (body.event) {
      // 알 수 없는 이벤트 타입을 기록한다
      runtime.log.warn("sidecar.unknown", { event: String(body.event) });
      if (!session.unsupported.includes(body.event)) {
        session = { ...session, unsupported: [...session.unsupported, body.event] };
        changed("session");
      }
    }
  });

  await rerunBootstrap();

  let themeReady = Promise.resolve();
  let themeSubscription = null;
  if (typeof theme === "function") {
    let first = true;
    themeSubscription = theme((value) => {
      if (!value || (value.scheme !== "dark" && value.scheme !== "light")) {
        const error = new Error("theme callback must provide scheme dark or light");
        reportInputError(error);
        if (first) { first = false; return Promise.reject(error); }
        return Promise.resolve();
      }
      // 마지막 테마를 기록한다 — 연결이 다시 맺히면 그 값으로 다시 보낸다(V5-106).
      lastTheme = value;
      const request = setTheme(value.scheme, value.tokens);
      if (first) {
        first = false;
        return request.then(undefined, (error) => { reportInputError(error); throw error; });
      }
      return request.catch(reportInputError);
    });
    // default: 구독 결과에 ready 약속이 없으면 구독 결과 자체가 첫 테마 적용의 완료다.
    themeReady = Promise.resolve(themeSubscription?.ready ?? themeSubscription).catch((error) => {
      reportInputError(error);
      throw error;
    });
  }
  await themeReady;

  let settingsSubscription = null;
  if (settings) {
    applyScrollbarSettings(settings.read());
    applyPaddingSettings(settings.read());
    settingsSubscription = settings.on((values) => {
      applyScrollbarSettings(values);
      applyPaddingSettings(values);
      applyTitle();
      const nextClipboardPolicy = values["clipboard.program"];
      if (!PROGRAM_CLIPBOARD_POLICIES.has(nextClipboardPolicy)) {
        reportInputError(new Error(`clipboard.program setting is invalid: ${String(nextClipboardPolicy)}`));
        return;
      }
      programClipboardPolicy = nextClipboardPolicy;
      const policy = {
        shape: values["cursor.shape"],
        blink: values["cursor.blink"],
        interval: values["cursor.interval"],
        idleTimeout: values["cursor.idleTimeout"],
        unfocused: values["cursor.unfocused"],
      };
      setCursorPolicy(policy).catch(reportInputError);
      setFont(values["font.family"]).catch(reportInputError);
    });
  }

  const textSizeSubscription = textSize.on((factor) => setTextSize(factor).catch(reportInputError));

  // 사이드카는 세션을 끝낼 때 전송 그림을 놓는다. 영역을 먼저 떼므로 그 전에 보낸 프레임은 뗀 영역에서 stale 로 답하고,
  // 붙은 영역이 놓인 그림을 notFound 로 표시하지 못하는 일이 없다(core docs/spec/plugins.md#surface-module-ownership).
  async function endSession() {
    await detachRegions();
    endCopyWaits();
    runtime.log.info("close", {});
    await terminal.send(id, { operation: "close" });
  }

  // 공개 항목 등록
  await Promise.all([
    expose.status("terminal.session", read.session, watch("session")),
    expose.status("terminal.screen", read.screen, watch("screen")),
    expose.status("terminal.compose", read.compose, watch("compose")),
    expose.status("terminal.cursor", read.cursor, watch("cursor")),
    expose.command("terminal.input", async ({ bytes }) => {
      if (typeof bytes !== "string") throw new Error("terminal.input requires bytes");
      try {
        await enqueueInput({ type: "input", actions: [{ type: "insert", text: bytes, replacementRange: null, attributed: false }], preedit: compose });
      } catch (error) {
        reportInputError(error);
        throw error;
      }
      return null;
    }),
    expose.command("terminal.screen.read", async () => {
      if (region === null) throw new Error("Terminal not initialized");
      return new Promise((resolve, reject) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            pendingScreenRead = null;
            reject(new Error("screen.read timeout"));
          }
        }, 5000);

        pendingScreenRead = (event) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(event);
          }
        };

        terminal.send(id, { operation: "screen.read" }).catch((error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            pendingScreenRead = null;
            reject(error);
          }
        });
      });
    }),
    expose.command("terminal.close", async () => {
      await endSession();
      return null;
    }),
    expose.command("terminal.image.inline.delete", async ({ name }) => {
      if (typeof name !== "string" || name.length === 0) {
        throw new Error("terminal.image.inline.delete requires a non-empty name");
      }
      await terminal.send(id, { operation: "image.inline.delete", name });
      return null;
    }),
    expose.dom("terminal.view", view),
  ]);
  await expose.command("terminal.focus", async () => {
    try {
      await region.focus();
      return null;
    } catch (error) {
      reportInputError(error);
      throw error;
    }
  });
  // 빠진 필드는 지금 정책 값을 유지한다.
  await expose.command("terminal.cursor.set", async (policy) => setCursorPolicy({
    shape: cursor.shape, blink: cursor.blink, interval: cursor.interval, idleTimeout: cursor.idleTimeout,
    unfocused: cursor.unfocused, ...policy,
  }));
  await expose.command("terminal.paste", pasteText);
  await expose.command("terminal.scrollback.set", async ({ offset } = {}) => {
    if (!Number.isInteger(offset) || offset < 0) throw new Error(`terminal.scrollback.set requires a nonnegative integer offset: ${String(offset)}`);
    await terminal.send(id, { operation: "viewport", offset });
    return null;
  });
  if (scrollbar) {
    await Promise.all([
      expose.dom("terminal.scrollbar", scrollbar.track),
      expose.dom("terminal.scrollbar.thumb", scrollbar.thumb),
      expose.mark(scrollbar.thumb, "terminal.scrollback.set"),
    ]);
  }
  // 현재 선택의 텍스트는 사이드카가 copy 이벤트로 보낸다.
  await expose.command("terminal.link.open", async ({ uri } = {}) => {
    if (typeof uri !== "string" || uri.length === 0) throw new Error("terminal.link.open requires a uri");
    if (!links) throw new Error("the terminal has no link capability");
    await links.open(uri);
  });
  await expose.command("terminal.copy", async () => {
    await terminal.send(id, { operation: "copy" });
    return null;
  });
  await expose.command("terminal.drop", dropFiles);
  // 진단 측정: 현재 세션에서 마스터가 쓰고 자식이 아직 읽지 않은 입력 바이트 수와 reader 가 읽은
  // 자식 출력 누적 바이트 수를 한 번의 왕복으로 사이드카에 묻는다.
  const readPtyPending = () => new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingPtyRead = null;
      reject(new Error("pty.pending timeout"));
    }, 5000);
    pendingPtyRead = {
      resolve: (pending) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(pending);
      },
      reject: (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    };
    terminal.send(id, { operation: "pty.pending" }).catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pendingPtyRead = null;
      reject(error);
    });
  });
  // 진단 빌드에서는 진단 모듈이 preedit 주입, 입력 기록, PTY 전송 상태 측정 항목을 이 연산으로 등록한다.
  if (diagnostics) {
    await diagnostics.attach({
      expose,
      updateCompose,
      onInput: (fn) => {
        inputObservers.add(fn);
        return () => inputObservers.delete(fn);
      },
      onScreen: (fn) => {
        screenObservers.add(fn);
        return () => screenObservers.delete(fn);
      },
      readScreen: screenSnapshot,
      onPointer: (fn) => {
        pointerObservers.add(fn);
        return () => pointerObservers.delete(fn);
      },
      readPtyPending,
      alterNextScreen: () => {
        alterNextScreen = true;
      },
      reportError: (message) => setError("trace", message),
      resolveError: () => {
        if (resolveError("trace")) changed("session");
      },
    });
  }
  return {
    setTheme,
    setCursorPolicy,
    pasteText,
    async focus() {
      if (nativeFocused) return;
      let resolveFocus;
      const focused = new Promise((resolve) => {
        resolveFocus = resolve;
        focusWaiters.add(resolve);
      });
      try {
        await region.focus();
        if (!nativeFocused) await focused;
      } catch (error) {
        focusWaiters.delete(resolveFocus);
        throw error;
      }
    },
    async dispose() {
      if (diagnostics) for (const type of pointerTraceTypes) view.removeEventListener(type, tracePointer);
      const offTheme = await themeSubscription?.dispose;
      // default: 테마나 설정 구독이 없으면 해제 함수도 없다.
      offTheme?.();
      // default: 설정 구독이 없으면 해제 함수도 없다.
      settingsSubscription?.();
      textSizeSubscription();
      // default: 사이드카 구독을 만들지 못한 경우에는 해제 함수가 없다.
      stopSidecar?.();
      view.removeEventListener("pointerdown", preventDefaultFocus);
      view.removeEventListener("pointerdown", beginSelection);
      view.removeEventListener("pointermove", updateSelection);
      view.removeEventListener("pointermove", hoverLink);
      view.removeEventListener("pointermove", hoverMouse);
      view.removeEventListener("pointerleave", hoverLink);
      view.removeEventListener("pointerup", endSelection);
      view.removeEventListener("wheel", scrollWheel);
      if (scrollbar) {
        scrollbar.thumb.removeEventListener("pointerdown", beginThumbDrag);
        scrollbar.thumb.removeEventListener("pointermove", moveThumb);
        scrollbar.thumb.removeEventListener("pointerup", endThumbDrag);
        scrollbar.thumb.removeEventListener("pointercancel", endThumbDrag);
      }
      view.removeEventListener("pointercancel", endSelection);
      view.removeEventListener("lostpointercapture", endSelection);
      await endSession();
    },
  };
}
