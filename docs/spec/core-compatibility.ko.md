# Core 호환성

[English](core-compatibility.md)

Terminal package는 core release candidate `0.0.21`의 view manifest contract를 사용한다. `plugin.json`은 `surface.module` 없이 `surface.composition.kind: "view"`를 선언하며, 공개 core `v0.0.20` reader는 `surface.module`을 요구한다. 따라서 `package.json`은 core version-range 규칙에서 현재 candidate에 맞고 `0.0.20` 및 검증하지 않은 이후 version을 제외하는 `engines.soksak: "^0.0.21"`을 선언한다. 이 contract를 담은 core release가 게시될 때까지 package release는 대기한다.
