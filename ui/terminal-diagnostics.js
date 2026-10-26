// 터미널 플러그인의 진단 항목. diagnostics.json 이 선언하며 진단 빌드에만 스테이징된다.
//
// terminal.compose.update 는 OS 입력기가 만드는 preedit 를 주입한다. terminal.ime.trace 는
// 명시적으로 시작한 동안 네이티브 입력 callback 과 순서대로 보낸 터미널 입력 작업을 기록한다.
// 기록이 용량에 이르면 이벤트를 버리지 않고 기록을 멈추며 오류를 보고한다.
// terminal.pty.pending 은 마스터가 쓰고 자식이 아직 읽지 않은 PTY 입력 바이트 수와 reader 가
// 읽은 자식 출력 누적 바이트 수를 한 시점에 함께 잰다.

const IME_TRACE_CAPACITY = 256;

/**
 * 터미널 구현이 넘긴 내부 연산으로 진단 항목을 등록한다.
 *
 *   expose          표면의 공개 항목 등록 함수
 *   updateCompose   네이티브 compose callback 과 같은 경로로 preedit 를 바꾼다
 *   onInput         입력 기록 함수를 등록한다
 *   readPtyPending  현재 세션의 PTY 전송 상태(읽지 않은 입력 바이트 수와 읽은 자식 출력 누적
 *                   바이트 수)를 사이드카에 묻는 측정 함수
 *   alterNextScreen 다음 screen 메시지 하나를 검사와 hash 전에 바꾸도록 요청한다
 *   reportError     trace 출처의 세션 오류를 보고한다
 *   resolveError    trace 출처의 세션 오류를 지운다. 새 trace 를 시작하면 해소된다
 */
export async function attach({ expose, updateCompose, onInput, onPointer, readPtyPending, alterNextScreen,
  readViewHistory, startViewFrames, viewLog, closing, reportError, resolveError }) {
  await attachPointerTrace({ expose, onPointer, reportError });
  let trace = { enabled: false, overflow: false, entries: [] };
  const watchers = new Set();
  const changed = () => {
    for (const fn of watchers) fn(trace);
  };
  onInput((entry) => {
    if (!trace.enabled) return;
    if (trace.entries.length === IME_TRACE_CAPACITY) {
      trace = { ...trace, enabled: false, overflow: true };
      changed();
      reportError("IME diagnostic trace capacity exceeded");
      return;
    }
    trace = { ...trace, entries: [...trace.entries, { sequence: trace.entries.length, ...entry }] };
    changed();
  });
  let stopViewFrames = null;
  let viewFrameState = { enabled: false };
  const viewFrameWatchers = new Set();
  const changedViewFrames = () => {
    for (const fn of viewFrameWatchers) fn(viewFrameState);
  };
  const stopFrames = () => {
    if (stopViewFrames === null) return;
    stopViewFrames();
    stopViewFrames = null;
    viewFrameState = { enabled: false };
    changedViewFrames();
  };
  closing?.addEventListener("abort", stopFrames, { once: true });
  await Promise.all([
    expose.status("terminal.ime.trace", () => trace, (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    }),
    expose.command("terminal.compose.update", updateCompose),
    expose.command("terminal.pty.pending", readPtyPending),
    // 다음 screen 메시지 하나를 페이지가 검사하고 hash 하기 전에 바꾼다. core 의 재생이 그 변경을 층 plugin 의 불일치로
    // 보고하는지 window check 가 관찰한다.
    expose.command("terminal.screen.alter", async () => {
      alterNextScreen();
      return null;
    }),
    expose.command("terminal.ime.trace", async ({ action }) => {
      if (action === "start") {
        trace = { enabled: true, overflow: false, entries: [] };
        resolveError();
      } else if (action === "stop") {
        trace = { ...trace, enabled: false };
      } else {
        throw new Error("terminal.ime.trace action must be start or stop");
      }
      changed();
      return trace;
    }),
    expose.status("terminal.view.frames", () => ({ ...viewFrameState }), (fn) => {
      viewFrameWatchers.add(fn);
      return () => viewFrameWatchers.delete(fn);
    }),
    expose.command("terminal.view.history", async () => {
      if (typeof readViewHistory !== "function") throw new Error("terminal view history reader is unavailable");
      const length = readViewHistory();
      if (!Number.isSafeInteger(length) || length < 1) {
        throw new Error(`terminal view document history length is invalid: ${JSON.stringify(length)}`);
      }
      return { length };
    }),
    expose.command("terminal.view.frames", async ({ action }) => {
      if (action === "start") {
        if (stopViewFrames === null) {
          if (typeof startViewFrames !== "function") throw new Error("view frame observation adapter is unavailable");
          if (typeof viewLog?.trace !== "function") throw new Error("view frame observation logger is unavailable");
          const stop = await startViewFrames({ log: viewLog });
          if (typeof stop !== "function") throw new TypeError("view frame observation adapter must return a stop function");
          stopViewFrames = stop;
          viewFrameState = { enabled: true };
          changedViewFrames();
        }
      } else if (action === "stop") {
        stopFrames();
      } else {
        throw new Error("terminal.view.frames action must be start or stop");
      }
      return { ...viewFrameState };
    }),
  ]);
}

// 한 번에 한 제스처 묶음을 기록한다. 가득 차면 기록을 중지하고 검증 실패를 명시한다.
async function attachPointerTrace({ expose, onPointer, reportError }) {
  const capacity = 4096;
  let state = { enabled: false, overflow: false, entries: [] };
  const watchers = new Set();
  const changed = () => { for (const fn of watchers) fn(state); };
  onPointer((entry) => {
    if (!state.enabled) return;
    if (state.entries.length === capacity) {
      state = { ...state, enabled: false, overflow: true };
      changed();
      reportError("Pointer diagnostic trace capacity exceeded");
      return;
    }
    state.entries.push({ sequence: state.entries.length, ...entry });
    changed();
  });
  await expose.status("terminal.pointer.trace", () => state, (fn) => {
    watchers.add(fn);
    return () => watchers.delete(fn);
  });
  await expose.command("terminal.pointer.trace", async ({ action }) => {
    if (action === "start") state = { enabled: true, overflow: false, entries: [] };
    else if (action === "stop") state = { ...state, enabled: false };
    else throw new Error("terminal.pointer.trace action must be start or stop");
    changed();
    return state;
  });
}
