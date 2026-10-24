# Core 호환성

[English](core-compatibility.md)

Terminal package는 core release candidate `0.0.21`의 view manifest contract를 사용한다. `plugin.json`은 `surface.module` 없이 `surface.composition.kind: "view"`를 선언하며, 공개 core `v0.0.20` reader는 `surface.module`을 요구한다. 따라서 `package.json`은 core version-range 규칙에서 현재 candidate에 맞고 `0.0.20` 및 검증하지 않은 이후 version을 제외하는 `engines.soksak: "^0.0.21"`을 선언한다. 이 contract를 담은 core release가 게시될 때까지 package release는 대기한다.

`make check`는 고정된 SDK가 게시한 validator를 실행한다. 고정 SDK가 아직 게시하지 않은 검사를 실행하려면 개발자가 `CORE_PLUGIN_API_DIR`에 로컬 core `packages/plugin-api` 경로를 지정할 수 있다. View literal 검사는 해당 경로의 `view-check.js`에 `view-check.json`과 복사한 `test/fixtures/screen-message.json`을 전달한다. Override가 없으면 설치된 `soksak-view-check` command를 실행한다. Checker가 없으면 오류로 끝나며, override는 package dependency나 release pin을 바꾸지 않는다.
