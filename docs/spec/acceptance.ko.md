# 터미널 plugin 인수 기준

[English](acceptance.md)

이 plugin은 터미널 그림 영역의 이 기준을 담는다. core는 [표면 합성](https://github.com/soksak-app/core/blob/main/docs/spec/surface-composition.ko.md#인수-기준)의 일반 기준을 유지한다.

- 터미널 그림은 리사이즈 중 논리 텍스트를 보존한다. 폭을 줄이면 열 수를 줄여 긴 논리 행을 여러 화면 행으로 재배치하고, 폭을 늘리면 열 수를 늘려 잘림이나 좁은 상태의 영구 고착 없이 다시 재배치한다.
- 터미널 셀 너비와 높이는 배치 중에도 고정된 표시 메트릭이다. 디바이더 이동은 표면·래스터 기하만 바꾸고 글꼴이나 셀 메트릭을 바꾸지 않으며, 네이티브 기하 변경은 애니메이션하지 않는다.

- terminal view의 primary pointer 누름은 shared exposure binder를 통해 선언된 `terminal.focus` command를 실행한다. command는 native image region으로 keyboard 소유권을 넘긴다. view는 기본 DOM focus를 막고, focus 실패를 `terminal.session`과 surface 오류 경로로 보고하며, page를 dispose할 때 binding을 제거한다. 별도 view document는 main document의 card로 pointer가 bubble되는 데 의존하지 않는다.
