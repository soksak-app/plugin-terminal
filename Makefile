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

# check compares copied contract cases and runs every validator from one SDK directory.
SDK_CHECKERS = view-check.js exposure-check.js engines-check.js events-check.js records-check.js

check: node_modules
	@for checker in $(SDK_CHECKERS); do \
		if [ ! -f "$(CORE_PLUGIN_API_DIR)/$$checker" ]; then \
			echo "missing SDK checker: $(CORE_PLUGIN_API_DIR)/$$checker" >&2; exit 1; \
		fi; \
	done
	CORE_PLUGIN_API_DIR="$(CORE_PLUGIN_API_DIR)" node scripts/check-test-cases.mjs
	node "$(CORE_PLUGIN_API_DIR)/view-check.js" view-check.json test/fixtures/screen-message.json
	node "$(CORE_PLUGIN_API_DIR)/exposure-check.js"
	node "$(CORE_PLUGIN_API_DIR)/engines-check.js"
	node "$(CORE_PLUGIN_API_DIR)/events-check.js" --census census.json --catalog events.json
	node "$(CORE_PLUGIN_API_DIR)/records-check.js"

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
