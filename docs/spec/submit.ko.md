# Submit 명령

[English](submit.md)

명령 `terminal.submit`은 한 문장을 paste로 terminal session에 보내고, 이어서 paste의 reply 뒤에 Enter를 별도의 입력으로 보낸다. 그래서 terminal 안의 program은 문장을 paste된 한 줄로 받고, 그다음 그 문장을 제출하는 key를 받는다. Paste burst 규칙을 가진 agent처럼 빠르게 입력된 text를 paste로 받는 program은 입력된 text 바로 뒤의 Enter를 입력의 새 줄로 받는다. 그런 program에게 bracketed paste와 그 reply 뒤의 Enter는 한 줄과 그 제출이다. Page는 core `docs/spec/messaging.md#injected-message`의 message를 같은 함수로 주입한다.

## 계약

- 이름: `terminal.submit`.
- 입력: `{text}`. `text`는 string이다.
- 거절: 입력을 보내기 전에 명령 이름과 이유를 담은 명시적 오류로 거절한다.
  - `text`가 string이 아니거나 빈 string이다.
  - `text`에 carriage return(U+000D) 또는 line feed(U+000A)가 있다.
- 기록: 아래 순서로 각각 terminal session의 입력 queue를 거쳐 입력 하나로 보낸다.
  1. `text`를 담은 `paste` 하나. Program이 bracketed paste mode(mode 2004)를 켰으면 sidecar는 bracketed paste로, 아니면 text로 쓴다.
  2. Paste의 reply 뒤에 key action 하나. `key`는 `Enter`이고 `shift`, `alt`, `ctrl`은 모두 `false`이다.
- 결과: sidecar가 두 기록에 답한 뒤 `null`. 대상 program이 text나 Enter를 받아들였다는 뜻이 아니다.
- 확인: 호출자는 결과가 아니라 status로 submit을 확인한다. `terminal.screen`의 입력 줄과 program의 작업 중 상태가 program이 문장을 받아 일을 시작했는지 보여준다.
- 명령은 두 기록 사이에 timer를 기다리지 않는다. Enter는 paste의 reply를 따른다.

## 오류

거절은 입력을 보내지 않고 오류로 명령을 끝낸다. 그래서 오류를 받은 호출자는 아무것도 보내지 않았음을 안다. Destructive command guard의 `guardRefused`처럼 기록을 거절하는 sidecar의 reply는 terminal의 error display가 보이는 오류 `terminal.submit: <error>: <reason>`으로 명령을 끝내며, 거절된 paste는 Enter를 보내지 않는다. 두 기록 중 하나의 실패는 `terminal.input`과 같은 경로로 명령의 오류가 된다.
