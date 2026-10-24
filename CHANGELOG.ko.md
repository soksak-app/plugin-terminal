# 변경 기록

[English](CHANGELOG.md)

## 미배포

- P82: Diagnostic candidate pack은 `diagnostics.json`과 선언된 module을 항상
  포함한다. Red: 공식 installer가 terminal 0.0.17과 VT 0.0.14를 설치한 뒤
  installed-package 검사에서 declaration이 없어 실패했다. Green: 같은
  installer check가 terminal 0.0.18과 VT 0.0.14를 설치하고 declaration이
  view가 적재하는 module을 지정하며 module이 regular file인지 확인한다. 공식
  diagnostics pack은 copied contract, view, exposure, engines, events, records
  검사를 통과했고 registry build는 plugin 5개, sidecar 2개, pack 2개를 보고했다.
  Terminal archive SHA-256은
  `e06c181f7b5a81c6ced5f3a4d37eaa1e7d9a366e256624b0b09ce12fb299d500`, registry
  index SHA-256은
  `2971d9d5d7872e60a4ceeb62c4d9866b0f624036633244741f83e25244da2a56`이다.
  Candidate는 local이며 미출시 상태고 application을 실행하지 않았다.

- P79: Terminal candidate version을 0.0.16으로 설정하고 P78 committed-input
  snapshot 및 P80 input ordering을 포함한 local archive를 생성한다. 공식
  `make pack`은 core candidate 0.0.21을 사용해 copied contract, view, exposure,
  engines, events, records 검사를 통과했다. Archive SHA-256은
  `bc1b53178497000aa97055f25be3c1ee24dee6851f787f5afdd5770709aea322`이다.
  공식 installer는 0.0.13과 0.0.14가 모두 있는 registry에서 0.0.16 범위가
  둘 다 허용하므로 VT 0.0.13을 선택했다. 연결된 P81은 더 좁은 범위의 최종
  0.0.17 candidate를 준비한다. 최종 local registry는 terminal 0.0.17과 VT
  0.0.14를 사용하며 index SHA-256은
  `93fbc06fee0721d74d6582ce7fce7e165e5dd51937acd2e4f22b5dba9bcde1ae`이다.
  기존 0.0.15 release와 frozen source registry는 변경하지 않았다. Public
  tag/release는 만들지 않는다.

- P81: Terminal 0.0.17에서 VT `^0.0.14`를 요구한다. Red: 추적 official
  installer check는 두 sidecar version이 있는 같은 registry에서 terminal
  0.0.16과 VT 0.0.13을 설치해 0.0.14 assertion을 실패했다. Green: terminal
  0.0.17은 VT 0.0.14로 설치된다. Focused manifest case가 통과하고 registry
  build는 plugin 5개, sidecar 2개, pack 2개를 보고했으며 공식 `make pack`
  검사도 통과했다. Terminal package SHA-256은
  `6db6e6b537cbadfe8e4f7e1db4d631cf7f4a744c7294a36d374514b97a2e8b26`, VT
  0.0.14 SHA-256은
  `c95054417477a6a80e111265b1e84d3f514b1e7128ae46a4499287b22a80feda`이다.
  Candidate는 local이며 application 실행이나 public release는 없었다.

- P80: Native insert snapshot을 동기적으로 검증하고 region callback 순서로 queue한다.
  같은 turn의 Backspace가 bytes-plus-compose request보다 앞서지 않는다. Red:
  변경 전 handler는 Backspace를 먼저 보냈다. Green: ordering, 빈 snapshot, 동일
  snapshot, 단일 결합 전달, snapshot 누락 거부를 검증하는 terminal focused test
  4개가 통과한다. Test UI tree를 다시 만들었고 application/package build는 하지 않았다.

- P78: 확정 native insert bytes를 같은 input-document update의 strict 결과 compose snapshot과 함께 보낸다. `terminal.compose`를 해당 snapshot으로 갱신한 뒤 결합된 VT request를 queue하고, snapshot이 없는 insert는 bytes 전송 전에 거부한다. Red: 변경 전 production에서 insert request에 결과 compose snapshot이 없어 owning test가 실패했다. Green: test UI build가 module 9개와 contract fake 2개를 생성하고 terminal 및 native-input focused test 10개가 통과했다(UTF-16 marked-range 하위 case 4개를 포함해 결과 14개). Package는 미출시 상태다.

- P75-3: required-nullable render 의미를 status description에 두고 nested schema에서 지원하지 않는 `description` 항목을 제거한다. Red: 공식 diagnostics pack이 schema reader가 지원하지 않는 항목 때문에 manifest를 거부했다. Green: owning manifest test와 P77 `make check`가 통과하고 공식 diagnostics pack에 `diagnostics.json`과 필수 nullable cursor render schema가 포함된다.

- P75-2: leading cell 기준의 raw fractional CTFont/CTLine glyph bounds를 음수 좌표 또는 cell 밖 overhang이 있어도 보존한다. Cursor rectangle은 frame 절대 좌표로 raster 안에 유지한다. Red: consumer가 raw 한글 overhang을 거부했고 signed glyph-rectangle parser는 음수 absolute cursor rectangle을 수락했다. Green: owning test가 finite overhang을 수락하고 zero-width/non-finite glyph bounds와 음수 cursor rectangle을 atomic하게 거부한다. Application은 실행하지 않았다.

- P75-1: Sidecar의 cursor draw 상태와 width-2 glyph span을 맞춘다. Visible이지만 blink가 꺼진 cursor는 rectangle/color가 없고, 실제 그려지는 normal cursor는 rectangle과 effective color가 필요하다. Red: owning consumer test가 유효한 blink-off frame과 width-2 한글 glyph를 거부했다. Green: focused render metadata test가 통과했다. 원래 outside-span 거부는 S78.1이 raw un-clipped CoreText bounds를 보낸다는 점 때문에 P75-2에서 교정했다. Application은 실행하지 않았다.

- P77: 복사 case, view, exposure, engines, events, records 검사를 같은 `CORE_PLUGIN_API_DIR`에서 실행하며 기본값은 설치된 plugin API 경로다. Red: fixture SDK에서 view checker만 선택되고 나머지 네 도구는 pinned `pnpm`을 통해 실행됐다. Preflight가 없으면 checker 누락이 구체적인 경로 없이 Node module 오류로 드러났다. Green: owning check-target test 6/6이 다섯 local entry point와 경로가 명시된 누락 오류를 검증한다. Current core source로 전체 `make check`가 복사 case 52개, view literal, exposure, engines, census, event catalog, records를 통과한다. Pin과 release metadata는 바꾸지 않았다.

- P75: Sidecar의 필수 nullable screen render metadata를 screen frame, cursor, preedit과 같은 status update의 `terminal.cursor.render`로 발행한다. 화면 상태를 바꾸기 전에 render object 전체와 정확한 frame 연결을 검증하고, SDK screen hash를 호출하기 전에 terminal 전용 field를 projection에서 제거한다. State cursor 갱신은 frame과 render를 모두 지운다. Red: 변경 전 production에는 render status와 필수 field 검사가 없었고 frame에 연결된 metadata를 검증하지 않았다. Green: focused renderer/cursor-state case가 통과하고 terminal 및 manifest test가 171/171 통과한다. Plugin은 미출시 상태다.

- P76: `make check`에서 SDK view literal checker를 실행한다. Target은 설치된 `soksak-view-check` 또는 local `CORE_PLUGIN_API_DIR` override의 `view-check.js`에 `view-check.json`과 복사한 screen-message vector를 전달한다. Red: 변경 전 Makefile의 dry-run에서 command와 두 파일이 없어 owning check-target test가 실패했다. Green: `test/check-target.test.mjs` 5/5 통과. Current core source로 `make check`는 복사 계약 52개, view literal, exposure를 통과한 뒤 기존 P69 `soksak-engines` version gate에서 실패한다. SDK pin과 release metadata는 바꾸지 않는다.

- P74-1: 유효한 screen message projection 15개에서 사용하는 core 발행 screen hash case 9개를 terminal test fake에 추가한다. 동일 projection은 하나의 case를 재사용한다. Red: owning consumer test가 미등록 `screenHash` 입력 오류 15개를 보고하고 `terminal.session.error`를 설정했다. Green: 같은 test가 screen/session 오류 없이 1/1 통과하며, copied-case checker가 current core API source 기준 case 52개를 검증하고 exposure, event catalog, record 검사도 통과한다. Test UI build는 module 9개와 contract fake 2개를 해석한다. Production code, SDK pin, release는 변경하지 않았다.

- P74: 검증된 각 screen event의 frame을 그 event의 cursor, preedit과 함께 `terminal.cursor`에 한 번의 status update로 발행한다. Frame은 필수 nullable이며 frame 없는 state event가 cursor를 갱신하면 `null`로 지운다. State event는 non-null frame을 지정할 수 없다. Invalid screen frame은 이전 status를 보존하고 기존 screen 오류 경로를 따른다. Red: public frame/preedit screen case의 frame이 `undefined`였고, 후속 state cursor가 이전 frame을 보존하거나 frame을 포함한 state cursor가 이전 screen tuple을 바꿨다. Green: frame/state focused test 5개와 invalid-input status 보존, terminal/manifest test 168개가 통과한다. Current core source 기준 copied contract case 43개도 통과한다. 유효한 screen projection 15개에는 finite test fake에 hash input이 없었으며 P74-1이 이에 대응하는 core 발행 hash case 9개를 추가한다. Pinned `make check`는 별도 P69 SDK version gate에서 멈춘다. 변경은 미출시 상태다.

- P73: terminal exposure schema에서 지원하지 않는 `required`를 제거한다. 변경 전 manifest를 공식 CLI로 검사한 Red는 `terminal exposes terminal.cursor schema.preedit: unknown field required`였고, writer는 `type`, `properties`, `items`, `enum`만 허용한다. Green: 일반 및 diagnostics CLI 379 pack, manifest test 9/9, focused marked-range runtime test 7/7, candidate exposure·engines·events·records와 복사 계약 case 41개가 통과한다. pinned `make check`는 설치된 SDK 0.0.20이 `^0.0.21`을 거부하는 별도 P69 gate에서 계속 실패한다. Runtime 검증은 바뀌지 않았고 package는 release되지 않았다. CLI 빌드 로그는 보존되지 않았다.

- P72-1: IME trace test는 보내는 입력 작업 네 개마다 `terminal-input` record 하나를 기대한다. 이전 예상은 일치하는 작업이 없는 다섯 번째 record를 포함했다. Red: 원래 terminal 구현은 네 건을 기록했지만 test는 다섯 건을 기대했다. Green: focused trace test 1/1과 terminal/manifest 파일 163/163 통과. Runtime 동작은 바꾸지 않았다.

- P72: terminal은 native compose `markedRange`를 전체 compose text 기준 UTF-16 범위로 보존해 VT에 그대로 보내며 compose status와 cursor preedit 모두에 필수로 둔다. 누락·잘못된 형식·text 범위 밖·grapheme 분할 범위는 status 변경이나 input queue 전에 거부하고, 잘못된 sidecar state는 session을 변경하거나 대기 입력을 보내지 않는다. Red: 변경 전 terminal은 marked range를 버리고 잘못된 범위를 허용했으며 malformed state가 session을 변경했다. Green: focused compose, state, manifest test 9/9와 test UI build가 통과한다. terminal/manifest owning 파일은 162/163 통과다. 남은 IME trace 예상값 실패는 원래 terminal source에서도 재현되며 P72-1로 추적한다. 수정은 아직 release되지 않았다.

- P71: test-build guard가 raw test source 문자열 대신 parsed module import로 SDK dependency를 검사한다. Manifest package key는 일반 data로 허용하고 실제 SDK import는 계속 거부한다. Red: `node --test test/build-test.test.mjs`는 broad string guard가 parsing 전에 실행되어 manifest-data case와 실제 import case가 모두 실패했다. Green: build-guard와 manifest focused tests가 16/16 통과하고, `node scripts/build-test.mjs`가 test UI tree를 만든다.

- P70: Korean input method는 preedit이 그대로인 상태에서 prefix만 native insert로 commit할 수 있으므로 변경된 compose callback이 뒤따르지 않는다. terminal은 이전에 모든 insert에서 preedit을 지워 남은 입력을 잠시 표시하지 않았다. Red: `a partial native insert preserves the remaining input-method preedit`가 바꾸기 전 handler에서 actual compose `""`, expected `"ㅏㅏ"`로 실패했다. Green: handler는 compose event가 상태를 바꿀 때까지 compose를 유지한다. 같은 테스트가 insert 뒤 empty compose 순서를 검증하며, focused terminal IME 테스트 6개가 통과한다. 수정은 아직 release되지 않았으며, package와 registry release는 P70-1이 추적한다.

- P69: Terminal `0.0.15`은 `engines.soksak` `^0.0.21`을 선언한다. 공개 core `v0.0.20`은 `surface.module`을 요구하므로 terminal의 view manifest를 거부한다. Red: `test/core-version.test.mjs`가 `">=0.0.11" !== "^0.0.21"`로 실패한다. Green: 같은 test가 1/1 통과하고 현재 core `engines-check.js`가 범위를 수용한다. SDK pin, plugin version, archive, registry는 바꾸지 않았으며, 일치하는 core release가 게시될 때까지 release는 대기한다.

- P68: 필수 process display identity를 선언한 VT sidecar 0.0.12 이상을 요구하고 terminal plugin을 0.0.15로 올린다. Red: manifest test가 `^0.0.11`에서 실패했다. Green: `^0.0.12`로 통과한다.

- P66: terminal view의 primary pointer 누름은 shared exposure binder를 통해 선언된 `terminal.focus` command를 실행하여 native image region의 keyboard focus를 요청한다. 별도 view는 main document card로 pointer가 bubble되는 데 의존하지 않는다. focus 실패는 session과 surface 오류 경로에 전달하고, dispose 시 binding을 제거하며, binding 거부 시 terminal session과 composition을 해제한다. owning test 4개가 수정 전에 실패하고 수정 후 통과한다. darwin arm64와 Node 26.11.1에서 owning page test 16개와 pointer 전파 case가 통과하며, 현재 core API source를 사용한 선언된 plugin 검사가 통과한다. 수정은 미배포 상태이며(P66-1), 기존 문서 차이는 P67로 추적한다.

- P65: view 페이지는 doctype으로 시작하고 import map을 갖지 않으며, view literal은 `viewImports`를 갖지 않는다. host가 doctype 뒤에 view import map을 넣는다(core F212.12-1-10-6). Red: module 시험이 map을 가진 page에서 실패했고, core의 `checkViewPage`와 `checkViewLiteral`이 map과 `viewImports` 항목을 보고했다. Green: `make test`가 194개 중 194개를 통과하고, core의 검사가 두 파일을 받아들인다.
- P63: view는 노출 항목을 한 번만 선언한다. 진단 빌드에서 start values가 이미 diagnostics.json 항목을 담으므로 page가 다시 더하지 않아, mount가 `is declared twice`로 실패하지 않는다.
- P60: pre-push 훅이 `make push-check`를 실행한다. 이것은 ci workflow와 같이 `make test`, `make check`, push 범위의 commit message 검사를 실행한다. Red: `.githooks/pre-push`가 없었다. Green: 훅이 검사를 실행한다. `make test`는 시험 191개 중 191개를 통과하고, `make check`는 고정 SDK의 clipboard contract 파일에서 실패하며 이것은 P61이 기록한다.

- F252-terminal-1: view의 exposure port는 core createExpose가 요구하는 대로 host가 거부한 reply를 보고한다.
- F252-contract-terminal: 복사한 screen-hash 사례를 core origin/main에 맞췄다. 한 호출 사례 세 개를 table에 추가했으며, 나머지 다섯 개는 여러 호출이거나 page export가 아니어서 포괄하지 않는다.
- F252-terminal: terminal page는 문자열 `sessionId`가 없는 state event, `null`이거나 object가 아닌 `cursor`, `null`을 포함해 `{directory}`(경로 또는 null)가 아닌 origin을 거부한다. 표면의 sink는 모두 필수다. cursor가 없는 screen message는 화면을 바꾸기 전에 거부한다. 버린 `sequence.rejected` 이유는 `session.rejectedShed`에 세고, 알 수 없는 sidecar event는 `sidecar.unknown`으로 기록한다. not-found가 아닌 diagnostics 상태는 거부한다. 거부된 `runtime.log` 기록은 `where`가 `log`인 `runtime.error`로 보고한다. Red와 Green: `test/terminal.test.mjs`, `test/terminal-view.test.mjs`, `test/view-log.test.mjs`(docs/features.ko.md의 F252-terminal 참조).
- P54.1: CI와 release workflow가 `make test` 뒤에 `make check`를 실행한다. `ci.yml`에는 `make check` 단계가 없었고, `release.yml`은 `make pack`의 선행 단계로만 `make check`를 실행했다. Red: 변경 전 workflow에서 `test/workflows.test.mjs`가 실패했다(`ci.yml`의 target은 `test`, `release.yml`의 target은 `pack`). Green: 두 case가 통과한다. 고정된 release에서는 P58이 pin을 옮길 때까지 `make check`가 첫 단계에서 실패한다.

- P54.2: `test/test-script.test.mjs`가 package.json의 test command가 `test/`의 모든 test file을 하위 디렉터리까지 선택하는지 검사한다. 변경하지 않은 command `node --test test/`가 이미 중첩 test file을 선택하므로 command는 바꾸지 않았다. Red: fault injection으로 바꾼 flat glob command는 중첩 probe file `test/nested/probe.test.mjs`에서 case를 실패시켰다. Green: 변경하지 않은 command는 같은 probe file에서 case를 통과한다.

- P54.3: 복사한 core 계약 case와 view literal이 core main과 같다. `scripts/test-sdk-cases.json`의 복사 case 38개와 view-start digest는 게시된 core main 값과 같고, core main의 `checkViewLiteral`은 `view-check.json`에 차이를 내지 않는다. 파일은 바꾸지 않았다. 대조는 `CORE_PLUGIN_API_DIR`를 지정한 `make check`가 맡고, view literal의 고정된 pin에 대한 실행은 P58을 기다린다.

- F238-b-12: page는 더 이상 `runtime.log.enabled`를 부르지 않는다. 받아들인 `screen` message마다 hash를 계산해 `frame` 기록을 `runtime.log.debug`로 넘기며, class `frame`의 저장 여부는 event log의 writer가 정한다. page는 log level을 읽지 않으므로 screen message마다의 hash 비용은 level로 막히지 않는다.
- P59: release가 view page가 import하는 `ui/view-sidecar.js`를 나열하므로 설치된 release가 이를 제공한다. `test/release-files.test.mjs`는 `ui/*.js`의 모든 상대 import와 `ui/*.html`의 모든 상대 script `src`가 나열된 파일로 해석되는지 검사하며, 선언된 진단 모듈만 예외다. Red: 변경 전 `package.json`에서 테스트가 `ui/terminal-view.js -> ui/view-sidecar.js`와 `ui/view.js -> ui/view-sidecar.js`로 실패했다. Green: `make test`가 177/177 통과하고, core plugin-api 소스를 지정한 `make check`가 네 도구를 모두 통과한다.

- P57: view page가 sidecar call과 구독마다 sidecar `@soksak/sidecar-vt-alacritty`를 명시한다. sidecar port는 `ui/view-sidecar.js`로 옮겼다(P57.1). Red: 변경 전 port에서 `test/view-sidecar.test.mjs`가 `runtime.sidecar.send` params에 sidecar가 없어, `on`과 `onFailure`의 sidecar 이름이 undefined여서 실패했다. view fixture가 이름 없는 sidecar 호출을 거부하자 `test/module.test.mjs`가 9개 중 7개 case에서 실패했다. Green: `make test`가 175/175 통과한다. `make check`는 첫 단계에서 멈추는데, 고정된 release가 `contract/clipboard.json`을 게시하지 않기 때문이다(P58). 네 SDK validator는 직접 실행하면 통과한다.

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
