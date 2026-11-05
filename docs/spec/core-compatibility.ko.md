# Core 호환성

[English](core-compatibility.md)

Terminal package는 core release `0.0.24`의 view manifest contract를 사용한다. `plugin.json`은 `surface.module` 없이 `surface.composition.kind: "view"`를 선언하며, 공개 core `v0.0.20` reader는 `surface.module`을 요구한다. `package.json`은 `engines.soksak: "^0.0.37"`를 선언한다. core version-range 규칙에서 이 값은 core release `0.0.37`만 만족하므로 이전 version과 검증하지 않은 이후 version을 제외한다. 0.0.35는 `plugin.json`이 선언하는 `exposes.element`를 받는 첫 core release인 F502-13의 core release의 version이고, core 0.0.34는 그것을 거부한다.

`make check`는 `package.json`이 pin한 kit의 event source 검사와 document 검사를 실행한다. application은 release를 설치할 때 `plugin.json`을 검증하고, registry 검사는 release의 exposed 이름을 각 listed core의 선언과 비교한다.
