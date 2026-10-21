# terminal plugin repository 의 test 와 pack(docs/features.md). pack 은 core 의 sok 를 쓴다.
.PHONY: test check pack hooks

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

# check compares copied contract cases with the API source and runs available SDK validators.
# Until an allowed API release publishes contract/clipboard.json, set CORE_PLUGIN_API_DIR to the core package source.
# The pinned release still lacks soksak-view-check; the view-literal check remains explicitly open.
check: node_modules
	CORE_PLUGIN_API_DIR="$(CORE_PLUGIN_API_DIR)" node scripts/check-test-cases.mjs
	pnpm exec soksak-exposure
	pnpm exec soksak-engines
	pnpm exec soksak-events --census census.json --catalog events.json
	pnpm exec soksak-records

pack: check
	@test -n "$(OUT)" || { echo "make pack OUT=<folder>" >&2; exit 2; }
	$(SOK) plugin pack . $(OUT) $(PACK_FLAGS)

# Sets this repository to use .githooks, which checks commit messages and records at commit time.
hooks:
	@git config core.hooksPath .githooks
