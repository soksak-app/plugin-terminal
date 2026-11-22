# Tab directory

[English](tab-directory.md)

terminal tab을 여는 쪽은 tab parameter `directory`로 session이 시작할 디렉터리를 정한다. 예: `core.layout.open {card, plugin: "terminal", params: {program, args, directory}}`. `plugin.json`의 `surface.params`는 `session`과 `title` 옆에 `directory`를 string member로 선언하고, core는 tab의 params를 그것으로 검사한다(core `docs/spec/plugins.md`).

## 규칙

- params에 `directory`가 있는 tab은 그 디렉터리에서 session을 연다. sidecar의 `open` 요청이 그 값을 `directory`로 담고, card의 footer는 session의 시작 디렉터리로 그 값을 보인다.
- 값은 core `docs/spec/native-surfaces.md`(origin 거절)의 규칙을 따르는 절대 경로여야 한다: `/`로 시작하고, `//` 또는 `/<letter>:`로 시작하지 않으며, NUL 바이트가 없다. 빈 string을 포함한 다른 값은 view가 session을 열기 전에 `tab directory must be an absolute path: <value>`로 view의 시작을 거절하므로 session이 시작하지 않는다.
- `directory`가 없거나 `null`이면 시작 디렉터리는 tab의 origin 디렉터리, 프로젝트 루트, 홈 디렉터리 순서다(surface의 origin 규칙). `directory` param은 origin 디렉터리의 자리를 대신하고 나머지 순서는 그대로다.
- tab의 디렉터리는 시작 디렉터리일 뿐이다. 셸이 알리는 디렉터리(OSC 7)는 전과 같이 footer와 서비스 교체 때 다시 여는 디렉터리를 바꾼다.
- `directory`는 `program`, `args`, `role`, `title`, shell과 함께 쓸 수 있다. `session`과는 함께 쓰지 않는다: owned session을 이름 짓는 tab은 그 session에 attach하고 session을 열지 않으므로 `directory`를 읽지 않는다.
