# Submit 명령

[English](submit.md)

명령 `terminal.submit`은 한 문장을 terminal session에 보내고, 이어서 Enter를 별도의 key action으로 보낸다. 그래서 terminal 안의 program은 문장을 입력된 text로 받고, 그다음 그 문장을 제출하는 key를 받는다.

## 계약

- 이름: `terminal.submit`.
- 입력: `{text}`. `text`는 string이다.
- 거절: 입력을 보내기 전에 명령 이름과 이유를 담은 명시적 오류로 거절한다.
  - `text`가 string이 아니거나 빈 string이다.
  - `text`에 carriage return(U+000D) 또는 line feed(U+000A)가 있다.
- 기록: 아래 순서로 각각 terminal session의 입력 하나로 보낸다(`terminal.input`과 키보드가 쓰는 입력 경로와 같다).
  1. `text`를 담은 insert action 하나. replacement range는 바꾸지 않고, attributed text가 아니다.
  2. insert를 보낸 뒤 별도의 입력으로 보내는 key action 하나. `key`는 `Enter`이고 `shift`, `alt`, `ctrl`은 모두 `false`이다.
- 결과: `null`. 결과는 두 기록이 session에 보내졌다는 뜻이다. 대상 program이 text나 Enter를 받아들였다는 뜻이 아니다.
- 확인: 호출자는 결과가 아니라 status로 submit을 확인한다. `terminal.screen`의 입력 줄과 program의 작업 중 상태가 program이 문장을 받아 일을 시작했는지 보여준다.
- 명령은 timer나 두 기록 사이의 지연을 기다리지 않는다. 기록의 순서는 session 입력 queue의 순서를 따른다.

## 오류

거절은 입력을 보내지 않고 오류로 명령을 끝낸다. 그래서 오류를 받은 호출자는 아무것도 보내지 않았음을 안다. 두 기록 중 하나의 실패는 `terminal.input`과 같은 경로로 명령의 오류가 된다.
