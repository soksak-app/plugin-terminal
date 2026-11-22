# Owned session

[English](owned-sessions.md)

terminal plugin은 `plugin.json`에 `sessions: true`를 선언하고 core의 owned session에 참여한다(`docs/spec/plugins.md#owned-sessions`, `docs/spec/persistent-services.md#owned-sessions`). terminal surface는 어떤 tab도 보이지 않는 terminal session을 연다. tab은 자체 program을 시작하는 대신 요청 시 그 session을 보인다.

## 선언

- `plugin.json`에 `"sessions": true`가 있다.
- plugin은 `dependencies`에 정확히 하나의 sidecar, `@soksak/sidecar-vt-alacritty`를 둔다. 이 sidecar는 `transport: "persistent"`다. core는 surface 없는 `sessions`, 또는 sidecar가 정확히 하나가 아닌 `sessions`를 거부한다.
- `background`는 바뀌지 않는다. background session은 owned session이 아니다.

## Sidecar 동작

terminal sidecar는 core의 owned session 메시지에 sidecar 자체 명세(sidecar repository의 `docs/spec/vt-core.md`, 절 Owned session operations)가 정한 body로 응답한다. plugin은 이 메시지를 직접 보내지 않는다. core가 `core.session.open`, `core.session.resize`, `core.session.end`에 대해 보낸다.

- `open`은 owner surface의 PTY session을 요청한 크기로 만든다. sidecar는 자신의 font metrics로 크기를 cell로 바꾼다. 열은 `floor(width × scale / cellWidth)`, 행은 `floor(height × scale / cellHeight)`이다. `width`와 `height`는 point이고 cell 크기는 device pixel이다. 온전한 cell을 주지 못하는 크기는 거부한다.
- `open`의 `params`는 terminal `open` 요청의 실행 값이다(`shell` 또는 `program`과 `args`, 그리고 `directory`). terminal surface가 보내는 것과 같은 필드다. 잘못된 값은 그 요청의 이유와 함께 거부한다.
- `resize`는 열린 session의 cell 격자를 새 크기로 바꾸고 새 크기를 PTY에 보낸다.
- `end`는 PTY session과 그 process를 끝낸다.

## Tab 연결

tab은 `core.layout.open {card, plugin, params: {session}}`로 owned session을 보인다. tab의 view는 자체 session을 시작하지 않는다. sidecar에 surface로 `{operation: "attach", session}`을 보낸다. 그 뒤 view는 그 session의 출력을 받고, 입력을 session으로 보내며, 설정(그중 font)을 자체 session과 똑같이 configure로 보낸다. configure가 session의 격자를 다시 계산하고 PTY 크기를 바꾼다. tab이 보일 때와 frame이 바뀔 때 core는 card의 frame 크기로 `core.session.resize`를 보내고, sidecar는 이를 연결된 session에 적용한다. view가 끝나면 연결이 끊기고 session은 열린 채로 남는다. session에 연결된 view는 하나뿐이며, sidecar는 두 번째 attach를 거부한다.

sidecar의 규칙과 응답은 sidecar 명세(`docs/spec/vt-core.ko.md`, 절 Owned session 동작)에 있다.

owner surface의 view도 sidecar subscription으로 owner event `session.program`을 받는다. core는 그 event를 `core.sessions`에 읽는다. view는 상태를 바꾸지 않는 명시적 branch로 그것을 처리한다. tab의 program state는 OSC 7501 record에서만 오기 때문이다(core `docs/spec/terminal-state.md`). view는 그 event를 `terminal.session`의 `unsupported`에 나열하지 않는다.

## 미결 결정

- 이 명세에는 없다. attach 요청에는 font가 없으며, view의 font는 configure로 session에 전달된다.
