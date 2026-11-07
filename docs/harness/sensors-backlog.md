# sensors-backlog.md — 可機制化的規則（上限 30 行）

> 原則：能用 hook / 測試 / CI 自動擋的，不留文字規則。造好一項就從「待造」移到「現役」。

## 現役（已機制化，文字規則不存在或僅存說明）
- SessionStart hook（`scripts/session-start-hook.sh`）：開場規則與即時狀態注入。
- PreToolUse ticket-gate（`scripts/ticket-gate-hook.sh`）：無票不開發，直接擋寫入。
- ticket-lint（`scripts/ticket-lint.sh`，掛 `make check`）：票格式與一致性。
- PreToolUse git-sync-gate（`scripts/git-sync-gate-hook.sh`）：push 前落後遠端就擋，要求先 pull --rebase。

## 待造（每項：擋什麼 → 怎麼造）
1. **push 後驗終態** [C1]：防「push 成功≠部署成功」→ 加 `make push-verify`（push 後
   `gh run watch` 回報 CI/CD 結論）或 git wrapper；造好後 dispatch.md 該句可縮為一行指引。
2. **harness 檔行數上限**：防制度膨脹 → lint script 進 `make check`：
   dispatch>60 / templates>25 / sensors-backlog>30 / maintenance>25 即紅燈。
3. **CLAUDE.md 路由斷鏈**：防路由指到不存在的檔 → script 掃兩層 CLAUDE.md 的
   `docs/harness/` 引用逐一 `test -e`，掛 `make check`。
4. **教訓活性注入** [猜]：防學習迴路死掉 → session-start hook 加一行
   「memory 教訓數 N、最近一條標題」。
5. **大量讀取警示** [猜]：防主對話下場掃檔 → PreToolUse hook 對單次 Read >300 行
   提示「考慮派 Explore」；可能誤傷正常操作，先觀察再決定是否常駐。

## 兩道確認閘的機制化

- 現況：規則層（pm/dev SKILL + AGENTS.md 嚴禁清單）。
- 可機制化：PreToolUse hook 攔 `git push origin stage|prod`，要求存在本回合確認標記
  （例如 cache/.push-approved，由使用者同意後才建立、push 後即刪）。hook 無法互動提問，
  只能以標記檔為證。先觀察規則層遵循度，重犯再上 hook。
