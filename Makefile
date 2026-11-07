# Makefile — 統一指令入口。
# check 就是「改完一定要跑的檢查」（與 CI、AGENTS.md「最小驗證」、run-checks skill 一致）。
# 測試會連本機資料庫，先 docker compose up -d db。

.PHONY: help check ticket-lint new-ticket

help: ## 列出所有指令
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

check: ticket-lint ## 跑所有檢查（= CI）：票務、程式風格、型別、測試、正式版打包
	npm run lint
	npm run typecheck
	npm test
	npm run build
	@echo "[check] OK"

ticket-lint: ## 票務格式與一致性檢查
	./scripts/ticket-lint.sh
	@bash scripts/ticket-tools-test.sh  # 守規則的工具自己也要有測試（源專案 v4.12.1）

new-ticket: ## 開新票（先 fetch 遠端再取號防撞號）：make new-ticket t="短題" r="行政"
	@./scripts/new-ticket.sh "$(t)" "$(r)"
