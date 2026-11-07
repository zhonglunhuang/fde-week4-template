---
name: setup
description: 模板初始化精靈（首次使用引導）：把框架模板變成使用者自己的專案——設定專案名稱、技術棧、票號前綴、產品目錄、檢查指令，代填 AGENTS.md / SPEC / framework-config，最後移除未初始化標記。當專案根目錄還有 .template-uninitialized、或使用者說「初始化模板 / 開始設定 / setup」時使用。
---

# setup 入口（模板初始化精靈）

你的對象是**第一次拿到這個框架模板的人**，可能不懂 code。目標：15 分鐘內把模板變成
他的專案。全程白話、一次只問一組問題（用 AskUserQuestion）、每步做完就回報做了什麼。

## 0. 檢查狀態與預告

- 根目錄**沒有** `.template-uninitialized` → 已初始化過，告知並改走 team-leader 開場。
- 有 → 先預告流程：「我會問你 5 組問題，然後代你填好所有設定檔；之後每個新對話
  都會自動看到專案簡報。答不出來的都可以先跳過。」

## 1. 逐組提問（AskUserQuestion，一組一問，都可跳過）

1. **專案名稱與一句話定位**：叫什麼？給誰用、解決什麼問題？
   （→ AGENTS.md「這是什麼」、docs/SPEC.md「產品概述」、README.md 標題）
2. **技術棧**：後端 / 前端 / Mobile 各用什麼？還沒定就標「未定」
   （之後走 framework 入口補；→ AGENTS.md「技術棧」「目錄分層」）。
3. **產品程式碼目錄**：程式碼會放在哪些資料夾（例：backend、frontend、src）？
   （→ framework-config `PRODUCT_DIRS`，這是「無票不開發」閘門的守備範圍——
   沒填閘門不會擋任何檔案，務必說明這個影響）
4. **票號前綴與使用者角色**：2–4 個大寫字母（建議專案縮寫，例：TK）；
   產品有哪些使用者角色（例：客戶 / 業務 / 行政）？（→ `TICKET_PREFIX`、tickets/README.md 範例）
5. **檢查指令**：lint / test / build 怎麼跑？有健康檢查 URL 嗎？沒有就跳過
   （→ `.agents/skills/run-checks/SKILL.md`、Makefile `check`、`HEALTH_URL`）。

## 2. 代填（逐檔落地，白話回報每一項）

- **先改畫面上的專案名稱**（模板的佔位名稱是「練習專案骨架」）：`frontend/src/config.ts` 的 `PROJECT_NAME`
  與 `frontend/index.html` 的 `<title>` 換成專案名稱。這兩個檔在產品程式碼的資料夾裡，
  **一定要在下一步填 `PRODUCT_DIRS` 之前改**——填完之後，沒有票就改不動（無票不開發的閘門）。
- `scripts/framework-config.sh`：PROJECT_NAME / TICKET_PREFIX / PRODUCT_DIRS / HEALTH_URL。
- 票號前綴同時設成這個 Clone 的作者前綴：`git config ticket.prefix <前綴>`（存在 `.git/config`、不進版控；
  其他人 Clone 之後各自設定自己的，見 `tickets/README.md`）。
- `AGENTS.md`：把所有 `{{…}}` 佔位區塊換成使用者的答案；答不出的留
  `{{TODO：…}}` 並在回報中列出。
- `docs/SPEC.md`：產品概述（一句話定位、主要角色）；功能總覽表保持空白（開發時再長）。
- `README.md`：把「（未初始化）」的專案段換成專案名稱與定位。
- `.agents/skills/run-checks/SKILL.md` 與 `Makefile`：填實際檢查指令；沒有就留 TODO。
- 檢查 `.gitignore` 是否涵蓋使用者技術棧的常見產物（node_modules、venv、.env 實檔等），
  缺就補。

## 3. git（對外動作，先確認再做）

- 沒有 `.git` → 問是否 `git init`（建議做，框架的票務與留痕都靠版控）。
- 問是否要設 remote；使用者沒有就跳過，不要催。

## 4. 收尾（缺一不算完成）

1. 刪除 `.template-uninitialized`。
2. `docs/FRAMEWORK.md` §3 決策紀錄補一列「專案初始化（setup）」——**不 bump 版號**
   （填佔位符屬專案設定，不是框架變更）。
3. 建議 commit：`chore: 初始化專案（from agent framework template）`（先問再 commit）。
4. 收尾引導（白話）：「設定完成。之後每個新對話會自動出現專案簡報與入口選項。
   現在可以直接跟我說你要做的第一個功能，我會走 pm 入口幫你確認需求、開票、開發。」
5. 有跳過的項目 → 明列清單與補法（framework 入口 / 直接改 framework-config）。

## 紀律

- 答不出的一律可跳過、標 TODO，不擋初始化完成；但要講清楚跳過的影響
  （尤其 PRODUCT_DIRS 沒填 = 票務閘門不設防）。
- 只填佔位符與專案設定，**不趁機改框架規則**；使用者想改規則 → 引導 framework 入口。
- 每一步用「發生什麼事、對你有什麼影響」的白話回報，不丟術語。
