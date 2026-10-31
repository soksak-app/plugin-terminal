# Core 호환성

[English](core-compatibility.md)

Terminal package는 core release `0.0.23`의 view manifest contract를 사용한다. `plugin.json`은 `surface.module` 없이 `surface.composition.kind: "view"`를 선언하며, 공개 core `v0.0.20` reader는 `surface.module`을 요구한다. 따라서 `package.json`은 core version-range 규칙에서 core `0.0.23`에 맞고 이전 version 및 검증하지 않은 이후 version을 제외하는 `engines.soksak: "^0.0.23"`을 선언한다. 이 contract를 담은 core release가 게시될 때까지 package release는 대기한다.

`make check`는 모든 SDK checker를 하나의 `CORE_PLUGIN_API_DIR`에서 실행하며, 기본 경로는 `node_modules/@soksak/plugin-api`다. 개발자는 이를 로컬 core `packages/plugin-api` 경로로 지정할 수 있다. Check는 복사 case validator에도 같은 경로를 전달하고 `view-check.js`, `exposure-check.js`, `engines-check.js`, `events-check.js`, `records-check.js` entry point를 실행한다. 필요한 checker가 없으면 오류로 끝난다. Override는 package dependency나 release pin을 바꾸지 않는다.
