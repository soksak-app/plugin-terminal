import { startTerminal } from "./terminal.js";

// 스크롤바는 네이티브 그림 위의 DOM overlay 다. 뷰 오른쪽 가장자리에 놓는다. 네이티브 영역의 조상은 배경을 가질 수
// 없으므로(docs/spec/surface-composition.md) padding 은 변마다 overlay 띠로 칠한다. 크기는 터미널 설정이 정한다.
const css = `:host{display:block;height:100%;background:transparent;color:var(--fg);position:relative}#view{position:absolute;inset:0;outline:0;cursor:text}
#scrollbar{position:absolute;top:0;right:0;bottom:0}#scrollbar[hidden]{display:none}
.padding{position:absolute}.padding[hidden]{display:none}
#thumb{position:absolute;left:2px;right:2px;cursor:grab}#thumb[data-dragging]{cursor:grabbing}`;

export async function mount(root, context) {
  root.innerHTML = `<style>${css}</style><div id="view" data-expose="terminal.view" tabindex="0"></div>` +
    `<div id="scrollbar" hidden><div id="thumb"></div></div>` +
    ["top", "right", "bottom", "left"].map((side) => `<div id="padding-${side}" class="padding" hidden></div>`).join("");
  const view = root.querySelector("#view");
  const scrollbar = { track: root.querySelector("#scrollbar"), thumb: root.querySelector("#thumb") };
  const padding = Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, root.querySelector(`#padding-${side}`)]));
  const composition = await context.composition.create({ regions: { view }, overlays: { scrollbar: scrollbar.track,
    "padding-top": padding.top, "padding-right": padding.right, "padding-bottom": padding.bottom, "padding-left": padding.left } });
  const image = composition.region("view");
  const sidecar = context.runtime.sidecar();
  let controller;
  try {
    controller = await startTerminal({ id: context.surfaceId, view, padding, attachImage: () => image,
      detachRegions: () => composition.dispose(), sidecar, scrollbar,
      expose: context.exposure, window, theme: context.runtime.theme, settings: context.runtime.settings,
      textSize: context.runtime.textSize, tab: context.tab, origin: context.origin, project: context.project,
      links: context.runtime.links,
      reportSurfaceError: (error) => context.status.report("error", error),
      diagnostics: context.diagnostics,
      clipboard: context.runtime.clipboard });
    if (!controller || typeof controller.dispose !== "function") {
      throw new TypeError("startTerminal must return { dispose() }");
    }
  } catch (error) {
    try {
      await composition.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "terminal mount and composition cleanup failed");
    }
    throw error;
  }
  context.status.report("ready");
  // controller 의 dispose 는 composition 을 해제한 뒤 사이드카 세션을 끝낸다.
  return { focus: controller.focus, async dispose() {
    await controller.dispose();
    await context.exposure.dispose();
    root.replaceChildren();
  } };
}
