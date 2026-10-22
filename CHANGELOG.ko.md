# 변경 기록

[English](CHANGELOG.md)

## 미배포

- P49.4: view clipboard가 PNG payload를 서브한다. PNG 읽기는 payload의 bytes를 돌려주고, `persistPNG`는 bytes를 view의 call route로 저장하고 저장된 경로와 shell-quote된 형태를 돌려준다(core F241). view의 clipboard 항목은 `ui/view-clipboard.js`로 옮겼다.

- P49.5: terminal 소유 view-log adapter로 log correlation options를 view 경로에 전달한다. Red: input record가 native insert chain을 잃었다. Green: plugin test 170/170과 core-source 검사 통과. SDK pin과 release gate는 바꾸지 않았다.

- F238-c-23/P56.1/P56.2: `scripts/build-test.mjs`는 필수 dependency/peer를 해석할 수 없거나 도달한 UI import가 `build/test/ui` 밖으로 나가면 실패한다. 없는 optional dependency와 optional peer는 허용한다. Package resolution은 실제 경로를 따르고 package 개발 전용 dependency는 제외한다. Import regex는 Acorn으로 대체했으며 SDK fake 검사 전에 module specifier를 decode하고, non-literal dynamic import와 `require`는 fail closed한다. Red: 변경 전 build는 required graph edge와 escaped helper에 status 0을 반환했고 Unicode-escaped SDK import를 rewrite하지 않았으며 computed dynamic import도 허용했다. Green: `node --test test/build-test.test.mjs` 6/6, `pnpm test` 169/169 통과. escaped helper fixture는 실제 해석 경로에 파일이 있음을 assert한다. SDK release pin은 바꾸지 않았다.

- F238-c-13/c-18/c-19/c-21/c-23/c-28: `scripts/build-test.mjs`가 도달 가능한 `ui/`를 `build/test/`로 복사하고, 표에 적힌 API export만 core 계약에서 복사한 엄격한 one-call fake로 바꾼다. 테스트 devDependency 도달성을 검사하고 미등록 SDK import에서 실패한다. `shellQuotePath`, `screenFromMessage`, `screenHash`용 계약 복사본은 38개이며 debug logging이 꺼져도 잘못된 rows, columns, cells, segment를 거부한다. 테스트의 binder 알고리즘을 제거했고 local registry는 terminal이 등록한 handler만 실행한다. `test/census.test.mjs`는 제거된 상태이며 `make check`가 terminal census를 맡는다. Red: 엄격한 fake가 미등록 screen 입력을 찾아내 core가 필요한 사례를 추가했다. Green: `pnpm test` 163/163, `make check CORE_PLUGIN_API_DIR=<core plugin-api source>`에서 표 비교와 제공되는 validator가 통과한다. 기본 `make check`는 설치 API pin에 `contract/clipboard.json`이 없어 막히며 `soksak-view-check`도 설치되어 있지 않다. `docs/spec/plugins.md`의 release-tag 규칙에 따라 pin, release, 대체 도구를 변경하지 않았다. c11 view-literal 비교는 열린 상태다.

- F238-c-21: SDK census CLI를 subprocess로 실행하고 일반 scanner 단언을 중복하던 `test/census.test.mjs`를 제거했다. 해당 사례는 core `packages/plugin-api/test/events-check.test.mjs`가 소유하며 `make check`가 terminal 저장소 census를 수행한다. `test/events.test.mjs`와 terminal 동작 단언은 유지했다. Green: core census tests 27/27, `make test` 163/163, core-source table override로 terminal `make check` 통과.

- P49: 표면이 자기 image region을 담는 view로 옮겨졌다(core F212.10, P49.3을 닫음). `plugin.json`은 image region과 다섯 overlay를 담은 composition `{kind: "view", page: "ui/terminal.html"}`을 선언하고 `module`은 없다. view page는 start values `window.sokSurface`를 읽고, view bridge 위에서 surface context를 만들고, surface identifier로 sidecar session을 주소하고, 선언된 status, command, dom 이름을 view exposure relay로 등록하고, `ui/terminal.js`를 바꾸지 않고 시작한다. `ui/terminal-module.js`와 page-mount context는 제거됐다. `@soksak/plugin-api`는 view bridge와 그 composition을 담은 core main의 commit에서 온다. Red: 이동 전 tree에서 `test/module.test.mjs`의 8개 view case가 실패했다(`ENOENT ... ui/terminal.html`, `Cannot find module ... ui/view.js`). Green: `make test`가 macOS 26.6 arm64에서 exposure, engines, census, catalog, record 검사와 함께 161/161 tests를 통과한다. view의 경로는 PNG clipboard의 읽기와 저장을 서브하지 않고 record의 `cids`를 싣지 않는다. 두 gap은 대기 항목 P49.4와 P49.5가 기록한다.

- P48: 새 커밋의 작성자는 `min-0-max <max@blue.tools>`다. `.mailmap`이 이전 이름 `min-median-max`를 잇고, 게시된 커밋은 다시 쓰지 않는다.

## 0.0.14 (2026-10-18)

- P47: terminal service `^0.0.11`을 요구하는 version 0.0.14를 release한다. service 0.0.11은 그려지는 surface에 대한 `image` 없는 `open`을 거부하므로, card의 tab이 가렸다가 다시 보인 terminal이 출력을 그린다. tag `v0.0.14`가 `terminal-0.0.14.tgz`를 게시한다.

## 0.0.13 (2026-10-14)

- P46: terminal.cursor의 drawn preedit(P45)을 담은 version 0.0.13을 release한다. tag `v0.0.13`이 `terminal-0.0.13.tgz`를 게시한다.
- P45: `terminal.cursor`가 `screen` event의 `cursor.preedit`에 service가 그린 preedit을 담는다(없으면 null). 다른 형태의 preedit은 잘못된 screen cursor로 거부된다.

## 0.0.12 (2026-10-14)

- P44: screen read의 frame(P42)을 담은 version 0.0.12를 release한다. terminal service `^0.0.10`을 요구하며, 0.0.10이 `screen` event의 `frame`을 담고, tag `v0.0.12`가 `terminal-0.0.12.tgz`를 게시한다.
- P42: `terminal.screen.read`가 `{ rows, frame }`을 돌려준다. `frame`은 가장 최근 `screen` event의 `frame`이며(이미지가 없는 표면이면 null), `frame`이 없거나 다른 모양인 `screen` event는 잘못된 screen 메시지로 거부한다.
- P43: `make hooks`가 `.githooks`를 hook 폴더로 정해, commit message의 형식이나 용어 규칙, record 규칙을 어긴 commit이 만들어질 때 거부된다.

## 0.0.11 (2026-10-13)

- P41: event 계약(P30), screen hash(P32), wheel 기록(P38.1), context menu(P39)를 담은 version 0.0.11을 release한다. tag `v0.0.11`이 `terminal-0.0.11.tgz`를 게시한다.

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
