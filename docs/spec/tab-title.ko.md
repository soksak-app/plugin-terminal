# Tab title

[English](tab-title.md)

terminal tab을 여는 쪽은 tab parameter `title`로 tab의 이름을 정한다. 예: `core.layout.open {card, plugin: "terminal", params: {session, title}}`. `plugin.json`의 `surface.params`는 `session` 옆에 `title`을 string member로 선언하고, core는 tab의 params를 그것으로 검사한다(core `docs/spec/plugins.md`).

## 규칙

- params에 `title`이 있는 tab은 view가 시작할 때 그것을 `tab.title`로 알리고(core `docs/spec/plugins.md#tab-reports`), tab은 이름 대신 그것을 보인다.
- 그런 tab의 view는 program title(OSC 0과 OSC 2)을 tab에 알리지 않으며, 설정 `title`은 그 tab에 적용되지 않는다. program title은 쓰이지 않는다: terminal의 card footer는 작업 디렉터리를 보이므로(core `docs/spec/plugins.md`, `tab.footer`) footer도 그것을 받지 않는다.
- 값은 `tab.title`의 text 규칙을 따른다: 제어 문자(U+0000–U+001F, U+007F–U+009F) 없는 1~256자 string. 숫자, 빈 string, 제어 문자가 있는 text 같은 다른 값은 view가 session을 열거나 attach하기 전에 `tab title must be a text of 1 to 256 characters without control characters`로 view의 시작을 거절한다. `surface.params`의 schema 문법에는 길이나 문자 keyword가 없으므로 나머지 규칙은 view가 검사한다.
- `title`은 `session`, `program`·`args`·`role`, shell과 함께 쓸 수 있다. `title`이 없거나 `null`인 tab은 설정 `title`이 고르는 대로 program title이나 이름을 보인다.
