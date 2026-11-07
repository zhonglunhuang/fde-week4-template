---
name: run-checks
description: 改完程式碼後必跑的最小驗證。當完成任何程式改動、要確認沒弄壞東西、或使用者說「檢查/測試一下」時使用。
---

# 改完一定要跑的檢查

任何改動完成後，**至少**跑對應的檢查，全綠才算完成。
本清單由 setup 初始化時填寫、之後由 framework 入口維護（技術棧變了要同步改這裡與 Makefile）。

## 票務與框架一致性（一律要跑）

```
make check          # 包含 ticket-lint，以及下面的專案檢查
```

## 專案檢查指令

交付前一定跑完整的檢查：

```
make check   # ticket-lint → npm run lint → npm run typecheck → npm test → npm run build，全部通過最後印 [check] OK
```

- 測試會連本機資料庫（自動建立並使用 `app_test`，不動練習用的 `app`）。
  先確認 `docker compose ps` 的 db 是 `(healthy)`；連不上時測試會直接說明要先 `docker compose up -d db`。
- API 的測試一律用 `backend/test/helpers.ts`：`createTestApp`、`resetTestDb`、`createUser`、`loginAs`。

開發中，改了哪一側先跑哪一段：

| 改了什麼 | 先跑 |
|---|---|
| 後端（`backend/src/`、`backend/test/`） | `npm run lint`、`npm run typecheck`、`npm test` |
| Migration（`backend/db/migrations/`） | `npm run db:migrate`，再 `npm test`（測試會從 000 起重建 `app_test`） |
| 種子資料（`backend/db/seeds/`） | `npm run db:seed` 跑兩次（`.env` 要有 `SEED_USER_PASSWORD`），用 `npm run db:query -- "SELECT …"` 確認沒有重複的資料，再用測試帳號登入一次 |
| 前端（`frontend/`） | `npm run lint`、`npm run typecheck`、`npm run build`，再打開畫面實際操作一次 |

改了後端（`backend/`），記得重新啟動 `npm run dev:api`（後端不會自動重新載入）；前端的程式存檔後畫面會自動更新。
改了 `.env`，後端與前端都只在啟動時讀：要重新啟動用到那個值的 `npm run dev:api` 或 `npm run dev:web`。

## 多介面同步

若變更是使用者可見功能、API 契約、權限、狀態流程，且專案有多個介面（Web / Mobile / 桌面），
除非使用者明確限定只改單一介面，必須同時檢查並驗證所有介面已同步。

## 回報

- 把實際指令輸出講清楚；測試有失敗就貼出失敗內容，不要宣稱通過。
- 檢查不是綠燈就不算完成。
- 若只改單一介面，要說明是使用者明確限定，或其他介面無需同步的具體原因。
