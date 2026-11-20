# Agent role

이 문서는 terminal plugin page가 core의 agent role 계약([agent roles](https://github.com/soksak-app/core/blob/main/docs/spec/agent-roles.md))을 수행하는 방식을 정의한다. page는 role message를 보내고 자기 tab의 role을 확인한다. role 상태, fingerprint, 확인 command는 core가 소유한다.

## 확인

- page는 보이는 화면의 각 row를 core의 확인 줄과 맞춘다. 양끝 공백을 뺀 row가 `soksak role <fingerprint>`로 끝나고, 그 앞의 텍스트가 비었거나 글자도 숫자도 아닌 표식 뒤에 공백 하나인 경우다. pattern은 core 공유 case 파일 `confirmation-line.json`의 것이다.
- 맞은 fingerprint는 role의 generation마다 한 번 보낸다. view call `runtime.command.run`으로 tab의 surface에서 command `core.tab.role.confirm`에 `{fingerprint}`를 담아 보낸다.
- text `stale fingerprint: read the role file again at <path>`로 거부된 확인은 event `plugin.terminal.messages.role.stale`로 기록하며, 거부된 `fingerprint`와 거부가 도착했을 때 role status의 `current` fingerprint를 담는다. 확인과 role 변경이 엇갈린 결과이며 error가 아니고, error 표시에 아무것도 보이지 않는다. 다음 not-busy 보고가 reread request를 다시 보낸다.
- 다른 이유로 거부된 확인은 error다. `terminal.messages: confirm: <text>` text로 error 표시에 보인다.

## Reread request

- role이 `pending`인 동안 program이 답이 없는 상태(at rest)라고 보고할 때마다 reread request를 하나 보낸다. 상한은 없으며, page는 generation마다 횟수를 센다.
- 횟수는 kind `role-reread`인 event `plugin.terminal.messages.role.delivered`의 필드 `requests`다. page는 core의 횟수를 읽지 않는다.

## page의 규칙

- page는 화면 watch를 추가하지 않는다. 화면 watch마다 sidecar가 `screen.read`를 보내므로, page는 보이는 row가 바뀔 때 도는 자기 화면 handler에서 확인 줄을 맞춘다.
