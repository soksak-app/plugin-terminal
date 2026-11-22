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

tab은 `core.layout.open {card, plugin, params: {session}}`로 owned session을 보인다. 그러면 core가 `core.session.resize`로 card의 frame 크기를 보낸다. tab에서 sidecar로 가는 연결 요청은 아직 정의되어 있지 않다. 그래서 tab은 지금도 자체 session을 시작한다. 이 부분은 열려 있다(`docs/features.md`).

## 미결 결정

- tab 연결 전 owned session의 font: sidecar는 기본 font를 기본 크기(13 point, 설정하지 않은 surface의 크기)로 쓴다. 설정한 font로 session을 보이는 tab은 다른 cell 격자를 얻으므로, owned session의 metrics에 쓸 font를 정해야 한다.
- tab에서 열린 session으로 가는 연결 요청의 wire. core 계약은 `params.session`을 가진 `core.layout.open`만 이름을 준다.
