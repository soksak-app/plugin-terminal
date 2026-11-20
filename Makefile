# terminal plugin repository 의 test 와 pack(docs/features.md). pack 은 pnpm pack 으로 release 를 쓴다.
.PHONY: install test test-app check check-manifest pack check-candidate-install check-push install-hooks test-app-agent-role

# The installation stage (core docs/spec/plugins.md#repositories): it installs the locked dependencies; the tests, checks and packs consume them without installing.
install:
	pnpm install --frozen-lockfile

# test runs the plugin tests under test/, which import the UI modules and resolve the plugin API to the fixtures of test/fixtures/plugin-api/.
test:
	pnpm test

# test-app runs the window checks of e2e/ against the published core application of the @soksak/window-check release that
# package.json names (docs/operations/window-checks.md). It needs a display and a person's computer, so it runs only locally and
# no workflow runs it.
test-app:
	pnpm exec sok-test-app

# test-app-agent-role runs the acceptance of the agent roles (acceptance/agent-role.test.mjs): the real Claude Code and Codex in tabs
# that core.layout.open opens with a role, judged by the status core.tab.role. It needs a display and a person's computer and runs
# only when the person runs it; `make test-app` does not run it.
test-app-agent-role:
	pnpm exec sok-test-app acceptance/agent-role.test.mjs

# check runs check-manifest and the checks of the kit releases that package.json pins: sok-check events counts the records missing
# from the sources and matches events.json with the emit sites, and sok-check docs checks the records. The registry check compares
# the exposed names of the release with each listed core.
check: check-manifest
	pnpm exec sok-check events --config event-sources.json --catalog events.json
	pnpm exec sok-check docs
	pnpm exec sok-check commands

# check-manifest reads plugin.json, diagnostics.json and the files of package.json with the readers of the plugin API release that
# package.json pins, the release of the lowest core that engines.soksak admits, as the installer of core reads them.
check-manifest:
	node scripts/check-manifest.mjs

pack: check
	@test -n "$(OUT)" || { echo "make pack OUT=<folder>" >&2; exit 2; }
	pnpm pack --pack-destination $(OUT)

# Checks the sidecar version selected by the official installer for a local candidate registry.
check-candidate-install:
	@test -n "$(SOK)" || { echo "make check-candidate-install SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	@test -n "$(REGISTRY)" || { echo "make check-candidate-install SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	@test -n "$(EXPECTED_TERMINAL_VERSION)" || { echo "make check-candidate-install SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	@test -n "$(PREVIOUS_VT_VERSION)" || { echo "make check-candidate-install SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	@test -n "$(EXPECTED_VT_VERSION)" || { echo "make check-candidate-install SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	SOK="$(SOK)" CANDIDATE_REGISTRY="$(REGISTRY)" EXPECTED_TERMINAL_VERSION="$(EXPECTED_TERMINAL_VERSION)" PREVIOUS_VT_VERSION="$(PREVIOUS_VT_VERSION)" EXPECTED_VT_VERSION="$(EXPECTED_VT_VERSION)" node scripts/check-candidate-install.mjs

# The checks that a push needs: the commit messages and the checklist history of the pushed range, because a published commit
# is kept; CI runs the tests and checks on the pushed commits.
# RANGE holds the commits of the pushed refs; the pre-push hook sets it, and it defaults to origin/main..HEAD.
check-push:
	pnpm exec sok-check commits "$(or $(RANGE),origin/main..HEAD)"
	pnpm exec sok-check docs --range "$(or $(RANGE),origin/main..HEAD)"

# Sets this repository to use .githooks, which checks commit messages and records at commit time.
install-hooks:
	@git config core.hooksPath .githooks
