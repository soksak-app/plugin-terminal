# terminal plugin repository 의 test 와 pack(docs/features.md). pack 은 core 의 sok 를 쓴다.
.PHONY: test check pack push-check hooks

SOK ?= sok
# DIAGNOSTICS=1 이면 diagnostics.json 을 담은 진단 package 를 쓴다.
PACK_FLAGS = $(if $(DIAGNOSTICS),--diagnostics,)
CORE_PLUGIN_API_DIR ?= node_modules/@soksak/plugin-api

# test 는 package.json 이 정한 core commit 의 @soksak/plugin-api 를 쓴다.
node_modules: package.json
	pnpm install
	touch node_modules

# test builds a copied UI tree with literal contract fakes, then runs only plugin tests.
test: node_modules
	pnpm test

# check compares copied contract cases and the view literal with the API source, then runs SDK validators.
# Set CORE_PLUGIN_API_DIR to a local core package source when the pinned release lacks a checker.
VIEW_CHECK = $(if $(filter environment command line,$(origin CORE_PLUGIN_API_DIR)),node "$(CORE_PLUGIN_API_DIR)/view-check.js",pnpm exec soksak-view-check)

check: node_modules
	CORE_PLUGIN_API_DIR="$(CORE_PLUGIN_API_DIR)" node scripts/check-test-cases.mjs
	$(VIEW_CHECK) view-check.json test/fixtures/screen-message.json
	pnpm exec soksak-exposure
	pnpm exec soksak-engines
	pnpm exec soksak-events --census census.json --catalog events.json
	pnpm exec soksak-records

pack: check
	@test -n "$(OUT)" || { echo "make pack OUT=<folder>" >&2; exit 2; }
	$(SOK) plugin pack . $(OUT) $(PACK_FLAGS)

# The checks of the ci workflow that a push needs: make test, make check, and the commit messages of the pushed range.
# RANGE holds the commits of the pushed refs; the pre-push hook sets it, and it defaults to origin/main..HEAD.
push-check: test check
	pnpm exec soksak-commits "$(or $(RANGE),origin/main..HEAD)"

# Sets this repository to use .githooks, which checks commit messages and records at commit time.
hooks:
	@git config core.hooksPath .githooks
