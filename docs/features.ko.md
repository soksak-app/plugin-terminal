# 기능

[English](features.md)

- [o] P1 — P1: 이 plugin을 자기 repository로 test하고 pack한다. 2026-10-02에 soksak core repository(그곳의 checklist 항목 R1-5-3)에서 옮겼으며, 이전 변경 이력은 core에 있다. `make test`와 `make pack`이 통과한다.
- [o] P2 — P1: soksak core 0.0.2용 version 0.0.2를 release한다. 2026-10-02 완료: `package.json`이 0.0.2와 `engines.soksak` `^0.0.2`를 선언하고, test는 core tag `v0.0.2`의 `@soksak/plugin-api`를 쓴다. macOS arm64에서 `make test`가 통과한다.
- [o] P3 — P1: 페이지와 섹션의 공개 이름을 검사한다. 2026-10-02 core checklist 항목 R1-5-5를 위해 완료: `make test`가 core tag `v0.0.2`의 `@soksak/plugin-api`의 `soksak-exposure`를 실행해 `ui/`의 모든 이름을 `plugin.json`과 core 선언에 대해 비교하며, macOS arm64에서 통과한다.
- [o] P4 — P1: 터미널 padding을 변마다 정한다(2026-10-03 사용자 요청). 설정 `padding.top`, `padding.right`, `padding.bottom`, `padding.left`는 0에서 64까지의 정수(pt)이며 기본값은 0이다. 그림 영역과 그에 따른 셀 격자는 padding 안쪽을 차지하고, padding은 터미널 바탕색을 보이며, 스크롤바는 영역의 오른쪽 가장자리에 머물고, 바꾸면 바로 적용된다. Red: 플러그인 test `padding settings inset the region on each side and show the terminal background`가 안쪽 배치 없이 실패했다. core 표면 합성이 네이티브 anchor의 조상에 배경을 금지하므로 padding은 선언된 overlay 띠 네 개다. Green: `make test`가 118개 test로 통과하고, core window check가 두 host에서 통과한다(core G1.4-72).
