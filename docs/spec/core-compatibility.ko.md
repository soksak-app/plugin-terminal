# Core 호환성

[English](core-compatibility.md)

Terminal package는 core release `0.0.24`의 view manifest contract를 사용한다. `plugin.json`은 `surface.module` 없이 `surface.composition.kind: "view"`를 선언하며, 공개 core `v0.0.20` reader는 `surface.module`을 요구한다. 따라서 `package.json`은 core version-range 규칙에서 core `0.0.24`에 맞고 이전 version 및 검증하지 않은 이후 version을 제외하는 `engines.soksak: "^0.0.24"`을 선언한다. 이 contract를 담은 core release가 게시될 때까지 package release는 대기한다.

`make check`는 `package.json`이 pin한 events kit의 census 검사와 records kit의 record 검사를 실행한다. application은 release를 설치할 때 `plugin.json`을 검증하고, registry 검사는 release의 exposed 이름을 각 listed core의 선언과 비교한다.
