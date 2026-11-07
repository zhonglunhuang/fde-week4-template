# Staging：部署、回滾、備份與只讀查詢（給組員）

Staging 是線上的測試環境：客戶、老師與技術導師打開網址就能試用，資料全部是測試資料。
每一組一個 Staging，由帶組的技術導師用 Render（網站）與 Neon（資料庫）代管（建立的方法在 `docs/staging-mentor.md`）。
組員不用註冊這兩個服務，也拿不到資料庫的密碼：部署、回滾、備份與只讀查詢都在你們組的 GitHub Repo 上操作。

| 要做的事 | 在哪裡 | 大約多久 |
|---|---|---|
| 看線上是哪一版 | `Staging 網址/api/version`，或頁面最下面的「版本」 | 馬上 |
| 部署（含部署指定的版本、回滾） | Actions →「部署 Staging」→ Run workflow | 5–10 分鐘 |
| 備份資料庫 | Actions →「備份 Staging 資料庫」→ Run workflow | 約 1 分鐘 |
| 只讀查詢 | Issues → New issue →「Staging 只讀查詢」 | 約 1 分鐘 |
| 看 Log | 請帶組的技術導師協助 | — |

- Staging 的網址寫在 README 的「Staging」一節（技術導師建好後填）。
- 測試帳號的名稱在 README 的「測試帳號」一節；Staging 的初始密碼由帶組的技術導師當面告訴你，不寫進任何文件、聊天室或 Commit。
  Staging 的測試帳號全組與技術導師共用，**不要改密碼**（改了，其他組員與技術導師就登不進去）；「第一次登入就改密碼」是 Day 16 交給客戶的帳號。
- 用 Postman 呼叫 Staging，`password` 要換成 Staging 的密碼（技術導師給的初始密碼），不是你本機 `.env` 的 `SEED_USER_PASSWORD`。
- Staging 只放假資料：姓名用「測試客人甲」這類一看就知道是測試的名字，電話用組內約定的假號碼。

## 1. 看線上的版本

打開 `Staging 網址/api/version`：

```json
{"commit":"9e3b6d0a1c2f4e5d6b7a8c9d0e1f2a3b4c5d6e7f","short":"9e3b6d0","startedAt":"2026-11-20T11:18:30.123+08:00"}
```

- `commit` 是線上正在跑的 Commit，`short` 是它的前 7 碼（頁面最下面的「版本 9e3b6d0」也是它）。`startedAt` 是這一版啟動的時間（台灣時間）。
- 要確認線上就是 `stage` 最新的 Commit：在 GitHub 的 Commits 頁（分支選 `stage`）看最上面那一個的編號，或在專案資料夾執行 `git fetch origin && git log origin/stage -1 --format=%h`，和 `short` 比對。
- 要確認線上就是某個標籤（例如 `v1.0.0-rc1`）：打開 Repo 的 Tags 頁，看標籤指向的 Commit 編號，和 `short` 比對。

## 2. 部署

合併進 `stage` 不會自動部署：「已經合併」不等於「已經部署」。合併之後，要有人執行「部署 Staging」，線上才會換成新版。

1. 確認要放進這一版的 PR 都已經合併進 `stage`，PR 頁面下方的「檢查」是綠勾。
2. Repo 的 Actions → 左邊選「部署 Staging」→ 右邊按 Run workflow。
3. 「要部署的版本」維持 `stage`（部署 `stage` 最新的 Commit），按綠色的 Run workflow。
4. 等 5–10 分鐘（免費方案的服務閒置會休眠，叫醒要約 1 分鐘，打包要幾分鐘）。打開這一次的執行，最上面的摘要：
   - **部署完成**：寫著版本、完整的 Commit、部署前線上的版本、開始與完成時間（台灣時間）、健康檢查正常、部署前備份的檔名。綠勾代表線上已經是這個版本，而且 `/api/health` 回 200。
   - **部署沒有完成**：寫著原因與接下來怎麼做。把這一頁的網址傳給帶組的技術導師；需要先恢復服務時，照下一節回到上一個正常的版本。
5. 再打開 `Staging 網址/api/version` 確認 `short`（第 1 節）。

部署前會自動做的事：

- 有設定唯讀連線時，先備份資料庫（檔名 `pre-deploy-版本-時間.dump`，在同一頁最下面的 Artifacts）。備份沒有完成就不會部署。
- 只部署已經合併進 `stage` 的版本（或 `stage` 以前的版本）。還在 PR 裡、沒有合併的分支，不會部署。

部署之後，新版啟動時自動執行還沒跑過的 Migration；資料庫還沒有任何帳號時，放入種子資料（密碼是技術導師設定的初始密碼）。

## 3. 部署指定的版本、回滾

「部署 Staging」的版本欄可以填：

| 填什麼 | 例子 | 用在什麼時候 |
|---|---|---|
| `stage` | `stage` | 部署最新的版本（預設） |
| 標籤 | `v1.0.0-rc1` | 部署或回到某個候選發布版本 |
| Commit 編號（7 碼以上） | `9e3b6d0` | 回到某一個 Commit，例如「部署完成」摘要裡「部署前線上的版本」 |

回滾就是用「部署 Staging」部署上一個正常的版本（重新打包，約 5–10 分鐘）：

1. 找出上一個正常的版本：上一次「部署完成」的摘要、Day 15 標的 `v1.0.0-rc1`，或 Commits 頁上的編號。
2. 先看要回去的版本之後，有沒有新的 Migration：

   ```bash
   git fetch origin
   git log --oneline 要回去的版本..origin/stage -- backend/db/migrations
   ```

   沒有輸出就是沒有。有的話，因為 Migration 只新增（只加表、加欄位），舊版程式照樣能用新的資料庫，回滾不會擋下；
   但要記下來：回滾只換程式，不會還原資料庫，新加的表或欄位還在，已經寫進去的資料也還在。
3. Actions →「部署 Staging」→ Run workflow，版本填上一個正常的版本，按 Run workflow，等摘要寫「部署完成」。
4. 確認恢復：`/api/version` 的 `short` 是回滾目標；用壞掉的那個操作再試一次，確認正常了。

- 資料被改壞了：回滾救不回資料。先備份（第 4 節），再找帶組的技術導師決定怎麼處理；整個還原資料庫只由技術導師做。
- 技術導師也可以在 Render 直接按 Rollback（不用重新打包，比較快；免費方案只能回到最近兩次部署）。他按完之後，要再打開 Render 的自動部署，「部署 Staging」才會繼續有效（`docs/staging-mentor.md`）。

## 4. 備份資料庫

修改 Staging 的資料之前，一定先備份。

1. Actions → 左邊選「備份 Staging 資料庫」→ Run workflow。
2. 原因欄寫要做什麼（例如「修改測試資料之前」），按 Run workflow。
3. 約 1 分鐘後打開這一次的執行，摘要最上面是「備份完成」：檔名（例如 `staging-20261120-111830.dump`，時間是台灣時間）、時間、大小、原因、執行的人。把檔名記進變更紀錄。
4. 備份檔在同一頁最下面的 Artifacts，保留 30 天。

- 摘要寫「備份沒有完成」時，不要繼續修改資料，把這一頁的網址傳給帶組的技術導師。
- 備份用唯讀帳號執行，不會改到任何資料。每次部署前也會自動備份一次。
- 還原只由技術導師做：要還原時，把備份檔名與執行的網址給他。

## 5. 只讀查詢

要在 Staging 找資料（例如確認某一天有幾筆資料）時，用 Issue 表單，不用資料庫的密碼：

1. Repo 的 Issues → New issue → 選「Staging 只讀查詢」。
2. 標題保留開頭的「[Staging 查詢]」，後面寫一句說明。
3. SQL 欄貼上一個 `SELECT`（也可以是 `WITH` 或 `EXPLAIN` 開頭），可以多行、可以有 `--` 註解；「為什麼要查」寫一句。按 Submit new issue。
4. 約 1 分鐘後，結果會留言在這個 Issue：執行時間、SQL、結果的表格（最多 200 列）與列數。
5. 請第二位組員看過結果的範圍，在同一個 Issue 留言確認。

- 只能查、不能改：用唯讀帳號、在唯讀交易裡執行，最後一律還原；`UPDATE`、`DELETE` 這類指令會被拒絕，留言會說明原因。
- 查詢超過 10 秒會被停止；時間一律是台灣時間，`current_date` 是台灣的今天。
- 要改 SQL 重新查：編輯這個 Issue 的內容，存檔後會再查一次、再留一則留言。
- 錯誤只會顯示 PostgreSQL 的訊息（例如 `relation "orders" does not exist`），不會顯示連線資訊。
- Agent 可以幫你寫 `SELECT`，執行一律走這個 Issue 表單。
- 系統沒有對應的功能、非改資料庫不可時，由技術導師在 Neon 執行（先備份、兩個人看過指令），並記進變更紀錄。

## 6. Log

Staging 的 Log 在技術導師的 Render 帳號。要看某個時間的錯誤，把時間（台灣時間，到分鐘）與畫面上看到的狀況告訴帶組的技術導師；
錯誤回應的 Header 有 `X-Request-Id`（4 碼），一起給他，他可以用它找到同一個請求的每一行 Log。

- Log 不能印出客人的姓名、電話、地址、密碼或 Token：要辨識使用者只記 `user_id`（`AGENTS.md`）。Day 16 技術導師會把 Log 存成檔案，搜尋有沒有電話。

## 7. Migration 的注意事項

- Migration 放在 `backend/db/migrations/`，只新增：加表、加欄位、加索引；不刪欄位、不刪表、不改型別、不清空資料。
- 部署時，新版啟動前會自動執行還沒跑過的 Migration；這時舊版還在服務，所以新的 Migration 要讓舊版程式也照常能用（只新增就做得到）。
- 回滾不會撤銷 Migration：回滾前先看要回去的版本之後有沒有新的 Migration（第 3 節）。
- 技術審核會用這兩行檢查 Day 14 之後的 Migration：

  ```bash
  git log origin/stage --since="YYYY-MM-DD" --name-only --format= -- backend/db/migrations | sort -u
  grep -rn -i -E "drop|rename|truncate|delete from|alter column|update .* set " backend/db/migrations
  ```

## 8. 常見狀況

| 狀況 | 原因 | 怎麼辦 |
|---|---|---|
| 打開網址要等快 1 分鐘才有畫面 | 免費方案閒置 15 分鐘會休眠，第一個請求要等它醒來 | 等它醒來；要給客戶或老師試用前，自己先打開一次 |
| 合併了，線上還是舊版 | 合併不會自動部署 | 執行「部署 Staging」（第 2 節） |
| 「部署沒有完成」：找不到要部署的版本 | 版本打錯，或標籤還沒建好 | 確認標籤或 Commit 編號；標籤要先在 GitHub 建好 |
| 「部署沒有完成」：還沒有合併進 stage | 填了還在 PR 裡的分支 | 先合併，再部署 `stage` |
| 「部署沒有完成」：20 分鐘內版本沒有變 | 打包或啟動失敗（例如程式有錯、少了環境變數） | 把執行的網址傳給技術導師看 Render 的紀錄；要先恢復就回滾（第 3 節） |
| 「部署沒有完成」：健康檢查沒有通過 | 新版上線了，但連不上資料庫 | 傳給技術導師；要先恢復就回滾 |
| 「Staging 還沒設定好」 | Repo 還沒設定 Secrets 或 Variables | 找帶組的技術導師，請 Repo 擁有者一起設定 |
| 只讀查詢的 Issue 一直沒有回覆 | 標題開頭不是「[Staging 查詢]」，或開 Issue 的人不是 Repo 的協作者 | 改標題（保留「[Staging 查詢]」開頭）再存一次；還是沒有就看 Actions 的「Staging 只讀查詢」 |
| 登入時「帳號或密碼不正確」 | 打的不是技術導師給的初始密碼（例如打成本機 `.env` 的 `SEED_USER_PASSWORD`），或有人改過密碼 | 改用技術導師給的初始密碼；還是不行，請技術導師協助。Staging 的測試帳號不要改密碼 |
| 「登入失敗太多次，請 15 分鐘後再試」（或修改密碼時「目前的密碼錯太多次」） | 15 分鐘內對同一個帳號錯了 10 次。登入時，在同一個網路（例如教室的 Wi-Fi）的人，對這個帳號會一起被擋 | 從第一次錯算起，最多 15 分鐘就會自動解除（被擋的時候再試，不會延長、也不會提早解除）；急著用（例如要示範、驗收），請帶組的技術導師重新啟動 Staging（約 1 分鐘，資料不變） |
| Postman 對 Staging「取得 Token」回 401「帳號或密碼不正確」 | `password` 還是本機 `.env` 的 `SEED_USER_PASSWORD` | 換成 Staging 的密碼（技術導師給的初始密碼），再送一次「取得 Token」 |
| Postman 對 Staging 的其他請求一直回 401 | 用了本機的 Token | `base_url` 換成 Staging 的網址、`password` 換成 Staging 的密碼後，重送「取得 Token」 |
