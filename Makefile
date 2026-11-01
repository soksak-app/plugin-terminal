# terminal plugin repository 의 test 와 pack(docs/features.md). pack 은 pnpm pack 으로 release 를 쓴다.
.PHONY: install test check pack candidate-install-check push-check hooks

# The installation stage (core docs/spec/plugins.md#repositories): it installs the locked dependencies; the tests, checks and packs consume them without installing.
install:
	pnpm install --frozen-lockfile

# test builds a copied UI tree with literal contract fakes, then runs only plugin tests.
test:
	pnpm test

# check runs the checks of the kit releases that package.json pins: soksak-events counts the records missing from the sources
# and matches events.json with the emit sites, and soksak-records checks the records. The application validates plugin.json
# when it installs the release, and the registry check compares the exposed names of the release with each listed core.
check:
	pnpm exec soksak-events --census census.json --catalog events.json
	pnpm exec soksak-records

pack: check
	@test -n "$(OUT)" || { echo "make pack OUT=<folder>" >&2; exit 2; }
	pnpm pack --pack-destination $(OUT)

# Checks the sidecar version selected by the official installer for a local candidate registry.
candidate-install-check:
	@test -n "$(SOK)" || { echo "make candidate-install-check SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	@test -n "$(REGISTRY)" || { echo "make candidate-install-check SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	@test -n "$(EXPECTED_TERMINAL_VERSION)" || { echo "make candidate-install-check SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	@test -n "$(PREVIOUS_VT_VERSION)" || { echo "make candidate-install-check SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	@test -n "$(EXPECTED_VT_VERSION)" || { echo "make candidate-install-check SOK=<sok> REGISTRY=<folder> EXPECTED_TERMINAL_VERSION=<version> PREVIOUS_VT_VERSION=<version> EXPECTED_VT_VERSION=<version>" >&2; exit 2; }
	SOK="$(SOK)" CANDIDATE_REGISTRY="$(REGISTRY)" EXPECTED_TERMINAL_VERSION="$(EXPECTED_TERMINAL_VERSION)" PREVIOUS_VT_VERSION="$(PREVIOUS_VT_VERSION)" EXPECTED_VT_VERSION="$(EXPECTED_VT_VERSION)" node scripts/candidate-install-check.mjs

# The check that a push needs: the commit messages of the pushed range, because a published commit message is kept; CI runs
# the tests and checks on the pushed commits.
# RANGE holds the commits of the pushed refs; the pre-push hook sets it, and it defaults to origin/main..HEAD.
push-check:
	pnpm exec soksak-commits "$(or $(RANGE),origin/main..HEAD)"

# Sets this repository to use .githooks, which checks commit messages and records at commit time.
hooks:
	@git config core.hooksPath .githooks
