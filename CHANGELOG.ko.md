# 변경 기록

[English](CHANGELOG.md)

## 미배포

- P39: `surface.menu`가 제목 `복사`의 `terminal.copy`와 제목 `붙여넣기`의 `terminal.paste`를 나열하므로, terminal을 오른쪽 클릭하면 둘이 열린다.
- P40: `make test`가 record 검사 `soksak-records`를 실행하고, CI가 push된 각 commit message의 형식을 `soksak-commits`로 검사한다.
- P32.2: test가 `@soksak/plugin-api/screen-hash`를 설치된 core release 0.0.11에서 import한다. core checkout에서 그 module을 찾던 hook은 지웠다.
- P30.5: `@soksak/plugin-api`를 core release 0.0.11에서 받고 `engines.soksak`은 `>=0.0.11`이므로, manifest member `events`가 받아들여지고 `make test`가 설치된 의존성의 event 가드를 실행한다.
- P38.1: 표면이 각 wheel 제스처를 이동량, 칸 높이, 보내는 줄, 남은 이동과 함께 `plugin.terminal.wheel`로 기록하므로, scroll을 보내지 않는 제스처도 log에 남는다.
- P36: 화면 행의 cell이 screen message에서 켜진 속성 flag를 이름으로 담는다.
- P35: 화면 행의 빈 칸과 넓은 글자의 이어지는 칸은 `ch`가 없으므로, 읽는 쪽이 다시 그 폭을 공백으로 센다.
- P33: `test/census.test.mjs`가 event도 이유도 없는 발생 source가 이 repository의 guard에서 실패함을 보인다.
- P32.6: 진단 command `terminal.screen.alter`가 다음 screen message를 page가 hash하기 전에 바꾸므로, window check가 core의 replay가 그 변경을 보고하는지 관찰한다.
- P32.5: frame event가 surface 식별자 대신 sidecar의 session을 적는다.
- P32.4: frame event가 screen message의 replay segment인 `segment`를 담는다.
- P32.3: terminal은 모든 `screen` message를 `screenFromMessage`로 검사하고 `lines` 대신 `cells`로 행을 만들며, cursor는 `col`, `row`, `visible`만 요구하고 `focused`, `shape`, `blinking`은 있을 때 검사한다. `terminal.screen.read`는 셀 행을 돌려준다. Red: golden message가 `invalid screen cursor from sidecar`로 거부됐다. macOS에서 `npm test`로 시험했다(manifest 시험은 고정된 plugin-api 때문에 변경 전후 모두 실패한다).
- P32.1: 터미널이 sidecar의 `screen` message마다 `screenFromMessage`와 `screenHash`로 hash를 계산해 gate `runtime.log.enabled` 뒤에서 event `frame`(`session`, `sequence`, `rows`, `cols`, `hash`)을 저장하고, 거부된 message는 출처 `screen`의 오류다. P31.3을 닫는다. `test/terminal.test.mjs`가 core의 golden message 7개의 hash를 재현한다.
- P31.2: event `input`과 `send`가 그것을 일으킨 입력의 `cids`를 싣는다.
- P31.1: 터미널이 `runtime.log.<level>`을 직접 호출하고, event `ime`, `input`, `send`, `send.result`, `sidecar.event`, `region`의 필드를 builder로 넘기며, emitter `ui/events.js`를 제거했다. `test/terminal.test.mjs`와 `test/events.test.mjs`가 통과하고, `soksak-events`는 선언된 event 12개와 emit site 15개를 보고한다.
- P30.4: `make test`가 `census.json`과 `events.json`으로 `soksak-events`를 실행하고, 사유 주석 9개를 `default: <reason>` 형태로 쓴다.
- P30.3: 입력마다 그 입력을 일으킨 region event의 `cids`를 사이드카에 넘기고(`sidecar.send(surface, body, cids)`), 세션을 기다린 입력도 마찬가지다. 잘못된 `cids`는 세션 오류로 보인다.
- P30.2: trace event가 plugin의 emitter를 거치고, `send.result`가 `ok`, `micros`, `error`를 적으며, 세션 gate·세션 열기·닫기·가득 찬 대기열의 입력 거절·보인 오류마다 event로 저장한다. `test/terminal.test.mjs`와 `test/module.test.mjs`가 통과한다.
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
