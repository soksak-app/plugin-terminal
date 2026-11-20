import { shellQuotePath } from "@soksak/plugin-api";
import { changeMessage, confirmationLine, firstMessage, isAtRest, isStaleConfirmation, launchOf, rereadRequest } from "./agent-role.js";
import { applyScreenMessage, screenHash } from "@soksak/plugin-api/screen-hash";

// 터미널 표면의 부팅과 동작을 처리한다.
//
// startTerminal 함수는 인자로 받은 의존성을 사용하므로 브라우저와 Node 환경에서 모두 부를 수 있다.

// The refusal of an input whose caller waits for a session that no event will open. The session status holds the reason already.
class SessionFailure extends Error {}

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
// clipboard.program: deny refuses a store and a query of a program, write admits only a store, and allow admits both.
const PROGRAM_CLIPBOARD_POLICIES = new Set(["deny", "write", "allow"]);
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
// The change form carries its cells in the rows of changed, so the first cell of its first changed row is altered.
function alteredScreen(body) {
  const cells = body.base === false ? (Array.isArray(body.changed) ? body.changed[0]?.cells : undefined) : body.cells;
  if (!Array.isArray(cells) || cells.length === 0 || !Number.isInteger(cells[0]?.attributes)) return body;
  const [first, ...rest] = cells;
  const altered = [{ ...first, attributes: first.attributes ^ 0x01 }, ...rest];
  if (body.base !== false) return { ...body, cells: altered };
  const [row, ...rows] = body.changed;
  return { ...body, changed: [{ ...row, cells: altered }, ...rows] };
}

// The row of the row model for the cells of one screen row: the text, width and link of each cell and its attribute flags by name.
// A blank cell and the continuation cell of a wide character have no text; a reader counts its width as spaces.
function screenRow(cells) {
  return cells.map((cell) => {
    const flags = {};
    for (const [bit, name] of ATTRIBUTE_FLAGS) if (cell.attributes & bit) flags[name] = true;
    return {
      ...(cell.grapheme === "" ? {} : { ch: cell.grapheme }), width: cell.width, ...flags,
      ...(cell.link === undefined ? {} : { link: cell.link }),
    };
  });
}

// screen 메시지의 attributes byte 의 flag 와 그 이름(core docs/spec/replay.md#screen-hash).
const ATTRIBUTE_FLAGS = [[0x01, "bold"], [0x02, "dim"], [0x04, "italic"], [0x08, "underline"], [0x10, "blink"], [0x20, "inverse"],
  [0x40, "hidden"], [0x80, "strikethrough"]];

// The states that the sidecar reports and their sources (core docs/spec/terminal-state.md#states).
const TERMINAL_STATES = new Set(["idle", "running", "exited"]);
// The screens of a kept-rows read (core docs/spec/terminal-read.md#alternate-rows).
const READ_SCREENS = new Set(["primary", "alternate"]);
const isCount = (value) => Number.isInteger(value) && value >= 0;
// The states of a background job (core docs/spec/process-list.md#background-jobs).
const JOB_STATES = new Set(["running", "stopped"]);
// The reason that a process of the process list (core docs/spec/process-list.md#process) is invalid, or null: {group, pid,
// command, arguments, cwd, started} with text paths, text arguments and a start time, or a refused read whose command,
// arguments, cwd and started are null with error; a background job carries state too.
function processError(entry, job) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return JSON.stringify(entry);
  const { group, pid, command, arguments: args, cwd, started, error, state, ...other } = entry;
  const id = (value) => Number.isInteger(value) && value > 0;
  const text = (value) => typeof value === "string" && value.length > 0;
  if (Object.keys(other).length > 0 || !id(group) || !id(pid) || (job ? !JOB_STATES.has(state) : state !== undefined)) return JSON.stringify(entry);
  const read = error === undefined && text(command) && text(cwd) && isCount(started) && Array.isArray(args) &&
    args.every((argument) => typeof argument === "string");
  const refused = text(error) && command === null && args === null && cwd === null && started === null;
  return read || refused ? null : JSON.stringify(entry);
}
// The reason that a process list {foreground, background} of the sidecar is invalid, or null: a process or null, and an array of
// background jobs.
function processListError({ foreground, background }) {
  if (foreground !== null) {
    const failure = processError(foreground, false);
    if (failure !== null) return failure;
  }
  if (!Array.isArray(background)) return JSON.stringify(background);
  for (const job of background) {
    const failure = processError(job, true);
    if (failure !== null) return failure;
  }
  return null;
}
// The routes and the ends of the waits of a scroll read (core docs/spec/terminal-read.md#program-scroll).
const SCROLL_ROUTES = new Set(["program", "alternate_scroll", "viewport"]);
const SCROLL_SETTLED = new Set(["sync", "quiet", "viewport"]);
const SCROLL_READ_BY = 1000;
const SCROLL_READ_QUIET = 120;
// The reason that a screen.scroll event of the sidecar is invalid, or null.
function scrollReplyError(body) {
  const { event, route, changed, text, restored, settledBy, quiet, refreshRate, first, ...other } = body;
  const row = (value) => value === null || typeof value === "string";
  const valid = event === "screen.scroll" && Object.keys(other).length === 0 && SCROLL_ROUTES.has(route) &&
    typeof changed === "boolean" && Array.isArray(text) && text.every((value) => typeof value === "string") &&
    typeof restored === "boolean" && SCROLL_SETTLED.has(settledBy?.scroll) && SCROLL_SETTLED.has(settledBy?.restore) &&
    Object.keys(settledBy).length === 2 && Number.isInteger(quiet) && (refreshRate === null || (typeof refreshRate === "number" && refreshRate > 0)) &&
    (restored ? first === undefined : row(first?.before) && row(first?.after) && Object.keys(first).length === 2);
  return valid ? null : JSON.stringify(body);
}
const TERMINAL_STATE_SOURCES = new Set(["osc133"]);
// The core levels in their order, and the level of each state of a program status record
// (core docs/spec/terminal-state.md#activity).
const ACTIVITY_ORDER = ["idle", "running", "failed", "attention"];
const RECORD_LEVELS = { blocked: "attention", error: "failed", working: "running", idle: "idle", done: "idle" };
/**
 * Returns the core activity level of a terminal, or null for no activity (core docs/spec/terminal-state.md#activity): the
 * highest level of the records of its program, else attention for a notice, else the level of its state, where a nonzero
 * exit code of `exited` and of the `idle` after it is the failure of the last command, which lasts until the next command
 * starts.
 */
function terminalActivity({ state, exit }, { records, notice }) {
  if (records.length > 0) {
    return records.map(({ state: record }) => RECORD_LEVELS[record])
      .reduce((high, level) => (ACTIVITY_ORDER.indexOf(level) > ACTIVITY_ORDER.indexOf(high) ? level : high));
  }
  if (notice) return "attention";
  const failed = exit !== null && exit !== 0;
  if (state === "idle") return failed ? "failed" : "idle";
  if (state === "running") return "running";
  if (state === "exited" && failed) return "failed";
  return null;
}
// The prefix of the token of a receipt file, and the end state of a notice that the records of the program at the end of a working
// period give, the first of this order that a record holds; a period ends with no working record, so the order holds no working.
const RECEIPT_PREFIX = "receipt-";
// The number of messages of the registration that terminal.messages keeps in decided (core docs/spec/messaging.md#delivery).
const DECIDED_LIMIT = 64;
const NOTICE_STATES = ["blocked", "error", "done", "idle"];
function endStateOf(records) {
  return NOTICE_STATES.find((state) => records.some((record) => record.state === state)) ?? "idle";
}
// The token of a message or a receipt file name `<from>.<token>.txt`: the text between its last dot and its extension.
function tokenOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.txt$/, "");
  return name.slice(name.lastIndexOf(".") + 1);
}
const PROGRAM_RECORD_KEYS = ["id", "state", "kind", "progress", "app", "title", "msg"];
const PROGRAM_KINDS = new Set(["permission", "question", "auth"]);
/** Returns why a program status value of a change event or a read reply breaks the contract, or null when it holds. */
function programStatusProblem({ records, notice, sequence }, change) {
  if (!Number.isSafeInteger(sequence) || sequence < (change ? 1 : 0)) return "sequence";
  if (typeof notice !== "boolean") return "notice";
  if (!Array.isArray(records)) return "records";
  if (sequence === 0 && (records.length > 0 || notice)) return "a read without a change";
  const text = (value) => value === null || typeof value === "string";
  for (const record of records) {
    if (record === null || typeof record !== "object" || Object.keys(record).length !== PROGRAM_RECORD_KEYS.length ||
      !PROGRAM_RECORD_KEYS.every((key) => key in record)) return "record members";
    const { id, state, kind, progress, app, title, msg } = record;
    if (!(state in RECORD_LEVELS)) return "record state";
    if (!(kind === null || (state === "blocked" && PROGRAM_KINDS.has(kind)))) return "record kind";
    if (!(progress === null || (Number.isInteger(progress) && progress >= 0 && progress <= 100))) return "record progress";
    if (![id, app, title, msg].every(text)) return "record text";
  }
  return null;
}
/** Returns why a terminal state value of a change event or a read reply breaks the contract, or null when it holds. */
function terminalStateProblem({ state, source, sequence, exit }, change) {
  if (!Number.isSafeInteger(sequence) || sequence < (change ? 1 : 0)) return "sequence";
  if (state === null) {
    if (change) return "state";
    return source === null && sequence === 0 && exit === null ? null : "a read without a state";
  }
  if (!TERMINAL_STATES.has(state)) return "state";
  if (!TERMINAL_STATE_SOURCES.has(source)) return "source";
  if (sequence === 0) return "sequence";
  // `exited` and the `idle` after it carry the exit code of the last finished command; `running` carries none.
  if (state === "running") return exit === null ? null : "exit";
  return exit === null || (Number.isInteger(exit) && exit >= 0 && exit <= 255) ? null : "exit";
}

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
  // docs/spec/plugins.md#logging) and, in a window with a project, the status watch of core.grid (context.runtime.status). Required.
  runtime,
  window: globalWindow = globalThis.window }) {
  // 브라우저 환경에서 필요한 객체들
  const window = globalWindow;

  if (!id) {
    throw new Error("startTerminal requires explicit surface id");
  }
  // Each sink of the surface is required: a missing sink is refused by name, and no default stands in for it.
  if (typeof reportSurfaceError !== "function") throw new TypeError("startTerminal requires reportSurfaceError");
  if (tab === null || typeof tab !== "object" || typeof tab.error !== "function") throw new TypeError("startTerminal requires tab");
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
  const watchers = { session: new Set(), screen: new Set(), compose: new Set(), cursor: new Set(), state: new Set(), program: new Set(), activity: new Set(),
    messages: new Set() };
  // The delivery of the messages of the registration, which a page with a project creates below with the messages; it reviews its
  // hold at each change of a status that the hold reads (core docs/spec/messaging.md#hold-for-the-person).
  let messagesDelivery = null;
  const HOLD_STATUSES = new Set(["session", "compose", "state", "program"]);
  const changed = (name) => {
    for (const fn of watchers[name]) fn(read[name]());
    if (messagesDelivery !== null && HOLD_STATUSES.has(name)) messagesDelivery.review();
  };
  const watch = (name) => (fn) => {
    watchers[name].add(fn);
    return () => watchers[name].delete(fn);
  };

  // 확인 응답만 있고 따로 처리할 결과가 없는 사이드카 연산.
  const ACKNOWLEDGED = new Set(["selection.start", "selection.update", "paste"]);
  // 현재 세션 상태
  let session = {
    sessionId: "", cols: 80, rows: 24, cellWidth: 0, cellHeight: 0, unsupported: [],
    inlineImages: [],
    // 사이드카가 답한 선택 해제의 수. 해제의 결과(복사 또는 빈 선택)가 도착했음을 알린다.
    selectionReleases: 0,
    mouse: { inputId: null, phase: null, x: null, y: null, pressed: false, shift: false, alt: false, ctrl: false,
      reported: false, written: false, modes: { click: false, drag: false, motion: false }, bytes: null, error: null },
    // 왼쪽 버튼을 누른 선택 제스처가 진행 중인지.
    selecting: false,
    // 뷰포트가 가장 새 출력보다 위에 있는 줄 수와 보관된 기록 줄 수, 기록 한도가 primary 기록에서 버린 줄 수.
    scrollback: { offset: 0, history: 0, dropped: 0 },
    // The alternate screen and its kept rows (core docs/spec/terminal-read.md#session-state), which each view event carries.
    alternate: { active: false, history: 0, dropped: 0 },
    // The foreground program and the background jobs (core docs/spec/process-list.md#session-state), which each processes event
    // carries; null while the list is not known, before the first event and after a failed read.
    foreground: null,
    background: null,
    // 포인터 아래 칸의 OSC 8 링크 URI. 없으면 null.
    link: null,
    // OSC 22 로 프로그램이 정한 포인터 모양(CSS cursor 값). 링크 칸 위에서는 손 모양이 우선한다.
    pointer: "default",
    // 엔진이 거부한 프로그램 출력 시퀀스의 최근 이유. 프로그램의 출력이므로 터미널 오류가 아니다.
    rejected: [],
    // The sequence.rejected reasons that the rejected list dropped; the list keeps the last REJECTED_KEPT reasons.
    rejectedShed: 0,
    // The input the sidecar holds while reads of the program output stop: {queued, held: true}, or null.
    inputHeld: null,
    // Whether the child of the session ended, which the sidecar reports with the exit event.
    exited: false,
    vendor: { directory: null, hyperlink: null, notification: null, shell: null, progress: null },
    compose: { text: "", markedRange: null, selectedRange: null, replacementRange: null, attributed: false },
    theme: "dark",
  };
  // The terminal state of the session (core docs/spec/terminal-state.md): the value before the first read, then the read reply
  // and each change event.
  const STATE_BEFORE_READ = Object.freeze({ state: null, source: null, sequence: 0, exit: null });
  let terminalState = STATE_BEFORE_READ;
  // The program status of the session (core docs/spec/terminal-state.md#plugin-program-status): the value before the first
  // read, then the read reply and each change event.
  const PROGRAM_BEFORE_READ = Object.freeze({ records: [], notice: false, sequence: 0 });
  let programStatus = PROGRAM_BEFORE_READ;
  const activity = () => terminalActivity(terminalState, programStatus);
  // Sets the terminal state and notifies the watchers of the state, and of the activity when its level changes.
  const setTerminalState = (next) => {
    const before = activity();
    terminalState = next;
    changed("state");
    if (activity() !== before) changed("activity");
  };
  // Sets the program status and notifies the watchers of it, and of the activity when its level changes.
  const setProgramStatus = (next, change = false) => {
    const before = activity();
    programStatus = next;
    changed("program");
    // A report of the program counts toward the reread requests of a pending role (core docs/spec/agent-roles.md#requests).
    if (messagesDelivery !== null) messagesDelivery.programReport(next);
    if (messagesDelivery !== null) messagesDelivery.programChanged(next);
    // Only a change report asks for a report; a read reply of the program asks for nothing.
    if (change && messagesDelivery !== null) messagesDelivery.requestsFor(next);
    if (activity() !== before) changed("activity");
  };
  // The session whose state terminalState holds.
  let terminalStateSession = null;
  let screen = [];
  // The frame of the latest screen event, which terminal.screen.read returns with the rows.
  let screenFrame = null;
  let compose = session.compose;
  // 네이티브 입력 callback 과 터미널 입력 작업을 받는 함수. 진단 빌드의 진단 모듈만 등록한다.
  const inputObservers = new Set();
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
    state: () => terminalState,
    program: () => programStatus,
    activity,
    messages: () => messagesStatus,
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
      return sidecar.on(surface, (body, cids) => {
        runtime.log.trace("sidecar.event", () => ({ body }));
        return handler(body, cids);
      });
    },
    // The host sends the sidecar-failure of the surface when the sidecar ended (core docs/spec/sidecars.md).
    onFailure(surface, handler) {
      return sidecar.onFailure(surface, handler);
    },
  };

  // The image region. attachImage creates it with the composition of the view after the input handler below exists, and its
  // other events are subscribed after it answers.
  let region = null;
  // detachRegions 는 이 표면의 영역을 뗀다. 반복 호출은 같은 해제를 기다린다.
  if (typeof detachRegions !== "function") throw new TypeError("startTerminal requires detachRegions()");
  // Every event of the image region is recorded with its type and its whole body before its handler runs.
  const traced = (type, handler) => (event) => {
    runtime.log.trace("region", () => ({ type, ...event }));
    return handler(event);
  };
  const onRegion = (type, handler) => region.on(type, traced(type, handler));

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
  // Why no event will open the session: the open failed, or the connection failed. Null while a session is open or on its way.
  let sessionFailure = null;
  let nativeFocused = false;
  const focusWaiters = new Set();

  let inputChain = Promise.resolve();
  const inputQueue = [];
  const MAX_QUEUE_SIZE = 1024;
  // The input that a service received and has not answered, in the order sent. Its answer names the cids of its request (core
  // docs/spec/sidecars.md#protocol): the cids of the native input that it continues, or one of this view for input without any. A service that ends takes what it did not read from its socket, and the write and its answer succeeded, so
  // only the answer of the service tells that the input was applied. A new session takes this input; a session that stayed open may
  // have applied it. Input that only reports focus or a composition is not held: the session that opens reads them from the region.
  const unanswered = [];
  // Typing leaves at most 3 inputs without an answer, and a paste of 1 MiB has its answer within about 100 ms, so this limit keeps
  // all of that; a larger paste is not worth holding its text in the page for its whole session.
  const MAX_UNANSWERED_CHARACTERS = 1048576;
  let unansweredCharacters = 0;
  let unansweredSession = null;
  const unansweredPrefix = `view-${crypto.randomUUID()}`;
  let nextUnanswered = 1;

  // 세션 오류. 출처마다 마지막 메시지를 두며 session.error 는 가장 최근에 남은 오류다. 스냅샷
  // 출처(state, session, theme, screen, trace)의 오류는 같은 종류의 다음 유효한 이벤트가 해소하고,
  // 다른 출처의 오류는 표면이 닫힐 때까지 남는다. 관련 없는 이벤트는 오류를 지우지 않는다.
  const errors = new Map();
  // The tab error display shows the error that terminal.session shows, and nothing when it shows none: the display writes an
  // error to the application log when it appears (core AGENTS.md, the one display path of errors, and core
  // docs/spec/plugins.md, tab.error), so the same error again does not appear again.
  const showSessionError = (before) => {
    if (session.error !== before) tab.error(session.error ?? null);
  };
  const setError = (source, message) => {
    console.error(message);
    runtime.log.error("error", { source, message });
    const before = session.error;
    errors.delete(source);
    errors.set(source, message);
    session = { ...session, error: message };
    changed("session");
    showSessionError(before);
  };
  // 반환값은 session 을 바꿨는지다. 호출자가 changed("session") 을 알린다.
  const resolveError = (source) => {
    if (!errors.delete(source)) return false;
    const before = session.error;
    session = { ...session, error: [...errors.values()].at(-1) };
    showSessionError(before);
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
    // A paste is the paste request of the sidecar, which brackets it when the program turned bracketed paste on; it keeps
    // its place in the order of the inputs.
    await callerInput({ type: "paste", text });
    return null;
  };
  const dropFileURLs = (value) => {
    if (!Array.isArray(value) || value.length === 0) throw new Error("terminal file drop has no file URLs");
    return value.map((url) => shellQuotePath(fileURLPath(url))).join(" ");
  };
  // A drop and a paste of the person are typing on the input line (core docs/spec/messaging.md#hold-for-the-person).
  const dropFiles = async ({ urls } = {}) => {
    const text = dropFileURLs(urls);
    messagesDelivery?.typed(true);
    return sendPaste(text);
  };
  const pasteText = async () => {
    if (!clipboard || typeof clipboard.read !== "function") {
      throw new Error("terminal.paste requires a clipboard capability");
    }
    // 뗌의 복사가 아직 오지 않았으면 그 text가 clipboard에 쓰이기를 기다린다.
    await waitForCopy;
    const text = await clipboard.read("text");
    messagesDelivery?.typed(true);
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
  // A request that the setting refuses is no input failure, so it is recorded and not shown as an error.
  const recordClipboardRefusal = (operation) => {
    runtime.log.info("clipboard.refused", { operation, policy: programClipboardPolicy });
  };
  const handleClipboardStore = async (body) => {
    if (programClipboardPolicy === "deny") {
      recordClipboardRefusal("store");
      return;
    }
    if (body.selection !== "clipboard") throw new Error(`unsupported program clipboard target: ${String(body.selection)}`);
    if (typeof body.text !== "string") throw new Error("program clipboard store requires text");
    if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("program clipboard store requires a clipboard capability");
    await clipboard.writeText(body.text);
  };
  const handleClipboardQuery = async (body) => {
    if (!Number.isInteger(body.requestId) || body.requestId < 0) throw new Error("clipboard query requestId is invalid");
    if (programClipboardPolicy !== "allow") {
      recordClipboardRefusal("query");
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

  const inputBody = (entry) => (entry.type === "paste"
    ? { operation: "paste", text: entry.text }
    : { operation: "input", actions: entry.actions, preedit: entry.preedit });
  // Each cid of an answer ends the oldest input that names it; a native input may continue in more than one request.
  const releaseText = (held) => {
    if (held.body !== null) unansweredCharacters -= held.characters;
    held.body = null;
  };
  const forgetInput = (held) => {
    releaseText(held);
    unanswered.splice(unanswered.indexOf(held), 1);
  };
  // The input is no longer tracked and is not sent again: the session may have applied it, and nothing tells whether it did.
  const discardUnanswered = (reason) => {
    if (unanswered.length === 0) return;
    runtime.log.warn("input.unanswered.discarded", { count: unanswered.length, reason });
    unanswered.length = 0;
    unansweredCharacters = 0;
  };
  const charactersOf = (body) => (body.operation === "paste"
    ? body.text.length
    : body.actions.reduce((sum, action) => sum + (typeof action.text === "string" ? action.text.length : 1), 0));
  // Above a limit the text leaves and the cids stay, so that an answer still ends the input and only an input without an answer counts as lost.
  const recordNotHeld = (characters) => runtime.log.info("input.unanswered.unheld", { characters, maxCharacters: MAX_UNANSWERED_CHARACTERS });
  const holdInput = (body, cids) => {
    if (unanswered.length >= MAX_QUEUE_SIZE) {
      forgetInput(unanswered[0]);
      runtime.log.warn("input.unanswered.unfollowed", { max: MAX_QUEUE_SIZE });
    }
    const characters = charactersOf(body);
    const fits = characters <= MAX_UNANSWERED_CHARACTERS;
    if (!fits) recordNotHeld(characters);
    while (fits && unansweredCharacters + characters > MAX_UNANSWERED_CHARACTERS) {
      const oldest = unanswered.find((item) => item.body !== null);
      releaseText(oldest);
      recordNotHeld(oldest.characters);
    }
    if (unanswered.length === 0) unansweredSession = session.sessionId;
    const held = { body: fits ? body : null, cids, characters };
    unanswered.push(held);
    if (fits) unansweredCharacters += characters;
    return held;
  };
  // A send that fails answers its caller with the failure, so that input is not sent again.
  const sendHeld = async (body, native) => {
    if (body.operation === "input" && body.actions.every(({ type }) => type === "focus")) {
      await terminal.send(id, body, native);
      return;
    }
    const cids = native.length > 0 ? native : [`${unansweredPrefix}.${nextUnanswered++}`];
    const held = holdInput(body, cids);
    try {
      await terminal.send(id, body, cids);
    } catch (error) {
      if (unanswered.includes(held)) forgetInput(held);
      throw error;
    }
  };
  const sendEntry = async (entry, cids) => {
    if (entry.type === "input" || entry.type === "paste") {
      await sendHeld(inputBody(entry), cids);
    } else if (entry.type === "refused") {
      await sendHeld(entry.request, cids);
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

  const enqueueInput = (entry, cids = [], caller = false) => {
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
      return new Promise((resolve, reject) => inputQueue.push({ entry, cids, resolve, reject, caller }));
    }
    return scheduleInput(entry, cids);
  };

  // A caller waits for the answer of its input, so its input ends when no event will open the session. Typed input has no caller
  // and stays queued for the session that opens later.
  const callerInput = (entry) => (sessionFailure === null
    ? enqueueInput(entry, [], true)
    : Promise.reject(new SessionFailure(sessionFailure)));

  const failSession = (reason) => {
    sessionFailure = reason;
    const pending = inputQueue.splice(0);
    for (const item of pending) {
      if (item.caller) item.reject(new SessionFailure(reason));
      else inputQueue.push(item);
    }
    runtime.log.debug("input.refused", { count: pending.length - inputQueue.length });
  };

  // A service that respawned holds no session of this surface, and input that reached it before this view heard of that comes back
  // in its answer. That input goes before the input that waited, in the order of the answers, and the session reopens: the open does
  // nothing when a connection event opened it already.
  let refusedInputs = 0;
  const refusedEntry = (request) => ({
    entry: { type: "refused", request }, cids: [], resolve: () => {}, reject: (error) => reportInputError(error), caller: false,
  });
  const requeueRefused = (request) => {
    inputQueue.splice(refusedInputs, 0, refusedEntry(request));
    refusedInputs += 1;
    if (!sessionOpen) return;
    sessionOpen = false;
    runtime.log.info("session.gate", { open: false, event: "refused" });
    rerunBootstrap().catch((error) => reportInputError(error));
  };

  // The input that the ended service did not answer went before the input that a new service refused, and before the input that
  // waited. A session that stayed open keeps what it read, so its input is not sent twice.
  const settleUnanswered = () => {
    if (unanswered.length === 0) return;
    if (unansweredSession === session.sessionId) {
      discardUnanswered("session-kept");
      return;
    }
    const ended = unanswered.splice(0);
    unansweredCharacters = 0;
    const lost = ended.filter(({ body }) => body === null);
    if (lost.length > 0) {
      runtime.log.warn("input.unanswered.lost", { count: lost.length, characters: lost.reduce((sum, { characters }) => sum + characters, 0) });
    }
    const held = ended.filter(({ body }) => body !== null).map(({ body }) => body);
    runtime.log.info("input.unanswered.resent", { count: held.length });
    inputQueue.splice(0, 0, ...held.map(refusedEntry));
    refusedInputs += held.length;
  };

  const flushInputQueue = () => {
    refusedInputs = 0;
    const pending = inputQueue.splice(0);
    runtime.log.debug("input.flush", { count: pending.length });
    for (const { entry, cids, resolve, reject } of pending) {
      scheduleInput(entry, cids).then(resolve, reject);
    }
  };

  // A session that opens reads the current focus of the region, and then takes the input that waited: the last focus of the queue is
  // the current focus, so the order of the two does not change the state. A respawned service holds no focus and a preserved session
  // holds the focus of the view before this one, and a state event opens the gate for either. A state event of an open session sends
  // nothing.
  // Reads the terminal state and the program status of the session, which the page holds from the replies and the change
  // events (core docs/spec/terminal-state.md#state-read).
  const readState = () => terminal.send(id, { operation: "shell.state.read" }).catch((error) => reportInputError(error));
  const readProgram = () => terminal.send(id, { operation: "program.status.read" }).catch((error) => reportInputError(error));
  const readStatus = () => {
    readState();
    readProgram();
  };
  const openSessionGate = (event) => {
    const opening = !sessionOpen;
    sessionOpen = true;
    sessionFailure = null;
    resolveError("open");
    runtime.log.info("session.gate", { open: true, event });
    changed("session");
    if (opening) {
      settleUnanswered();
      enqueueInput({ type: "input", actions: [{ type: "focus", focused: nativeFocused }], preedit: compose })
        .catch((error) => reportInputError(error));
      // A persistent session keeps its state while no page shows it, so the page reads the state each time the session
      // opens or is attached again; a new session starts again from the value before the first read.
      if (terminalStateSession !== session.sessionId) {
        terminalStateSession = session.sessionId;
        setTerminalState(STATE_BEFORE_READ);
        setProgramStatus(PROGRAM_BEFORE_READ);
        session = { ...session, vendor: { ...session.vendor, progress: null } };
      }
      readStatus();
    }
    flushInputQueue();
  };

  // The region reports all callbacks from one native input scope as one strict transaction.
  const receiveInput = async (event) => {
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
      // An insert of the person starts a line on the input line, and Enter or Ctrl+C ends it (core
      // docs/spec/messaging.md#hold-for-the-person, typing).
      if (action.type === "insert" && action.text !== "") messagesDelivery?.typed(true);
      if (action.type === "key" && (action.key === "Enter" || (action.key === "Char" && action.text === "c" && action.ctrl))) {
        messagesDelivery?.typed(false);
      }
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
  };
  // The region takes the first responder as soon as it shows, before the creation of its composition answers, so its input
  // handler is the input of that creation (core docs/spec/native-surfaces.md#image-regions): each event reaches the handler in
  // its dispatch from the attachment of the region, and nothing holds one. The region refuses on("input").
  region = await attachImage(view, "view", { input: traced("input", receiveInput) });
  if (!region) throw new Error("Failed to attach image region");

  onRegion("error", (event) => {
    const message = `native image: ${event.reason}`;
    setError("native image", message);
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
  // The cell under the pointer of the drag that was reported last; a drag reports a move only when the cell changes.
  let dragCell = null;
  const cellOf = (point) => `${Math.floor(point.x / session.cellWidth)}:${Math.floor(point.y / session.cellHeight)}`;
  // 누름은 뷰 안이어야 한다. 누른 뒤 끄는 포인터가 뷰 밖으로 나가면 뷰 안의 가장 가까운 점으로 맞춘다.
  // 줄의 처음이나 끝을 고르는 끌기는 포인터가 뷰 가장자리를 지나기 쉽다. 위아래로 넘은 거리는 선택 갱신의 overflow 로 따로 보낸다.
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
  // The selection update of the drag that waits for its turn in the chain. A later move of the drag inside the view changes its
  // point instead of queueing another update, so a drag whose replies are slow keeps one update waiting with the latest point. A
  // move outside the view is never merged: the sidecar scrolls the history by the overflow of each update.
  let waitingSelectionUpdate = null;
  const queuePointerInput = (body) => {
    notifyPointer({ kind: "pointer-queued", body });
    const request = pointerInputChain.then(async () => {
      if (body === waitingSelectionUpdate) waitingSelectionUpdate = null;
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
    // The first state of the session carries the cell size: until then the sidecar has no image, and the view shows no cell to point at.
    if (event.button !== 0 || selectionPointerId !== null || !(session.cellWidth > 0 && session.cellHeight > 0)) return;
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
      dragCell = cellOf(point);
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
      // The vertical distance from the nearest point to the pointer: negative above the view, positive below it, 0 inside.
      const overflow = event.clientY - view.getBoundingClientRect().top - point.y;
      event.preventDefault();
      const cell = cellOf(point);
      if (cell !== dragCell) {
        dragCell = cell;
        sendMouse("move", point, event, true);
      }
      if (!selectionStarted) {
        if (point.x === selectionStart.x && point.y === selectionStart.y && overflow === 0) return;
        selectionStarted = true;
        queuePointerInput({ operation: "selection.start", ...selectionStart });
      }
      // The point within a cell decides the side of the cell that the selection ends at, so each point inside the view updates the
      // waiting update inside the view.
      if (waitingSelectionUpdate !== null && waitingSelectionUpdate.overflow === 0 && overflow === 0) {
        waitingSelectionUpdate.x = point.x;
        waitingSelectionUpdate.y = point.y;
        return;
      }
      waitingSelectionUpdate = { operation: "selection.update", ...point, overflow };
      queuePointerInput(waitingSelectionUpdate);
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
    dragCell = null;
    // The waiting update belongs to this drag, so a move of the next drag does not change it.
    waitingSelectionUpdate = null;
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
    observeInput(terminal.send(id, { operation: "scroll", lines, col, row, shift: event.shiftKey === true }));
  };
  view.addEventListener("wheel", scrollWheel, { passive: false });

  // 스크롤바 설정(docs/spec/terminal-runtime.md). 잘못된 값은 입력 오류로 보고하고 적용하지 않는다.
  const COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
  // The default background of a view event (docs/spec/alacritty-core.md of the sidecar).
  const BACKGROUND = /^#[0-9a-fA-F]{6}$/;
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
    // default: 첫 view 이벤트의 배경을 받기 전에는 padding 을 아직 색칠하지 않는다.
    for (const side of PADDING_SIDES) paddingStrips[side].style.background = terminalBackground ?? "";
  };
  // 트랙은 네이티브 그림이 잘린 자리를 칠한다. terminal 은 터미널의 현재 기본 배경색이다.
  const paintScrollbar = () => {
    if (!scrollbar) return;
    scrollbar.track.style.width = `${scrollbarStyle.width}px`;
    // default: 첫 view 이벤트의 배경을 받기 전에는 트랙을 아직 색칠하지 않는다.
    scrollbar.track.style.background = scrollbarStyle.track === "terminal" ? (terminalBackground ?? "") : scrollbarStyle.track;
    scrollbar.thumb.style.background = scrollbarStyle.thumb;
    scrollbar.thumb.style.borderRadius = scrollbarStyle.shape === "square" ? "0px" : "999px";
  };
  // The scrollbar is shown while the terminal keeps history. The thumb is placed in CSS relative to the track, so a change of
  // the size of the track moves it without a new draw, and the view draws it again when rows, offset or history changes
  // (docs/spec/acceptance.md).
  const drawScrollbar = () => {
    if (!scrollbar) return;
    const { rows, scrollback: { offset, history } } = session;
    scrollbar.track.hidden = history === 0;
    if (scrollbar.track.hidden) return;
    const size = `max(16px, ${100 * rows / (rows + history)}%)`;
    scrollbar.thumb.style.height = size;
    scrollbar.thumb.style.top = `min(calc(100% - ${size}), ${100 * (history - offset) / (rows + history)}%)`;
  };
  // 손잡이를 끄는 동안 포인터 아래의 오프셋으로 선언된 명령을 실행한다.
  let thumbDrag = null;
  const beginThumbDrag = (event) => {
    if (event.button !== 0 || thumbDrag) return;
    event.preventDefault();
    event.stopPropagation();
    // clientY and the rectangles of the thumb and the track share the CSS pixels of the view document: the root view of the
    // surface keeps page zoom 1 and the view sets no CSS zoom, because the terminal follows the text size with its font size
    // (docs/spec/acceptance.md). The grab is the distance from the top of the thumb to the pointer.
    thumbDrag = { pointerId: event.pointerId, grab: event.clientY - scrollbar.thumb.getBoundingClientRect().top, sent: null };
    // 끄는 동안 손잡이는 쥔 손 포인터를 보인다.
    scrollbar.thumb.dataset.dragging = "";
    scrollbar.thumb.setPointerCapture(event.pointerId);
  };
  const moveThumb = (event) => {
    if (!thumbDrag || event.pointerId !== thumbDrag.pointerId) return;
    event.preventDefault();
    const { rows, scrollback: { history } } = session;
    const track = scrollbar.track.getBoundingClientRect();
    const top = event.clientY - track.top - thumbDrag.grab;
    const offset = Math.min(history, Math.max(0, Math.round(history - top / track.height * (rows + history))));
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
  // The start parameters of the tab name the program of the session (core docs/spec/agent-roles.md#start-parameters). Without a
  // program the session opens the shell of the shell setting, and with a program the shell setting is not read.
  const launch = launchOf(tab.params);
  const shell = launch.program === null ? settings.read().shell : null;
  if (launch.program === null && (typeof shell !== "string" || shell.length === 0)) throw new Error("terminal shell setting is missing");
  const target = launch.program === null ? { shell } : { program: launch.program, args: launch.args };
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
    runtime.log.info("session.open", { ...target, directory: working });
    return terminal.send(id, { operation: "open", image: "view", ...target,
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
    // Restore semantic demand before the fresh read; raster visibility does
    // not determine whether a public screen watcher observes engine output.
    try { await updateScreenWatch(); } catch (error) {
      // An ended registration cancels this bootstrap before its fresh read.
      if (error.name === "AbortError") return;
      throw error;
    }
    // The view holds no screen of the session it opens or reattaches to, so it reads the full form.
    await readScreen();
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

  // The reads that wait for the full form of the screen.
  const screenReads = new Set();
  // The result of applyScreenMessage for the last applied screen message, which a change applies to
  // (docs/spec/persistent-services.md#screen-message in core).
  let heldScreen = null;
  // Set from a screen read of the view until the full form that answers it: a change before it does not follow the screen that
  // the view holds and is refused.
  let screenReadAwaited = false;
  const readScreen = () => {
    screenReadAwaited = true;
    return terminal.send(id, { operation: "screen.read" }).catch((error) => {
      screenReadAwaited = false;
      throw error;
    });
  };
  // The range reads of terminal.screen.rows. Each read sends one correlation identifier, and the sidecar names it in its answer:
  // the screen.rows event of the range, or the refusal {error, reason} of a range outside the retained rows.
  const rangeReads = new Set();
  let rangeReadSequence = 0;
  const rangeRead = (screen, from, count) => new Promise((resolve, reject) => {
    const entry = { screen, from, count, cid: `${unansweredPrefix}-screen-rows-${++rangeReadSequence}`, resolve, reject };
    rangeReads.add(entry);
    terminal.send(id, { operation: "screen.read", screen, from, count }, [entry.cid]).catch((error) => {
      rangeReads.delete(entry);
      reject(error);
    });
  });
  // Ends the range read that the answer names, and returns whether one did.
  const answerRangeRead = (body, cids) => {
    const entry = [...rangeReads].find((read) => cids.includes(read.cid));
    if (entry === undefined) return false;
    rangeReads.delete(entry);
    if (body.error) {
      entry.reject(new Error(`terminal.screen.rows: ${body.error}: ${body.reason ?? "screen.read failed"}`));
    } else if (body.event !== "screen.rows" || body.screen !== entry.screen || body.from !== entry.from || body.count !== entry.count ||
      !Array.isArray(body.rows)) {
      entry.reject(new Error(`terminal.screen.rows received a mismatched answer: ${JSON.stringify({ event: body.event, screen: body.screen, from: body.from, count: body.count })}`));
    } else {
      entry.resolve(body.rows);
    }
    return true;
  };
  // The scroll reads of terminal.screen.scroll.read (core docs/spec/terminal-read.md#program-scroll). Each read sends one
  // correlation identifier, and the sidecar names it in its answer: the screen.scroll event or the error that ended the read.
  const scrollReads = new Set();
  let scrollReadSequence = 0;
  const scrollRead = (by, quiet) => new Promise((resolve, reject) => {
    const entry = { cid: `${unansweredPrefix}-screen-scroll-${++scrollReadSequence}`, resolve, reject };
    scrollReads.add(entry);
    terminal.send(id, { operation: "screen.scroll.read", by, quiet }, [entry.cid]).catch((error) => {
      scrollReads.delete(entry);
      reject(error);
    });
  });
  // Ends the scroll read that the answer names, and returns whether one did.
  const answerScrollRead = (body, cids) => {
    const entry = [...scrollReads].find((read) => cids.includes(read.cid));
    if (entry === undefined) return false;
    scrollReads.delete(entry);
    if (body.error) {
      entry.reject(new Error(`terminal.screen.scroll.read: ${body.error}: ${body.reason ?? "screen.scroll.read failed"}`));
      return true;
    }
    const failure = scrollReplyError(body);
    if (failure !== null) {
      entry.reject(new Error(`terminal.screen.scroll.read received an invalid reply: ${failure}`));
      return true;
    }
    const { event, ...reply } = body;
    // A read that did not restore the screen leaves the program elsewhere, which the session shows until a read restores it.
    if (reply.restored) {
      if (resolveError("scroll")) changed("session");
    } else {
      setError("scroll", `terminal scroll read did not restore the screen: the first row was ${JSON.stringify(reply.first.before)} and is ${JSON.stringify(reply.first.after)}`);
      changed("session");
    }
    entry.resolve(reply);
    return true;
  };
  // The reads of terminal.process.list (core docs/spec/process-list.md#request). Each read sends one correlation identifier, and
  // the sidecar names it in its answer: the process.list event or its error.
  const processReads = new Set();
  let processReadSequence = 0;
  const processRead = () => new Promise((resolve, reject) => {
    const entry = { cid: `${unansweredPrefix}-process-list-${++processReadSequence}`, resolve, reject };
    processReads.add(entry);
    terminal.send(id, { operation: "process.list" }, [entry.cid]).catch((error) => {
      processReads.delete(entry);
      reject(error);
    });
  });
  // Ends the process list read that the answer names, and returns whether one did.
  const answerProcessRead = (body, cids) => {
    const entry = [...processReads].find((read) => cids.includes(read.cid));
    if (entry === undefined) return false;
    processReads.delete(entry);
    if (body.error) {
      entry.reject(new Error(`terminal.process.list: ${body.error}`));
      return true;
    }
    const failure = body.event !== "process.list" || !("foreground" in body) ? JSON.stringify({ event: body.event }) : processListError(body);
    if (failure !== null) {
      entry.reject(new Error(`terminal.process.list received an invalid reply: ${failure}`));
      return true;
    }
    entry.resolve({ foreground: body.foreground, background: body.background });
    return true;
  };
  // The messages of the terminal (core docs/spec/messaging.md#folder-of-a-terminal). The page registers the folder
  // <root>/.soksak/messages/<surface> of the project of its start values with the sidecar, which creates it, and terminal.messages
  // is the registration of the reply; a window without a project registers no folder. The registration and the reads of
  // terminal.messages.read and terminal.messages.wait each send one correlation identifier, which their reply names.
  const messagesFolder = project === null ? null : `${project.root}/.soksak/messages/${id}`;
  let messagesStatus = null;
  const messagesPrefix = `${unansweredPrefix}-messages-`;
  const messagesRequests = new Map();
  let messagesSequence = 0;
  // The reply calls resolve or reject while the page handles it, so the status of a registration changes with its reply.
  const messagesRequest = (name, operation, body, resolve, reject) => {
    const cid = `${messagesPrefix}${++messagesSequence}`;
    messagesRequests.set(cid, { name, resolve, reject });
    terminal.send(id, { operation, ...body }, [cid]).catch((error) => {
      messagesRequests.delete(cid);
      reject(error);
    });
  };
  // Ends the messages request that the reply names, and returns whether the reply names a messages request. A reply of a request
  // that ended already answers no request and is recorded.
  const answerMessages = (body, cids) => {
    const cid = cids.find((item) => item.startsWith(messagesPrefix));
    if (cid === undefined) return false;
    const entry = messagesRequests.get(cid);
    if (entry === undefined) {
      runtime.log.debug("messages.unmatched", { refused: typeof body.error === "string" }, { cids });
      return true;
    }
    messagesRequests.delete(cid);
    if (entry.input) {
      // The reply of an injected input ends that input as the reply of any input does, and the delivery judges its body.
      const held = unanswered.find((item) => item.cids.includes(cid));
      if (held !== undefined) forgetInput(held);
      entry.resolve(body);
    } else if (typeof body.error === "string") entry.reject(new Error(`${entry.name}: ${body.error}: ${body.reason}`));
    else entry.resolve(body);
    return true;
  };
  // The sidecar ends the requests of a connection that ended without a reply (core docs/spec/messaging.md#wire-decisions, point 7),
  // so the end of the connection or the close of the view ends each request that waits. The close of the view is an AbortError,
  // which the registration does not report.
  const endMessagesRequests = (cause, aborted = false) => {
    const ended = [...messagesRequests.values()];
    messagesRequests.clear();
    for (const { name, reject } of ended) {
      reject(aborted ? new DOMException(`${name}: ${cause}`, "AbortError") : new Error(`${name}: ${cause}`));
    }
  };
  const setMessages = (value) => {
    if (messagesStatus === value) return;
    messagesStatus = value;
    changed("messages");
  };
  // A repeated registration of the same folder answers the same registration (core docs/spec/messaging.md#wire-decisions, point 10),
  // so the page registers at each connection of its sidecar port.
  const registerMessages = () => {
    if (messagesFolder === null) return;
    const refused = (error) => {
      if (error.name !== "AbortError") setError("messages", error.message);
    };
    messagesRequest("terminal.messages", "messages.register", { folder: messagesFolder }, (reply) => {
      if (typeof reply.registration !== "string" || reply.registration === "" || reply.folder !== messagesFolder) {
        refused(new Error(`terminal.messages received a mismatched reply: ${JSON.stringify({ registration: reply.registration, folder: reply.folder })}`));
        return;
      }
      if (resolveError("messages")) changed("session");
      messagesDelivery.attach(reply.folder, reply.registration);
    }, refused);
  };
  // The reads take the cursor {after, registration} and send the members that are present; the sidecar checks their values.
  const readMessages = (name, params) => {
    const values = params ?? {};
    const other = Object.keys(values).find((key) => key !== "after" && key !== "registration");
    if (other !== undefined) throw new Error(`terminal.messages.${name} takes only after and registration, got ${other}`);
    const { after, registration } = values;
    return new Promise((resolve, reject) => messagesRequest(`terminal.messages.${name}`, `messages.${name}`,
      { ...(after === undefined ? {} : { after }), ...(registration === undefined ? {} : { registration }) }, resolve, reject));
  };
  // The injection of the messages of the registration (core docs/spec/messaging.md#injected-message). The page injects the message of
  // each created or modified file event in increasing seq, one at a time, as the paste of `[soksak message from <title> (<folder>): <framing>] <text>` and then Enter,
  // each after the reply of the input before it, and holds the injection by the reasons of the hold in their order. terminal.messages
  // is {folder, registration, held, last}, and each decision and each change of the hold is a record of the event log.
  const ENTER = Object.freeze({ type: "key", key: "Enter", shift: false, alt: false, ctrl: false });
  // Sends one input through the input queue and resolves with its reply, an acknowledgement or an error. The reply is matched
  // by the correlation identifier of the request as the replies of the messages requests are.
  const answeredInput = (name, entry) => new Promise((resolve, reject) => {
    const cid = `${messagesPrefix}${++messagesSequence}`;
    messagesRequests.set(cid, { name, resolve, reject, input: true });
    enqueueInput(entry, [cid], true).catch((error) => {
      messagesRequests.delete(cid);
      reject(error);
    });
  });
  // Submits a line as a program receives a pasted line and its submit key (docs/spec/submit.md, core
  // docs/spec/messaging.md#injected-message): the text through the paste operation, which the sidecar brackets when the program
  // enabled bracketed paste mode, and Enter as a separate input after the reply of the paste, so a program that takes fast typed
  // text as a paste does not take the Enter as a new line of its input. Resolves with the reply that refused an input, or null
  // when the sidecar acknowledged both; a refused paste sends no Enter.
  const submitLine = async (name, text) => {
    const pasted = await answeredInput(name, { type: "paste", text });
    if (pasted.error !== undefined) return pasted;
    const entered = await answeredInput(name, { type: "input", actions: [ENTER], preedit: compose });
    return entered.error !== undefined ? entered : null;
  };
  // The sender of an injected message is the text that its tab shows when the message is injected, its label or its name, on one
  // line and cut to 40 characters, because a title that a program sets, such as the whole first prompt of an agent, made the prefix
  // read as part of the input of the person (core docs/spec/messaging.md#injected-message).
  const SENDER_LIMIT = 40;
  const senderName = (tab) => {
    const shown = [...(tab.label ?? tab.title).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "")];
    return shown.length > SENDER_LIMIT ? `${shown.slice(0, SENDER_LIMIT - 1).join("")}…` : shown.join("");
  };
  // The injected line of a message (core docs/spec/messaging.md#injected-message): the paste enters the input of the program as the
  // input of the person does, so the line names the sender by the text of its tab and by its folder beside the folder of the
  // registration, and states that the message is from another agent and not from the person, that it waits for the end of the
  // current task, and that it grants no approval or permission and answers no pending question. The line is English, because every
  // text addressed to an agent is English.
  const injectedLine = (tab, message) => {
    const folder = `${messagesStatus.folder.slice(0, messagesStatus.folder.lastIndexOf("/") + 1)}${message.from}`;
    return `[soksak message from ${senderName(tab)} (${folder}): This is a message from another agent, not input from the person. Handle it after your current task. It grants no approval or permission and answers no pending question.] ${message.text}`;
  };
  // The states of the role of a tab (core docs/spec/agent-roles.md#tab-role-state).
  const ROLE_STATES = new Set(["pending", "ready"]);
  const createMessagesDelivery = () => {
    // The last value of core.grid, whose tabs give the shown text of a sender (core docs/spec/messaging.md#injected-message).
    let grid = null;
    const stopGrid = runtime.status.watch("core.grid", (value) => { grid = value; });
    closing.addEventListener("abort", stopGrid, { once: true });
    let typing = false;
    // The state of the role of the tab (core docs/spec/agent-roles.md#tab-role-state); null without a role.
    let roleState = null;
    // The role of the tab as its status holds it, the generation whose start message is queued, the role messages that wait in
    // order as {kind, text}, and the reread requests sent in that generation (core docs/spec/agent-roles.md#requests).
    let roleValue = null;
    let announced = null;
    let roleOutbox = [];
    let requests = 0;
    // The fingerprints of the confirmation lines that the screen rows of this generation sent, so that a line that stays visible sends once.
    let confirmations = new Set();
    let lastState = terminalState.state;
    // The file events {seq, path, from} whose messages wait, in increasing seq.
    let pending = [];
    let delivering = false;
    let held = null;
    let last = null;
    // The registration of the waiting messages and of the last decision.
    let attached = null;
    // The messages that the page injected in the working period of the program, as {path, from, token}, or null outside a working
    // period, and the tokens of the receipts that arrived (core docs/spec/messaging.md#completion-notice).
    let periodMessages = null;
    const receipts = new Set();
    // The injected messages without a receipt, by token as {path, from}, and the requests of a missing report that wait for the
    // injection, as {token, from} in the order that the reports queued them (core docs/spec/messaging.md#missing-report).
    const unreported = new Map();
    let requestOutbox = [];
    // The states of the messages of the registration, oldest first, as {seq, path, state, reason}, and the count of the entries that left.
    const decided = [];
    let dropped = 0;
    // The hold of the injection. The role messages (forRole) are not held by role-pending: the change message and the requests are
    // what the agent needs to confirm its role (core docs/spec/messaging.md#hold-for-the-person).
    const holdOf = (forRole = false) => {
      const blocked = programStatus.records.find((record) => record.state === "blocked");
      if (blocked !== undefined) return { reason: "blocked", kind: blocked.kind };
      if (programStatus.records.length === 0 && programStatus.notice) return { reason: "notice", kind: null };
      if (compose.text !== "") return { reason: "composition", kind: null };
      if (typing) return { reason: "typing", kind: null };
      if (session.inputHeld !== null) return { reason: "input-held", kind: null };
      if (!forRole && roleState === "pending") return { reason: "role-pending", kind: null };
      return null;
    };
    const snapshotDecided = () => decided.map(({ path, state, reason }) => ({ path, state, reason }));
    const publish = () => {
      if (messagesStatus === null) return;
      setMessages({ folder: messagesStatus.folder, registration: messagesStatus.registration, held, last, decided: snapshotDecided(), dropped });
    };
    // Sets the state of the entry of a message, which is made at its first state (held or a decision) and kept to the limit.
    const upsert = (event, state, reason) => {
      const entry = decided.find((item) => item.seq === event.seq);
      if (entry !== undefined) {
        entry.state = state;
        entry.reason = reason;
        return;
      }
      decided.push({ seq: event.seq, path: event.path, state, reason });
      if (decided.length > DECIDED_LIMIT) {
        decided.shift();
        dropped += 1;
      }
    };
    // Decides the delivery of a message: the entry takes the state, reported when the receipt of its token arrived before it, and
    // the last decision and its record name the kind message (core docs/spec/messaging.md#delivery).
    const decide = (event, state, reason) => {
      const final = state === "delivered" && receipts.has(tokenOf(event.path)) ? "reported" : state;
      upsert(event, final, reason);
      last = { kind: "message", seq: event.seq, path: event.path, from: event.from, state: final, reason };
      runtime.log.info("messages.delivered", last);
      publish();
    };
    // Decides the delivery of a refused input; an error other than the guard is shown through the error display.
    const refusedBy = (event, reply) => {
      if (reply.error === "guardRefused") {
        decide(event, "refused", `guardRefused: ${reply.rule}: ${reply.reason}`);
        return;
      }
      const cause = typeof reply.reason === "string" ? `${reply.error}: ${reply.reason}` : String(reply.error);
      setError("messages", `terminal.messages: ${event.path}: ${cause}`);
      decide(event, "refused", cause);
    };
    const deliver = async (event) => {
      const reply = await readMessages("read", { after: event.seq - 1, registration: messagesStatus.registration });
      const message = reply.messages.find((item) => item.seq === event.seq);
      if (message === undefined) {
        decide(event, "skipped", `message ${event.seq} is not in the folder`);
        return;
      }
      const tab = (grid?.cards ?? []).flatMap((card) => card.tabs).find((item) => item.id === message.from);
      if (tab === undefined) {
        decide(event, "refused", `sender ${message.from} has no tab in the window`);
        return;
      }
      // A hold that started while the page read the message keeps it waiting.
      const blockedBy = holdOf();
      if (blockedBy !== null) {
        upsert(event, "held", blockedBy.reason);
        publish();
        pending.unshift(event);
        return;
      }
      const refused = await submitLine("terminal.messages.inject", injectedLine(tab, message));
      if (refused !== null) {
        refusedBy(event, refused);
        return;
      }
      decide(event, "delivered", null);
      const token = tokenOf(event.path);
      if (!receipts.has(token)) unreported.set(token, { path: event.path, from: event.from });
      if (periodMessages !== null) periodMessages.push({ path: event.path, from: event.from, token });
    };
    // Injects one role message: the text as it is, followed by Enter (core docs/spec/agent-roles.md#change-message).
    const deliverRole = async (entry) => {
      const refused = await submitLine("terminal.messages.inject", entry.text);
      if (refused !== null) {
        const cause = typeof refused.reason === "string" ? `${refused.error}: ${refused.reason}` : String(refused.error);
        setError("messages", `terminal.messages: ${entry.kind}: ${cause}`);
        return;
      }
      runtime.log.info("messages.role.delivered", entry.fields);
    };
    // Sends the confirmation of a screen row that holds the line `soksak role <fingerprint>` (core docs/spec/agent-roles.md#confirmation).
    // The core judges the fingerprint. A stale refusal is an outcome of a change that raced the confirmation: it is recorded, and the
    // next not-busy report sends the reread request again. Any other refusal is an error.
    const confirm = (fingerprint) => {
      runtime.command.run("core.tab.role.confirm", { fingerprint }, id).catch((error) => {
        if (isStaleConfirmation(error.message)) {
          runtime.log.info("messages.role.stale", { fingerprint, current: roleValue?.fingerprint ?? null });
          return;
        }
        setError("messages", `terminal.messages: confirm: ${error.message}`);
      });
    };
    const confirmVisibleLines = () => {
      if (roleValue === null || roleValue.state !== "pending") return;
      for (const row of screen) {
        const text = row.map((cell) => cell.ch ?? " ").join("");
        const fingerprint = confirmationLine(text);
        if (fingerprint === null || confirmations.has(fingerprint)) continue;
        confirmations.add(fingerprint);
        confirm(fingerprint);
      }
    };
    // Injects the request of a missing report (core docs/spec/messaging.md#missing-report) unless the receipt of its token arrived after
    // the report that queued it. Its decision is a record of kind report-request, with no file, and a refusal by the guard is its state.
    const deliverRequest = async ({ token, from }) => {
      const record = (state, reason) => {
        last = { kind: "report-request", seq: null, path: null, from: "soksak", state, reason };
        runtime.log.info("messages.delivered", last);
        publish();
      };
      if (receipts.has(token)) {
        record("skipped", "a receipt of the token arrived");
        return;
      }
      const folder = `${messagesStatus.folder.slice(0, messagesStatus.folder.lastIndexOf("/") + 1)}${from}`;
      const text = `[soksak request] Message ${token} has no report yet. Report its result with sok message send --reply ${folder} --answers ${token} "<report>". This request is from the application, not input from the person.`;
      const refused = await submitLine("terminal.messages.request", text);
      if (refused === null) {
        record("delivered", null);
        return;
      }
      if (refused.error === "guardRefused") {
        record("refused", `guardRefused: ${refused.rule}: ${refused.reason}`);
        return;
      }
      const cause = typeof refused.reason === "string" ? `${refused.error}: ${refused.reason}` : String(refused.error);
      setError("messages", `terminal.messages: ${folder}: ${cause}`);
      record("refused", cause);
    };
    // Sends one notice per message of the period to its sender through the sidecar (core docs/spec/messaging.md#completion-notice).
    // The title is the text of the receiving tab, and the report flag is set when the receipt of the token arrived.
    const sendNotices = (state, messages) => {
      const self = (grid?.cards ?? []).flatMap((card) => card.tabs).find((item) => item.id === id);
      if (self === undefined) {
        setError("messages", `terminal.messages: notice: the tab ${id} is not in core.grid`);
        return;
      }
      const title = senderName(self);
      for (const message of messages) {
        const reported = receipts.has(message.token);
        messagesRequest("terminal.messages.notice", "messages.notice", { title, answers: message.token, from: message.from, state, reported },
          (reply) => runtime.log.info("messages.notice", { path: reply.path, from: message.from, token: message.token, state, reported }),
          (error) => {
            if (error.name !== "AbortError") setError("messages", `terminal.messages: ${message.path}: ${error.message}`);
          });
      }
    };
    const deliverNext = () => {
      if (delivering || messagesStatus === null) return;
      // The program reported its first state (the read of program.status) before a role message is injected.
      if (roleOutbox.length > 0 && programStatus !== PROGRAM_BEFORE_READ && holdOf(true) === null) {
        const entry = roleOutbox.shift();
        delivering = true;
        deliverRole(entry).catch((error) => {
          if (error.name !== "AbortError") setError("messages", error.message);
        }).finally(() => {
          delivering = false;
          review();
        });
        return;
      }
      if (requestOutbox.length > 0 && holdOf() === null) {
        const request = requestOutbox.shift();
        delivering = true;
        deliverRequest(request).catch((error) => {
          if (error.name !== "AbortError") setError("messages", error.message);
        }).finally(() => {
          delivering = false;
          review();
        });
        return;
      }
      if (pending.length === 0 || holdOf() !== null) return;
      delivering = true;
      deliver(pending.shift()).catch((error) => {
        if (error.name !== "AbortError") setError("messages", error.message);
      }).finally(() => {
        delivering = false;
        review();
      });
    };
    // Follows the statuses that the hold reads: the hold of terminal.messages, the record of each start, change and end of the
    // hold, and the injection of the waiting messages when no hold applies.
    const review = () => {
      if (terminalState.state === "idle" && lastState !== "idle") typing = false;
      lastState = terminalState.state;
      if (messagesStatus === null) return;
      const hold = holdOf();
      const next = hold === null ? null : { ...hold, pending: pending.length };
      if ((held?.reason ?? null) !== (next?.reason ?? null) || (held?.kind ?? null) !== (next?.kind ?? null)) {
        runtime.log.info("messages.held", next ?? { reason: null, kind: null, pending: pending.length });
      }
      if (JSON.stringify(next) !== JSON.stringify(held)) {
        held = next;
        publish();
      }
      deliverNext();
    };
    // A new generation of the role queues its start message: the first message at the first generation, and the change message
    // otherwise (core docs/spec/agent-roles.md#resume). The message names the path of the status.
    const announceRole = (value) => {
      if (value === null) {
        announced = null;
        roleOutbox = [];
        requests = 0;
        confirmations = new Set();
        return;
      }
      if (value.state !== "pending" || value.generation === announced || launch.program === null) return;
      if (typeof value.path !== "string") {
        setError("messages", "terminal.messages: core.tab.role has no path of the role file");
        return;
      }
      announced = value.generation;
      requests = 0;
      confirmations = new Set();
      roleOutbox = [];
      const kind = value.generation === 1 ? "role-first" : "role-change";
      const text = kind === "role-first" ? firstMessage(value.path) : changeMessage(value.path);
      roleOutbox.push({ kind, text, fields: { kind } });
    };
    // Each report of the program that is at rest sends one reread request while the role is pending, and the count of the requests
    // of the generation is recorded with it (core docs/spec/agent-roles.md#requests).
    const programReport = (next) => {
      if (roleValue === null || roleValue.state !== "pending" || !isAtRest(next)) return;
      requests += 1;
      roleOutbox.push({ kind: "role-reread", text: rereadRequest(roleValue.path, roleValue.fingerprint), fields: { kind: "role-reread", requests } });
      review();
    };
    const stopRole = runtime.status.watch("core.tab.role", (value) => {
      if (value !== null && (typeof value !== "object" || !ROLE_STATES.has(value.state))) {
        setError("messages", `terminal.messages: invalid core.tab.role state: ${JSON.stringify(value?.state)}`);
        return;
      }
      roleValue = value;
      roleState = value === null ? null : value.state;
      announceRole(value);
      confirmVisibleLines();
      review();
    });
    closing.addEventListener("abort", stopRole, { once: true });
    return {
      review,
      // A registration other than the one before starts its own seq, so the waiting messages and the last decision end with it.
      attach(folder, registration) {
        if (registration !== attached) {
          attached = registration;
          pending = [];
          last = null;
          decided.length = 0;
          dropped = 0;
          unreported.clear();
          receipts.clear();
          requestOutbox = [];
        }
        setMessages({ folder, registration, held, last, decided: snapshotDecided(), dropped });
        review();
      },
      fileChanged(body) {
        if (messagesStatus === null || body.registration !== messagesStatus.registration) return;
        if (body.kind !== "created" && body.kind !== "modified") return;
        const token = tokenOf(body.path);
        if (token.startsWith(RECEIPT_PREFIX)) {
          // A receipt answers the report request of its token, so the page takes it and injects nothing (core docs/spec/messaging.md#report-request).
          const answered = token.slice(RECEIPT_PREFIX.length);
          receipts.add(answered);
          unreported.delete(answered);
          // The entry of the message takes the state reported, and the receipt is the last decision of kind receipt.
          const entry = decided.find((item) => tokenOf(item.path) === answered);
          if (entry !== undefined) entry.state = "reported";
          last = { kind: "receipt", seq: body.seq, path: body.path, from: body.from, state: "reported", reason: null };
          runtime.log.info("messages.delivered", last);
          publish();
          return;
        }
        pending.push({ seq: body.seq, path: body.path, from: body.from });
        // A message that arrives while a hold applies is held with the reason of the hold (core docs/spec/messaging.md#delivery).
        const blockedBy = holdOf();
        if (blockedBy !== null) {
          upsert(body, "held", blockedBy.reason);
          publish();
        }
        review();
      },
      typed(on) {
        typing = on;
        review();
      },
      programReport,
      // Opens a working period at the first working record and ends it at the first change to another state, when the notices of the
      // messages injected in the period are sent (core docs/spec/messaging.md#completion-notice).
      // Each at-rest report of the program queues the request of a missing report for each injected message without a receipt.
      requestsFor(next) {
        if (!isAtRest(next)) return;
        for (const [token, { from }] of unreported) requestOutbox.push({ token, from });
        review();
      },
      programChanged(next) {
        const working = next.records.some((record) => record.state === "working");
        if (working && periodMessages === null) periodMessages = [];
        if (working || periodMessages === null) return;
        const ended = periodMessages;
        periodMessages = null;
        sendNotices(endStateOf(next.records), ended);
      },
      screenChanged: confirmVisibleLines,
    };
  };
  if (messagesFolder !== null) messagesDelivery = createMessagesDelivery();
  let screenWatchEnabled = false;
  let screenWatchRegistered = false;
  let screenWatchConnected = true;
  let screenWatchPending = Promise.resolve();
  let screenWatchRequest = null;
  let screenWatchSequence = 0;
  let screenWatchDisposed = false;
  const reportScreenWatchError = (error) => {
    if (error.name !== "AbortError") reportInputError(error, "screen");
  };
  const endScreenWatchRequest = (error) => {
    if (!screenWatchRequest) return;
    const pending = screenWatchRequest;
    screenWatchRequest = null;
    if (error) pending.reject(error);
    else pending.resolve();
  };
  const updateScreenWatch = () => {
    const enabled = watchers.screen.size > 0 && !screenWatchDisposed;
    if (!screenWatchConnected || enabled === screenWatchEnabled) return screenWatchPending;
    screenWatchEnabled = enabled;
    screenWatchRegistered = false;
    endScreenWatchRequest(new DOMException("screen watch superseded", "AbortError"));
    // sidecar.send completes transport, not the semantic reply. A call has no time limit (core docs/spec/plugin-processes.md, rule
    // 3): the CID-correlated acknowledgement, a failed send, the sidecar-failure of the surface, a connection event, an exit or the
    // next transition ends this one.
    screenWatchPending = new Promise((resolve, reject) => {
      const cid = `${unansweredPrefix}-screen-watch-${++screenWatchSequence}`;
      const pending = { cid, enabled, resolve, reject };
      screenWatchRequest = pending;
      terminal.send(id, { operation: "screen.watch", enabled }, [cid]).catch((error) => {
        if (screenWatchRequest === pending) endScreenWatchRequest(error);
      });
    });
    return screenWatchPending;
  };
  const closeScreenWatch = () => {
    screenWatchDisposed = true;
    updateScreenWatch().catch(reportScreenWatchError);
  };
  closing.addEventListener("abort", closeScreenWatch, { once: true });
  // A semantic change or view event during a read requires a trailing read.
  let screenReadAgain = false;
  // Read on semantic invalidation and on view changes, only while watched.
  // An invalidation carries no raster identity or presentation assertion.
  const followScreen = () => {
    if (watchers.screen.size === 0 || !sessionOpen || screenWatchDisposed || !screenWatchRegistered) return;
    if (screenReadAwaited) {
      screenReadAgain = true;
      return;
    }
    readScreen().catch((error) => reportInputError(error, "screen"));
  };
  const watchScreen = (fn) => {
    const stop = watch("screen")(fn);
    updateScreenWatch().then(followScreen).catch(reportScreenWatchError);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      stop();
      updateScreenWatch().catch(reportScreenWatchError);
    };
  };
  // Resolves with the full form that answers a read of its own. The answer, a failed send, the sidecar-failure of the surface, a
  // connection event or the close of the view ends the wait (endSidecarWaits).
  const awaitScreen = () => new Promise((resolve, reject) => {
    const entry = { resolve, reject };
    screenReads.add(entry);
    readScreen().catch((error) => {
      screenReads.delete(entry);
      reject(error);
    });
  });
  // The current value of the status: the sidecar holds the screen, and the view holds only the rows of its last read.
  const currentScreen = async () => {
    if (!sessionOpen || session.exited) return screen;
    return (await awaitScreen()).rows;
  };
  // pty.pending 측정 응답을 기다리는 resolver. 진단 명령이 한 번에 하나만 요청하고, 다음 요청은 이전 요청을 끝낸다.
  let pendingPtyRead = null;
  // The requests that a later request replaced and that the sidecar still answers, in their order: the sidecar answers the
  // pty.pending requests in the order that they were sent, so the next answer is the answer of the first of them.
  const replacedPtyReads = [];

  // Ends each wait for a reply of the sidecar: the reads of the screen and the pty.pending measurement with error. The
  // acknowledgement of screen.watch ends where its state changes.
  const endSidecarWaits = (error) => {
    const reads = [...screenReads];
    screenReads.clear();
    for (const entry of reads) entry.reject(error);
    const ranges = [...rangeReads];
    rangeReads.clear();
    for (const entry of ranges) entry.reject(error);
    const processes = [...processReads];
    processReads.clear();
    for (const entry of processes) entry.reject(error);
    const waiter = pendingPtyRead;
    pendingPtyRead = null;
    waiter?.reject(error);
    // The requests of the ended connection receive no answer.
    replacedPtyReads.length = 0;
  };
  // A sidecar that ended answers none of the requests of the surface (core docs/spec/plugin-processes.md, rule 3). The watch is
  // registered with that sidecar no more, so a new connection restores it.
  const stopFailure = await terminal.onFailure(id, (reason) => {
    const error = new Error(`the sidecar ended before it answered: ${reason}`);
    screenWatchRegistered = false;
    screenWatchEnabled = false;
    endScreenWatchRequest(error);
    screenWatchPending = Promise.resolve();
    screenReadAwaited = false;
    screenReadAgain = false;
    endSidecarWaits(error);
    endMessagesRequests("the sidecar connection ended");
    setMessages(null);
  });
  const closeMessagesRequests = () => endMessagesRequests("the view closed", true);
  closing.addEventListener("abort", closeMessagesRequests, { once: true });
  // The close of the view ends the waits that no event of the detached view answers. The disable acknowledgement of the watch is
  // still matched, because its listener runs before the guard of the closed view.
  const closeSidecarWaits = () => endSidecarWaits(new DOMException("the view closed", "AbortError"));
  closing.addEventListener("abort", closeSidecarWaits, { once: true });

  // 사이드카 메시지 수신
  const stopSidecar = await terminal.on(id, (body, cids) => {
    // A close can be waiting for its disable ACK after the view aborts.
    // Match this request before the detached-view guard; ignore late CIDs.
    if (screenWatchRequest && (cids ?? []).includes(screenWatchRequest.cid)) {
      if (body.error) {
        endScreenWatchRequest(new Error(`${body.error}: ${body.reason ?? "screen.watch failed"}`));
      } else if (body.event !== "screen.watching" || body.enabled !== screenWatchRequest.enabled) {
        endScreenWatchRequest(new Error("screen.watch received a mismatched acknowledgement"));
      } else {
        screenWatchRegistered = body.enabled;
        endScreenWatchRequest();
      }
      return;
    }
    // The regions detach at the removal; an event after it would operate on a detached region.
    if (closing.aborted) return;
    if (answerRangeRead(body, cids ?? [])) return;
    if (answerScrollRead(body, cids ?? [])) return;
    if (answerProcessRead(body, cids ?? [])) return;
    if (answerMessages(body, cids ?? [])) return;
    if (body.event === "exit") {
      screenWatchConnected = false;
      screenWatchEnabled = false;
      screenWatchRegistered = false;
      endScreenWatchRequest(new DOMException("screen watch session ended", "AbortError"));
      screenWatchPending = Promise.resolve();
    }
    // An answer names the cids of its request: an acknowledgement, a refusal or an error, each of which ends the wait for it.
    for (const cid of cids ?? []) {
      const held = unanswered.find((item) => item.cids.includes(cid));
      if (held !== undefined) forgetInput(held);
    }
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
        // A state event names a running session. It also follows a reconnect and a resize, so it
        // keeps the held input, which the sidecar reports when it changes and at a reconnect.
        exited: false,
      };
      resolveError("state");
      // A state event follows a resize and carries the rows, which the thumb shows.
      drawScrollbar();
      if (body.cursor !== undefined) applyCursor(body.cursor, { ...body.cursor, frame: null, render: null, caret: null, preedit: body.cursor.preedit ?? null });
      openSessionGate("state");
    } else if (body.event === "session") {
      if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
        reportInputError("invalid persistent session event", "session");
        return;
      }
      session = { ...session, sessionId: body.sessionId, exited: false };
      resolveError("session");
      // A preserved session answers a reattached surface with this event, so the input that waited during the
      // reconnection flows now.
      openSessionGate("session");
    } else if (body.event === "connection") {
      screenWatchConnected = body.connected === true;
      screenWatchRegistered = false;
      endScreenWatchRequest(new DOMException("screen watch connection ended", "AbortError"));
      screenWatchEnabled = false;
      screenWatchPending = Promise.resolve();
      screenReadAwaited = false;
      screenReadAgain = false;
      endSidecarWaits(new Error("the sidecar connection changed before it answered"));
      endMessagesRequests("the sidecar connection ended");
      setMessages(null);
      // 영속 사이드카의 연결이 다시 맺혔다(V5-106). 이전 연결이 남긴 사이드카 오류는
      // 해소하고 세션을 다시 연다 — 재스폰된 서비스에는 이 표면의 세션이 없다. 실패했으면
      // 연결 끊김과 그 까닭을 세션 오류로 남긴다. 입력은 다시 열릴 때까지 대기열에 쌓인다.
      sessionOpen = false;
      runtime.log.info("session.gate", { open: false, event: "connection", connected: body.connected });
      if (body.connected === true) {
        sessionFailure = null;
        const resolved = resolveError("open");
        if (resolveError("sidecar") || resolved) changed("session");
        rerunBootstrap().catch((error) => reportInputError(error));
        registerMessages();
      } else {
        const reason = typeof body.reason === "string" && body.reason.length > 0 ? `: ${body.reason}` : "";
        // The sidecar sends no held:false for a connection that ended, so the held input is cleared here.
        session = { ...session, inputHeld: null };
        setError("sidecar", `sidecar connection failed${reason}`);
        failSession(`sidecar connection failed${reason}`);
      }
    } else if (body.event === "screen.rows") {
      runtime.log.debug("screen.rows.unmatched", { from: body.from, count: body.count });
    } else if (body.event === "screen.changed") {
      followScreen();
    } else if (body.event === "screen.watching") {
      // A late acknowledgement of an ended transition owns no current state.
    } else if (body.event === "file.changed") {
      // A message of the registered folder changed. The reads of terminal.messages.read and terminal.messages.wait deliver it, and
      // the delivery injects it.
      messagesDelivery?.fileChanged(body);
    } else if (body.event === "registration.closed") {
      if (messagesStatus !== null && body.registration === messagesStatus.registration) setMessages(null);
      setError("messages", `terminal.messages: registration-closed: ${body.reason}`);
    } else if (body.event === "screen") {
      if (body.base === false && screenReadAwaited) {
        runtime.log.debug("screen.refused", { number: body.number, previous: body.previous });
        return;
      }
      // 진단 command terminal.screen.alter 가 요청한 변경은 메시지를 검사하고 hash 하기 전에, 중간에 바뀐 것처럼 적용한다.
      if (alterNextScreen) {
        alterNextScreen = false;
        body = alteredScreen(body);
      }
      // A screen message is the full form or a change of the screen that the view holds (docs/spec/persistent-services.md#screen-message
      // in core). The view checks each message, applies it to the held screen and hashes the full screen that results; screenHash is
      // asynchronous, so the fields are the object after the hash. A refused message is an error of the screen source; a refused change
      // also reads the screen, because the screen that the view holds no longer follows the sidecar.
      let applied;
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
        // A full form does not follow a screen, so it applies without the held one.
        applied = applyScreenMessage(body.base === true ? null : heldScreen, hashMessage);
      } catch (error) {
        reportInputError(error, "screen");
        if (body.base === false) readScreen().catch((readError) => reportInputError(readError, "screen"));
        return;
      }
      heldScreen = applied;
      if (body.base === true) screenReadAwaited = false;
      const message = applied.screen;
      // The writer stores the frame record only while the class frame stores debug, so the page hashes the screen only then; the level
      // is not a gate, and the writer still decides (docs/spec/native-surfaces.md#view-surfaces in core). screenHash 는 비동기이므로
      // fields 는 hash 가 나온 뒤의 객체다.
      if (["debug", "trace"].includes(runtime.log.levels().frame)) {
        // The session of the sidecar, which its frame records name (docs/spec/replay.md#records in core).
        const { sequence, segment } = body;
        const { sessionId } = session;
        const frame = body.frame === null ? null : {
          generation: body.frame.generation, raster: body.frame.raster, sequence: body.frame.sequence,
        };
        screenHash(message).then(
          (hash) => runtime.log.debug("frame", { session: sessionId, segment, sequence, rows: message.rows, cols: message.cols, frame, hash }),
          (error) => reportInputError(error, "screen"),
        );
      }
      // 링크와 screen.read 는 글자, 폭, 링크만 쓴다. 색과 속성은 래스터가 그린다.
      // The full form gives every row, and a change replaces only the rows that it carries.
      if (body.base === true) {
        screen = [];
        for (let start = 0; start < body.cells.length; start += body.cols) screen.push(screenRow(body.cells.slice(start, start + body.cols)));
      } else {
        screen = screen.slice();
        for (const change of body.changed) screen[change.row] = screenRow(change.cells);
      }
      screenFrame = body.frame;
      changed("screen");
      // The visible rows changed: a confirmation line among them is sent to the core (core docs/spec/agent-roles.md#confirmation).
      if (messagesDelivery !== null) messagesDelivery.screenChanged();
      if (body.scrollback !== undefined) {
        const { offset, history } = body.scrollback;
        if (!Number.isInteger(offset) || !Number.isInteger(history) || offset < 0 || history < 0) {
          reportInputError(`invalid screen scrollback from sidecar: ${JSON.stringify(body.scrollback)}`, "screen");
        } else if (offset !== session.scrollback.offset || history !== session.scrollback.history) {
          session = { ...session, scrollback: { ...session.scrollback, offset, history } };
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
        if (resolveError("screen")) changed("session");
      }
      // The sidecar answers a screen read with the full form.
      if (body.base === true) {
        for (const entry of screenReads) entry.resolve({ rows: screen, frame: screenFrame });
        screenReads.clear();
        if (screenReadAgain) {
          screenReadAgain = false;
          followScreen();
        }
      }
    } else if (body.event === "view") {
      // The sidecar sends no screen for a frame; the view event of a drawn frame carries its cursor with the caret and its
      // scrollback when either changes (docs/spec/vt-core.md of the sidecar). The view checks the whole event before it
      // changes a status.
      try {
        const { col, row, visible, focused, shape, blinking } = body.cursor ?? {};
        const cursorIsObject = body.cursor !== null && typeof body.cursor === "object" && !Array.isArray(body.cursor);
        if (!cursorIsObject || !Number.isInteger(col) || !Number.isInteger(row) || typeof visible !== "boolean" ||
          (focused !== undefined && typeof focused !== "boolean") || (blinking !== undefined && typeof blinking !== "boolean") ||
          (shape !== undefined && !DRAWN_SHAPE_KEYS.has(shape))) {
          throw new Error(`invalid view cursor from sidecar: ${JSON.stringify(body.cursor)}`);
        }
        const preeditFailure = preeditError(body.cursor.preedit);
        if (preeditFailure !== null) throw new Error(`invalid view cursor preedit from sidecar: ${preeditFailure}`);
        if (body.frame === null || !isScreenFrame(body.frame)) throw new Error(`invalid view frame from sidecar: ${JSON.stringify(body.frame)}`);
        const caretFailure = screenCaretError(body.cursor, body.rows, body.cols, body.frame);
        if (caretFailure !== null) throw new Error(`invalid view cursor caret from sidecar: ${caretFailure}`);
        const { offset, history, dropped } = body.scrollback ?? {};
        if (![offset, history, dropped].every(isCount)) {
          throw new Error(`invalid view scrollback from sidecar: ${JSON.stringify(body.scrollback)}`);
        }
        const alternate = body.alternate ?? {};
        if (typeof alternate.active !== "boolean" || !isCount(alternate.history) || !isCount(alternate.dropped)) {
          throw new Error(`invalid view alternate from sidecar: ${JSON.stringify(body.alternate)}`);
        }
        if (typeof body.background !== "string" || !BACKGROUND.test(body.background)) {
          throw new Error(`invalid view background from sidecar: ${JSON.stringify(body.background)}`);
        }
      } catch (error) {
        reportInputError(error, "view");
        return;
      }
      const { offset, history, dropped } = body.scrollback;
      if (offset !== session.scrollback.offset || history !== session.scrollback.history || dropped !== session.scrollback.dropped) {
        session = { ...session, scrollback: { offset, history, dropped } };
        changed("session");
        drawScrollbar();
      }
      const { active, history: kept, dropped: shed } = body.alternate;
      if (active !== session.alternate.active || kept !== session.alternate.history || shed !== session.alternate.dropped) {
        session = { ...session, alternate: { active, history: kept, dropped: shed } };
        changed("session");
      }
      // The track and the padding show the default background of the presented frame, which only the view event reports.
      if (body.background !== terminalBackground) {
        terminalBackground = body.background;
        paintScrollbar();
        paintPadding();
      }
      const { col, row, visible, focused, shape, blinking } = body.cursor;
      const drawn = { ...cursor.drawn };
      if (shape !== undefined) drawn.shape = DRAWN_SHAPES[shape] ?? shape;
      if (blinking !== undefined) drawn.blinking = blinking;
      applyCursor(body.cursor, {
        col, row, visible, ...(focused === undefined ? {} : { focused }), drawn, frame: body.frame,
        render: null, caret: body.cursor.caret, preedit: body.cursor.preedit ?? null,
      });
      if (resolveError("view")) changed("session");
      followScreen();
    } else if (body.event === "processes") {
      // The process list, which the sidecar reads after each output and at each event of the members of its jobs, and sends when
      // it changes; a failed read leaves the list unknown and is shown.
      if (body.error !== undefined) {
        session = { ...session, foreground: null, background: null };
        setError("processes", `terminal process list: ${typeof body.error === "string" ? body.error : JSON.stringify(body.error)}`);
        return;
      }
      const failure = !("foreground" in body) ? "no foreground" : processListError(body);
      if (failure !== null) {
        reportInputError(`invalid processes from sidecar: ${failure}`, "processes");
        return;
      }
      session = { ...session, foreground: body.foreground, background: body.background };
      resolveError("processes");
      changed("session");
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
      // 진단 측정의 답이다. 대신된 요청의 답은 버리고, 요청이 없으면 계약 위반이고 오류는 요청을 거절한다.
      if (replacedPtyReads.length > 0) {
        replacedPtyReads.shift();
        return;
      }
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
    } else if (body.event === "mouse.cursor.dirty") {
      // The sidecar's mouse cursor state changed. The view pointer is a function of the hovered link and the
      // program pointer shape, so the page applies that function again instead of keeping the previous value.
      view.style.cursor = session.link ? "pointer" : pointerStyle();
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
      }
    } else if (body.event === "shell.state" || body.event === "shell.state.current") {
      const next = body.event === "shell.state"
        ? { state: body.to, source: body.source, sequence: body.sequence, exit: body.exit }
        : { state: body.state, source: body.source, sequence: body.sequence, exit: body.exit };
      const change = body.event === "shell.state";
      const problem = terminalStateProblem(next, change) ??
        (!change && next.sequence < terminalState.sequence ? `a read reply below the held sequence ${terminalState.sequence}` : null);
      if (problem !== null) {
        reportInputError(new Error(`invalid terminal state from sidecar: ${problem}: ${JSON.stringify(body)}`));
        return;
      }
      // A change event that does not follow the held value shows that events were not received, so the page reads again.
      if (change && next.sequence !== terminalState.sequence + 1) {
        readState();
        return;
      }
      setTerminalState(next);
    } else if (body.event === "program.status" || body.event === "program.status.current") {
      const { event: _, ...next } = body;
      const change = body.event === "program.status";
      const problem = programStatusProblem(next, change) ??
        (!change && next.sequence < programStatus.sequence ? `a read reply below the held sequence ${programStatus.sequence}` : null);
      if (problem !== null) {
        reportInputError(new Error(`invalid program status from sidecar: ${problem}: ${JSON.stringify(body)}`));
        return;
      }
      if (change && next.sequence !== programStatus.sequence + 1) {
        readProgram();
        return;
      }
      setProgramStatus(next, change);
    } else if (body.event === "progress") {
      const { state, progress } = body;
      if (!Number.isInteger(state) || state < 0 || state > 4 ||
        !(progress === null || (Number.isInteger(progress) && progress >= 0 && progress <= 100))) {
        reportInputError(new Error(`invalid progress event from sidecar: ${JSON.stringify(body)}`));
        return;
      }
      session = { ...session, vendor: { ...session.vendor, progress: { state, progress } } };
      changed("session");
    } else if (body.event === "bell") {
      // The sidecar takes the notice of a bell into the program status; the bell itself shows nothing on the page.
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
    } else if (body.event === "input_held") {
      if (!Number.isInteger(body.queued) || body.queued < 0 || typeof body.held !== "boolean") {
        reportInputError(new Error("invalid input_held event from sidecar"));
        return;
      }
      session = { ...session, inputHeld: body.held ? { queued: body.queued, held: true } : null };
      changed("session");
    } else if (body.event === "exit") {
      // The child ended: the last frame stays on screen, and no input is held in an ended session.
      discardUnanswered("session-ended");
      session = { ...session, exited: true, inputHeld: null };
      changed("session");
    } else if (body.event === "error") {
      // error 이벤트를 session 상태에 저장한다
      const error = new Error(typeof body.reason === "string" ? body.reason : (typeof body.error === "string" ? body.error : "Unknown sidecar error"));
      setError("sidecar", error.message);
    } else if (body.event === "font" && typeof body.family === "string") {
      session = { ...session, font: body.family, fontSystem: body.system === true, fontSize: body.size };
      changed("session");
    } else if (body.error === "openFailed") {
      // The service opened no session. The next configure tries again, and the session that opens resolves this error.
      const message = `session open failed: ${body.reason}`;
      setError("open", message);
      failSession(message);
    } else if (body.error === "Session not open" && body.request !== undefined && !session.exited) {
      requeueRefused(body.request);
    } else if (body.error) {
      // 오류 응답 처리: {"error":"invalidParams","reason":"...",...}
      // reason 을 버리지 않고 오류에 실어 보낸다.
      const message = typeof body.reason === "string" ? `${body.error}: ${body.reason}` : body.error;
      setError("sidecar", message);
    } else if (body.event) {
      // 알 수 없는 이벤트 타입을 기록한다
      runtime.log.warn("sidecar.unknown", { event: String(body.event) });
      if (!session.unsupported.includes(body.event)) {
        session = { ...session, unsupported: [...session.unsupported, body.event] };
        changed("session");
      }
    }
  });

  registerMessages();
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
    // The answer of the close ends the session, so its status states the end without an exit event.
    discardUnanswered("session-closed");
    session = { ...session, exited: true, inputHeld: null };
    changed("session");
  }

  try {
    // 공개 항목 등록
    await Promise.all([
      expose.status("terminal.session", read.session, watch("session")),
      expose.status("terminal.screen", currentScreen, watchScreen),
      expose.status("terminal.compose", read.compose, watch("compose")),
      expose.status("terminal.cursor", read.cursor, watch("cursor")),
      expose.status("terminal.state", read.state, watch("state")),
      expose.status("terminal.activity", read.activity, watch("activity")),
      expose.status("terminal.program", read.program, watch("program")),
      expose.status("terminal.messages", read.messages, watch("messages")),
      expose.command("terminal.messages.read", async (params) => readMessages("read", params)),
      expose.command("terminal.messages.wait", async (params) => readMessages("wait", params)),
      expose.command("terminal.input", async ({ bytes }) => {
        if (typeof bytes !== "string") throw new Error("terminal.input requires bytes");
        try {
          await callerInput({ type: "input", actions: [{ type: "insert", text: bytes, replacementRange: null, attributed: false }], preedit: compose });
        } catch (error) {
          if (!(error instanceof SessionFailure)) reportInputError(error);
          throw error;
        }
        return null;
      }),
      // The text is a paste and Enter a separate input after the reply of the paste, as an injected message is submitted. The
      // result means that the sidecar answered both inputs; the caller confirms the submit from status.
      expose.command("terminal.submit", async ({ text }) => {
        if (typeof text !== "string" || text.length === 0) throw new Error("terminal.submit requires text, a non-empty string");
        if (/[\r\n]/.test(text)) throw new Error("terminal.submit text must not contain CR (U+000D) or LF (U+000A)");
        let refused;
        try {
          refused = await submitLine("terminal.submit", text);
        } catch (error) {
          if (!(error instanceof SessionFailure)) reportInputError(error);
          throw error;
        }
        if (refused !== null) {
          const error = new Error(`terminal.submit: ${refused.error}${typeof refused.reason === "string" ? `: ${refused.reason}` : ""}`);
          reportInputError(error);
          throw error;
        }
        return null;
      }),
      expose.command("terminal.screen.read", async () => {
        if (region === null) throw new Error("Terminal not initialized");
        return awaitScreen();
      }),
      expose.command("terminal.screen.rows", async (params) => {
        if (region === null) throw new Error("Terminal not initialized");
        const { screen, from, count } = params ?? {};
        if (!READ_SCREENS.has(screen) || !Number.isInteger(from) || from < 0 || !Number.isInteger(count) || count < 1 || count > 200) {
          throw new Error("terminal.screen.rows requires screen (primary or alternate), from (an integer of at least 0) and count (an integer from 1 to 200)");
        }
        const rows = await rangeRead(screen, from, count);
        const text = rows.map((row) => row.filter((cell) => cell.width !== 0).map((cell) => cell.ch ?? "").join(""));
        return { screen, from, count, rows, text };
      }),
      expose.command("terminal.screen.scroll.read", async (params) => {
        if (region === null) throw new Error("Terminal not initialized");
        const { by } = params ?? {};
        if (!Number.isInteger(by) || by === 0 || Math.abs(by) > SCROLL_READ_BY) {
          throw new Error(`terminal.screen.scroll.read requires by (an integer from -${SCROLL_READ_BY} to ${SCROLL_READ_BY} other than 0)`);
        }
        const quiet = settings.read().scrollReadQuiet;
        if (!Number.isInteger(quiet) || quiet < 1 || quiet > SCROLL_READ_QUIET) {
          throw new Error(`scrollReadQuiet setting is invalid: ${String(quiet)}`);
        }
        return scrollRead(by, quiet);
      }),
      expose.command("terminal.process.list", async () => {
        if (region === null) throw new Error("Terminal not initialized");
        return processRead();
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
      expose.element("terminal.view", view),
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
        expose.element("terminal.scrollbar", scrollbar.track),
        expose.element("terminal.scrollbar.thumb", scrollbar.thumb),
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
    // The answer, a failed send, the next request, the sidecar-failure of the surface, a connection event or the close of the view
    // ends the wait.
    const readPtyPending = () => new Promise((resolve, reject) => {
      if (pendingPtyRead) {
        replacedPtyReads.push(pendingPtyRead);
        pendingPtyRead.reject(new DOMException("pty.pending superseded", "AbortError"));
      }
      let settled = false;
      const waiter = {
        resolve: (pending) => {
          if (settled) return;
          settled = true;
          resolve(pending);
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        },
      };
      pendingPtyRead = waiter;
      terminal.send(id, { operation: "pty.pending" }).catch((error) => {
        if (pendingPtyRead === waiter) pendingPtyRead = null;
        // A request whose send failed receives no answer.
        const replaced = replacedPtyReads.indexOf(waiter);
        if (replaced >= 0) replacedPtyReads.splice(replaced, 1);
        waiter.reject(error);
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
        onPointer: (fn) => {
          pointerObservers.add(fn);
          return () => pointerObservers.delete(fn);
        },
        readPtyPending,
        readViewHistory: () => window.history.length,
        startViewFrames: diagnostics.startViewFrames,
        viewLog: {
          trace: (event, fields) => {
            if (event !== "view.content_frame") throw new Error(`unexpected view frame event: ${String(event)}`);
            return runtime.log.trace("view.content_frame", fields);
          },
        },
        closing,
        alterNextScreen: () => {
          alterNextScreen = true;
        },
        reportError: (message) => setError("trace", message),
        resolveError: () => {
          if (resolveError("trace")) changed("session");
        },
      });
    }
  } catch (error) {
    // The session is open at this point, so a failed registration ends it before the error reaches the mount: the regions are
    // released and no session stays open on the sidecar. A failure of that close is reported through the surface error path.
    await endSession().catch((closeError) => reportSurfaceError(closeError));
    throw error;
  }
  return {
    setTheme,
    setCursorPolicy,
    pasteText,
    // Shows an input error of the terminal through terminal.session and the surface error display.
    reportInputError: (error) => reportInputError(error),
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
      screenWatchDisposed = true;
      let screenWatchError;
      try { await updateScreenWatch(); } catch (error) {
        screenWatchError = error;
        reportInputError(error, "screen");
      }
      closing.removeEventListener("abort", closeScreenWatch);
      closing.removeEventListener("abort", closeSidecarWaits);
      closing.removeEventListener("abort", closeMessagesRequests);
      if (diagnostics) for (const type of pointerTraceTypes) view.removeEventListener(type, tracePointer);
      const offTheme = await themeSubscription?.dispose;
      // default: 테마나 설정 구독이 없으면 해제 함수도 없다.
      offTheme?.();
      // default: 설정 구독이 없으면 해제 함수도 없다.
      settingsSubscription?.();
      textSizeSubscription();
      // default: 사이드카 구독을 만들지 못한 경우에는 해제 함수가 없다.
      stopSidecar?.();
      stopFailure?.();
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
      if (screenWatchError) throw screenWatchError;
    },
  };
}
