# 貢獻指南

開始前**先讀 [AGENTS.md](AGENTS.md)**（工程契約，唯一事實來源）。本檔補充協作流程：分支模型、commit 規範、PR 流程。

---

## 分支模型 — 「分支即環境」

| 分支 | 對應 | 部署 |
|------|------|------|
| `stage` | 預設整合分支 | 部署到 Staging：合併不會自動部署，要執行 GitHub Actions 的「部署 Staging」（先問使用者） |
| `prod` | 正式環境 | 一般是把驗過的 `stage` merge 進來（這門課不建立） |
| `feature/*`、`fix/*` | 你的工作分支 | 不部署；開 PR 回 `stage` |

流程：

```
從 stage 開工作分支 → 開發 → make check 綠燈 → 開 PR 回 stage
   → review / 驗證 → merge 進 stage
   →「部署 Staging」部署到 Staging（實機驗收）
   → 驗過後把 stage merge 進 prod（這門課不建立）
```

> ⚠️ 別直接 push 到 `prod`；進 `stage`/`prod` 與部署都是對外動作，先取得使用者確認。
> push 前先 `git pull --rebase origin <分支>`（`scripts/git-sync-gate-hook.sh` 機制化強制）。

---

## Commit 規範

用 Conventional Commits 前綴，描述可用繁體中文：

```
feat: 新增訂單匯出
fix: 修正列表分頁邊界
chore: rename repo
docs: 補工程文件
refactor: 抽出狀態轉換
test: 補並發測試
```

常用前綴：`feat` / `fix` / `chore` / `docs` / `refactor` / `test` / `perf` / `ci`。

---

## PR 前的檢查清單

提 PR 前在本機跑過，避免紅燈：

- [ ] `make check` 綠燈（至少含 ticket-lint；專案檢查指令見 AGENTS.md「最小驗證」）。
- [ ] 對應功能票存在且狀態正確；`docs/SPEC.md` 已同步這次變更。
- [ ] 多介面專案：API 契約變動時所有介面都同步更新，除非明確只改單一平台。
- [ ] 對照 [docs/PRINCIPLES.md](docs/PRINCIPLES.md) 的落地清單（並發 / idempotency / N+1 / 權限 / 遷移安全性）。
- [ ] 沒有 commit 任何 env 實檔、祕密或備份檔。

PR 說明建議寫清楚：改了什麼、為什麼、各介面處理結果、跑過哪些檢查。

---

## 嚴禁（摘自 AGENTS.md）

- ❌ commit env 實檔、祕密、備份檔（只有 `.example` 進版控）。
- ❌ 無票開發產品程式碼；改功能不同步 `docs/SPEC.md`。
- ❌ 閘門失敗硬上（票務 / git 同步 / 部署檢查）。
- ❌ 未經確認執行對外、難復原的動作（部署、merge 整合/正式分支、刪 / 覆蓋資料）。

完整契約見 [AGENTS.md](AGENTS.md)。
