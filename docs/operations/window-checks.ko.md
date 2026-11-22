# Window check

[English](window-checks.md)

terminal view의 window check는 이 repository에서, 한 core release의 published application에 대해 `@soksak/window-check`로 실행한다([plugin의 window check](https://github.com/soksak-app/core/blob/main/docs/spec/plugins.md#window-checks-of-a-plugin)). core의 source를 읽지 않고 그 repository의 경로를 이름으로 쓰지 않는다.

## 실행

```sh
make install     # 한 번: locked dependency와 그 안의 @soksak/window-check를 설치
make test-app    # pnpm exec sok-test-app
```

`make test-app`은 display가 있는 computer에서 local로만 실행한다. 이 repository의 workflow는 실행하지 않는다. check는 frame을 보이는 실행 중인 application이 필요하기 때문이며, CI의 check는 `make test`와 `make check`다.

`package.json`은 package의 release file `https://github.com/soksak-app/core/releases/download/v<version>/soksak-window-check-<version>.tgz`를 development dependency로 이름 짓고, 그 version은 `engines.soksak` 안의 core release다. 설치한 package의 version이 run의 application을 정한다. `sok-test-app`은 그 core release의 application zip을 `build/app-cache/<version>/`에 내려받고, 이 repository를 `make pack OUT={out}`으로 pack하고, plugin과 sidecar를 `build/test-app/` 아래 새 configuration folder에 설치하고, 그 folder로 application을 시작하고, `e2e/`의 파일에 `node --test`를 실행한 뒤 application을 종료한다. 통과한 run은 그 folder를 지우고, 실패한 run은 남긴다. package는 `@soksak/client`, `@soksak/log-contract`, `@soksak/plugin-api`를 release file 안에 담으므로 pnpm이 기본 설정으로 설치한다. `pnpm-workspace.yaml`은 package가 folder 감시에 쓰는 `@parcel/watcher`의 build script를 허용한다.

같은 check는 core의 development build와 이 plugin과 그 sidecar의 development checkout에 대해서도 실행한다: run의 각 application은 자기 build에서 `--config-dir <root>/soksak-check-<app>`으로 시작하며, 그 `plugins/installed.json`은 plugin, `@soksak/window-check`의 start probe, sidecar를 나열하고, 그 plugin과 sidecar folder는 checkout으로의 symbolic link다. 그다음 `SOKSAK_CONFIG_ROOT=<root>`와 build의 executable로 정한 `SOKSAK_BINARY_WAILSV3`, `SOKSAK_BINARY_TAURIV2`, `SOKSAK_BINARY_MYGO`로 `node --test e2e/`를 실행한다. 어느 run에서도 check는 application을 시작하지 않는다.

`test/window-checks.test.mjs`는 선언을 검사한다: development dependency가 `engines.soksak` 범위 안의 package의 core release file을 이름 짓고, `e2e/`에 check가 있고, `make test-app`이 `pnpm exec sok-test-app`을 실행한다.

## Check

`e2e/submit.test.mjs`는 run의 각 application마다 test 하나를 180초의 time limit으로 shell `e2e/check-shell`로 실행한다. Program `e2e/paste-burst`는 bracketed paste mode를 켜고 raw mode로 terminal을 읽으며, paste burst 규칙을 가진 agent처럼 입력된 text 뒤 100 millisecond 안에 오는 carriage return을 입력의 새 줄로 받는다. `terminal.submit`이 text를 보내면, check는 제출하는 carriage return에 대해 program이 출력하는 줄 `submitted: <text>`를 요구한다(`docs/spec/submit.md`).

`e2e/injection.test.mjs`는 run의 각 application마다 test 세 개를 각각 180초의 time limit으로, receiver tab과 sender tab이 있는 project window에서 shell `e2e/check-shell`로 실행한다. 각 message를 sender의 surface로 application의 `sok message send`로 쓰고, reply, receiver의 `terminal.messages`와 그 screen을 판정한다(core `docs/spec/messaging.md#injected-message`). Shell은 OSC 133 mark를 알리지 않으므로, 제출된 줄은 shell의 오류 줄로 판정한다. 보고는 `[메시지: not found`, message는 보고 요청의 괄호에 대한 syntax error다.

- 실행 중인 command: receiver는 `cat <named pipe> > /dev/null; echo command-ended`를 실행한다. Reply는 `held: null`을 보이고, `terminal.messages`는 command가 실행되는 동안 message를 `injected`로 알리며, check가 pipe에 쓴 뒤 shell은 `command-ended` 줄 뒤에 주입된 줄을 제출한다.
- Blocked program: receiver는 `e2e/blocked-prompt`를 실행한다. 이 program은 OSC 7501로 `state=blocked:kind=permission`을 알리고, `Proceed? [y/N]`을 보이며 한 줄을 읽는다. Reply는 kind `permission`의 보류 `blocked`를 보이고, `terminal.messages`는 결정 없는 message 하나를 보류하며, screen에는 그 byte가 없다. `terminal.input`으로 답 `y`를 보낸 뒤 program은 `answer=y`를 출력하고, page는 그때 message를 주입하며, shell은 그 줄 뒤에 그것을 제출한다.
- 보고: sender는 sender의 folder로 요청 `(끝나면 결과를 sok message send --reply <sender folder> "<보고>"로 보고하라)`를 담은 message를 쓰고(core `docs/spec/messaging.md#report-request`), 그것은 receiver에 주입된다. 이어서 check는 receiver의 surface로 `sok message send --reply <sender folder> done`을 쓰며, 그 파일 `<receiver>.report-<token>.txt`는 `done`만 담고, sender의 `terminal.messages`는 그것을 `injected`로 알린다.

`e2e/owned-session.test.mjs`는 run의 각 application마다 test 하나를 180초의 time limit으로 실행한다: owner tab이 `core.session.open`으로 `e2e/program-state`를 실행하는 owned session을 연다. 이 program은 OSC 7501로 program state `working`을 알리고, 한 줄을 기다린 뒤 `idle`을 알린다. 두 번째 tab은 params `{session, title}`로 `core.layout.open`하여 그 session을 보인다. check는 `core.sessions`에서 session의 state `working`과 이어서 `idle`, `core.grid`에서 tab의 `label`인 title(`docs/spec/tab-title.ko.md`), 두 tab의 `terminal.session`에서 빈 `unsupported`를 요구한다. 그래서 어느 view도 owner event `session.program`을 처리하지 않는 sidecar event로 나열하지 않는다.
