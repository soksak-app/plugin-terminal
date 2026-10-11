# 변경 기록

[English](CHANGELOG.md)

## 미배포

- P30.1: plugin이 catalog `events.json`(`plugin.json`이 가리키고 release에 담긴다)과 emitter `ui/events.js`를 선언한다. emitter는 접두사 `plugin.terminal.`로 `context.runtime.log`에 event를 저장한다. `test/events.test.mjs` 5개 중 5개 통과.
- P29: `context.closing`이 abort되면 terminal이 사이드카 event를 무시하므로, 표면 제거 때 워크벤치가 뗀 region의 caret을 더는 설정하지 않는다.
- P28: plugin이 terminal service `^0.0.8`을 요구하고 0.0.10이 이를 담는다.
- P27: 0.0.9가 P26을 담는다.
- P26: sidecar로 보낸 모든 메시지와 그 결과, sidecar의 모든 이벤트, 이미지 영역의 모든 이벤트가 본문 전체를 담은 trace event이고, event `ime`과 `input`은 입력한 글과 모든 범위를 담는다.
- P25: 0.0.8이 P22를 담는다.
- P22: 입력기의 네이티브 콜백마다 종류와 글자 수를 담은 event `ime`을 글자 없이 performance trace에 쓴다.
- P24: 0.0.7이 P20, P21, P23을 담는다.
- P23: 교체된 terminal service는 셸이 마지막으로 알린 디렉터리에서 새 셸을 열고, 다른 컴퓨터의 디렉터리는 탭이 시작한 디렉터리로 돌아간다.
- P21: plugin이 hello 답에 version을 싣는 terminal service `^0.0.7`을 요구한다.
- P20: 재연결 동안 기다린 입력을 보존된 session이 답할 때 보내고, 각 입력(글자가 아닌 종류와 길이), session 문 변화, 큐 보내기를 performance trace에 쓴다.
- P19: 문서와 주석이 plugin, sidecar, release를 그 말로 부른다.
