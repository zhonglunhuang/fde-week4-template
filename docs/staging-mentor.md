# Staging：技術導師怎麼建、怎麼顧（給帶組的技術導師）

每一組一個 Staging，建在帶組技術導師自己的免費帳號：

| 東西 | 在哪裡 | 名稱（例子：梯次 2026a、第 2 組） |
|---|---|---|
| 部署用 Repo（私有、關掉 Actions） | 你的 GitHub | `heri-2026a-g2-staging` |
| 網站（Render 免費 Web Service，Singapore） | 你的 Render | `heri-2026a-g2`（網址以 Render 顯示的為準，例如 `https://heri-2026a-g2.onrender.com`） |
| 資料庫（Neon 免費專案，Postgres 17，Singapore） | 你的 Neon | `heri-2026a-g2` |

運作方式：組員在他們的 Repo 執行「部署 Staging」→ GitHub Actions 把要部署的 Commit 推到你的部署用 Repo 的 `stage` →
Render 收到就重新打包、部署。組員只在 GitHub 操作，不需要 Render、Neon 的帳號，也拿不到資料庫的密碼；Log 在你的 Render。

- 組員用的說明在 `docs/STAGING.md`，部署與備份的腳本在 `backend/scripts/`，workflow 在 `.github/workflows/`。
- 連線字串、Token、各組的初始密碼只放在你自己的密碼管理工具；不要貼進聊天室、文件、試算表、截圖或 Agent 的對話。

## 1. 一次性的準備（每位技術導師，Day 13 前）

1. Render：到 https://render.com 用 GitHub 登入，方案選 Hobby（免費）。要求驗證信用卡就照畫面做，免費方案不收費。
2. Neon：到 https://neon.com 用 GitHub 登入，方案選 Free。
3. 確認你已經是各組 Repo 的協作者（建立 Repo 的組員會在 Day 13 加你）。
4. 每個 Render 帳號建議最多代管 3 組：免費方案每個月的運作時數與打包時間有上限，3 組以上容易用完。

## 2. 每一組（約 20 分鐘；Day 13 下課後到 Day 14 13:00 前）

下面的 `heri-2026a-g2` 換成這一組的名稱。

### 2-1. 部署用 Repo

1. 在你的 GitHub 建立新的 Repo：名稱 `heri-2026a-g2-staging`，選 Private，**不要**勾 Add a README（要空的）。
2. 這個 Repo 的 Settings → Actions → General → Actions permissions 選 Disable actions，按 Save。
   推過來的程式裡有 workflow，不關掉的話會在你的帳號上執行。
3. 第一次推 `stage`：在這一組 Repo 的資料夾（你 Clone 的）執行：

   ```bash
   git fetch origin
   git push https://github.com/你的帳號/heri-2026a-g2-staging.git origin/stage:refs/heads/stage
   ```

### 2-2. 給 GitHub Actions 用的 Token

GitHub 右上角頭像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token：

| 欄位 | 填什麼 |
|---|---|
| Token name | `heri-2026a-g2-deploy` |
| Resource owner | 你自己 |
| Expiration | 45 天（Custom，到結訓後的重審結束以後） |
| Repository access | Only select repositories → 只選 `heri-2026a-g2-staging` |
| Repository permissions | Contents：Read and write；Workflows：Read and write（Metadata 會自動變成 Read-only） |

按 Generate token，先不要關掉這一頁：Token 只顯示這一次，2-6 要貼進這一組的 Repo。
Workflows 也要給 Read and write：推過去的 Commit 裡有 `.github/workflows/` 的檔案，少了這個權限，GitHub 會拒絕推送。

### 2-3. Neon：資料庫

1. Neon → New project：名稱 `heri-2026a-g2`，Postgres version 17，Region 選 AWS Asia Pacific（Singapore），按 Create。
2. 按 Connect：Branch 選 production（預設），Database 選 `neondb`，Role 選 `neondb_owner`，把 Connection pooling **關掉**（直接連線）。
   複製連線字串，這就是 Render 的 `DATABASE_URL`（2-4 會用到）。
3. （選做）Settings → Collaborators 加老師，老師也能看這個資料庫。

### 2-4. Neon：唯讀帳號（給組員的備份與只讀查詢用）

一定要用 SQL 建：在 Neon 的畫面上建立的帳號屬於 `neon_superuser`，可以寫入。

1. 在你的電腦產生唯讀帳號的密碼（hex，放進網址不用另外編碼）：

   ```bash
   openssl rand -hex 16
   ```

2. Neon → SQL Editor（Database 選 `neondb`），把下面整段貼上，第一行的密碼換成上一步產生的那串，按 Run：

   ```sql
   -- 1. 建立唯讀帳號（密碼換成 openssl rand -hex 16 產生的那串）
   CREATE ROLE staging_reader WITH LOGIN PASSWORD '貼上剛才產生的密碼';
   -- 2. 可以連線、看得到 public 裡的資料表
   GRANT CONNECT ON DATABASE neondb TO staging_reader;
   GRANT USAGE ON SCHEMA public TO staging_reader;
   -- 3. 現在的資料表，以及之後 Migration 新增的資料表，都只能讀
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO staging_reader;
   GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO staging_reader;
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON TABLES TO staging_reader;
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON SEQUENCES TO staging_reader;
   -- 4. 預設就是唯讀交易
   ALTER ROLE staging_reader SET default_transaction_read_only = on;
   ```

3. 組出唯讀的連線字串：拿 2-3 複製的連線字串，`//` 後面、`@` 前面是「帳號、冒號、密碼」：
   帳號 `neondb_owner` 換成 `staging_reader`，冒號後面的密碼換成第 1 步產生的那串；
   `@` 後面的主機、`/neondb`、`?sslmode=require&channel_binding=require` 都不動。這就是 `STAGING_READONLY_DATABASE_URL`（2-6 會用到）。

Staging 的網站用 `neondb_owner` 執行 Migration，所以組員之後用 Migration 新增的資料表，`staging_reader` 也自動讀得到。

### 2-5. Render：網站

1. Render → New → Web Service → 選 `heri-2026a-g2-staging`（看不到的話，按 Configure GitHub App，把這個 Repo 加進 Render 可以讀的 Repo）。
2. 照下表填：

   | 欄位 | 填什麼 |
   |---|---|
   | Name | `heri-2026a-g2` |
   | Region | Singapore |
   | Branch | `stage` |
   | Language | Node |
   | Build Command | `npm run staging:build` |
   | Start Command | `npm run staging:start` |
   | Instance Type | Free |

3. Environment Variables（名稱照下表，值不要貼到別的地方）：

   | 名稱 | 值 |
   |---|---|
   | `APP_ENV` | `staging` |
   | `DATABASE_URL` | 2-3 複製的連線字串（`neondb_owner`、直接連線） |
   | `SESSION_SECRET` | 按 Generate，讓 Render 產生 |
   | `API_BASE_URL` | `https://heri-2026a-g2.onrender.com`（Render 在網址加了尾碼的話，建立後照實際網址改） |
   | `SEED_USER_PASSWORD` | 這一組測試帳號的初始密碼：至少 10 個字，例如三個好念的英文字加四位數字；每組不同，存在你的密碼管理工具 |

4. Advanced：Health Check Path 填 `/api/health`；Auto-Deploy 選 On Commit（部署用 Repo 的 `stage` 一有新的 Commit 就部署）。
5. 按 Create Web Service。第一次部署約 3–5 分鐘，Logs 會看到 `[deploy] 執行 Migration：000_create_users_and_sessions……完成`。
6. 打開 `https://heri-2026a-g2.onrender.com/api/version`，`short` 是這一組 `stage` 最新 Commit 的前 7 碼；`/api/health` 是 `{"status":"ok","database":"ok","version":"…"}`。
7. 打開 Staging 的網址（首頁 `https://heri-2026a-g2.onrender.com`），要看到「後端：正常」「資料庫：正常」。
   畫面是靠 `API_BASE_URL` 找後端的：顯示「後端：無法連線」多半是 `API_BASE_URL` 和實際的網址不一樣（例如 Render 加了尾碼），
   照 Render 顯示的網址改好再部署（3-2）。
8. 記下服務 ID：服務頁面網址裡 `srv-` 開頭的那一段（Settings 也看得到）。

- `SEED_USER_PASSWORD` 只在資料庫還沒有任何帳號時用到（含種子資料的版本第一次部署時，建立每一個測試帳號）。之後要換初始密碼，要先清掉帳號，所以一開始就決定好。
- 初始密碼當面告訴組員，並提醒：這些測試帳號全組與技術導師共用（你之後也會用它們登入），**不要改密碼**。
  「第一次登入就改密碼」只用在 Day 16 交給客戶扮演者的帳號（初始密碼一樣當面告知）。

### 2-6. 這一組 Repo 的 Secrets 與 Variables（請 Repo 擁有者在場）

只有 Repo 擁有者（建立 Repo 的組員）看得到這一頁。請他打開這一組 Repo 的 Settings → Secrets and variables → Actions，你在旁邊把值貼進去：

| 種類 | 名稱 | 值 |
|---|---|---|
| Secrets（New repository secret） | `STAGING_MIRROR_TOKEN` | 2-2 的 Token |
| Secrets | `STAGING_READONLY_DATABASE_URL` | 2-4 組出來的唯讀連線字串 |
| Variables（Variables 分頁 → New repository variable） | `STAGING_MIRROR_REPO` | `你的帳號/heri-2026a-g2-staging` |
| Variables | `STAGING_URL` | `https://heri-2026a-g2.onrender.com`（最後不要加 `/`） |

### 2-7. 驗證（和這一組一起）

1. Actions →「部署 Staging」→ Run workflow（版本 `stage`）：摘要寫「部署完成」。
2. Actions →「備份 Staging 資料庫」→ Run workflow（原因填「驗證」）：摘要有檔名與時間，最下面的 Artifacts 有那個 `.dump` 檔。
3. Issues → New issue →「Staging 只讀查詢」，SQL 填 `SELECT count(*) FROM users;`：約 1 分鐘後有留言回覆。
4. 第一版 MVP 合併進 `stage` 之後（Day 14 下課後）：請組員再執行一次「部署 Staging」，用三種身分登入，建立一張訂單。

### 2-8. 填「各組 Staging 一覽」

在課程的 Google 雲端硬碟共用資料夾裡的「Day 15」子資料夾，「各組 Staging 一覽」試算表填一列：

| 組別 | Repo | Staging 網址 | Render 服務 ID | 測試帳號的名稱 |
|---|---|---|---|---|

- 學員也打得開這個資料夾：只寫上面這五欄（組別、Repo、Staging 網址、Render 服務 ID、帳號名稱），
  **不寫任何密碼、Token 或連線字串**。
- 測試帳號的名稱等 T1 的種子資料部署之後再補。

## 3. 日常

### 3-1. 看 Log、存成檔案

- Render → 這一組的服務 → Logs：可以選時間範圍，搜尋 `ERROR` 或 `req=` 後面的 4 碼請求編號。免費方案的 Log 只保留幾天。
- 存成檔案（Day 16 的 Log 檢查用）：Render 的 Account Settings → API Keys → Create API Key，再在任何一組 Repo 的資料夾執行。
  **Render 的 API Key 讀得到這個 Render 帳號裡的每一個服務**（你代管的每一組，還有你自己的其他服務）：
  要用的時候才建、只在你自己的電腦上執行、用完馬上刪掉；不要貼進聊天室、文件、試算表或 Agent 的對話。

  ```bash
  node backend/scripts/render-logs.mjs srv-服務ID 開始日期 結束日期 > staging.log
  # 例：node backend/scripts/render-logs.mjs srv-abc123 2026-11-18 2026-11-20 > staging.log
  ```

  第一次會請你貼上 API Key（畫面不顯示）。日期是台灣的日期，含結束日期那一整天。不需要先 `npm install`。
  搜尋電話：`grep -n -E "(^|[^0-9])09[0-9]{2}-?[0-9]{3}-?[0-9]{3}([^0-9]|$)" staging.log`。
  匯出完就到 Account Settings → API Keys 刪掉這把 Key（下次要用再建一把）。
- 臨時也可以在 Render 的 Logs 頁按 Cmd+Shift+C（Windows 是 Ctrl+Shift+C），複製目前顯示的 Log，貼進文字檔。

### 3-2. 改環境變數

Render → Environment 改完，選 Save, rebuild, and deploy（或 Save and deploy）。重新部署後才生效。

### 3-3. 回滾

| 做法 | 誰做 | 多久 | 說明 |
|---|---|---|---|
| 「部署 Staging」部署上一個正常的版本 | 組員（或你） | 5–10 分鐘（重新打包） | 平常一律用這個：任何版本都回得去，摘要有紀錄 |
| Render 的 Rollback | 你 | 比較快（不重新打包） | 免費方案只能回到最近兩次部署。在 Render 的畫面按 Rollback 會**關掉 Auto-Deploy**：事後到 Settings 把 Auto-Deploy 改回 On Commit，「部署 Staging」才會再生效 |

回滾只換程式，不會還原資料庫。

### 3-4. 還原資料庫（只由技術導師決定與執行）

先和老師確認，並記進這一組的變更紀錄。

- 首選：Neon 的 Restore，回到出事之前的時間點（免費方案只能回到最近幾個小時內）。
- 用組員的備份檔（Artifacts 下載的 `.dump`）：先在自己電腦的 Docker 還原、確認內容，再決定要不要蓋掉 Staging。
  要還原到 Staging 時，在 Neon 的 SQL Editor 先清空 `public`：

  ```sql
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  ```

  再在你的電腦還原（連線字串用 `neondb_owner` 的直接連線；`read -s` 輸入時不會顯示）：

  ```bash
  read -s PGURL && export PGURL
  docker run --rm -i -e PGURL postgres:17-alpine sh -c 'pg_restore --no-owner --no-privileges --dbname="$PGURL"' < staging-20261120-111830.dump
  unset PGURL
  ```

  最後重跑 2-4 的 SQL 從 `GRANT CONNECT` 到最後一行（清空 `public` 會一起清掉唯讀帳號的權限），
  再用「部署 Staging」部署和這個備份同一個版本（部署前的備份檔名裡有版本，例如 `pre-deploy-9e3b6d0-…`）。

### 3-5. 系統沒有對應功能、非改資料庫不可

在 Neon 的 SQL Editor 執行，照這個順序：請組員先執行「備份 Staging 資料庫」→ 用「Staging 只讀查詢」確認範圍 →
兩個人看過要執行的指令 → 執行 → 再查一次確認 → 寫進變更紀錄（誰、何時、改了什麼、備份檔名）。

### 3-6. 重建 Staging 的資料庫（還沒有要保留的資料時）

例如 Day 14 的 Migration 在 Staging 執行過之後又被改過：在 Neon 的 SQL Editor 清空 `public`（3-4 的兩行），
重跑 2-4 的 SQL 從 `GRANT CONNECT` 到最後一行，再到 Render 按 Manual Deploy → Deploy latest commit：
啟動時會從 000 起重跑 Migration，資料庫沒有帳號，所以也會重新放入種子資料。

## 4. 出狀況

| 狀況 | 先看哪裡 | 怎麼辦 |
|---|---|---|
| 「部署沒有完成」：20 分鐘內版本沒有變 | Render 的 Events 與 Logs（打包或啟動的錯誤） | 程式的問題請組員修好再部署；要先恢復就回滾（3-3）。同一個錯誤出現兩次，就回到上一個正常的版本 |
| 「部署沒有完成」：推到部署用 Repo 失敗 | 那一次執行的摘要 | Token 過期或權限不夠（Contents、Workflows 都要 Read and write）：重新產生（2-2），請 Repo 擁有者更新 `STAGING_MIRROR_TOKEN` |
| 「部署沒有完成」：部署用 Repo 本來就是這個版本 | Render 的 Events | 上一次部署失敗、Render 沒有重新部署：修好之後部署新的版本，或在 Render 按 Manual Deploy → Deploy latest commit |
| 「部署沒有完成」：健康檢查沒有通過 | `/api/health`、Render 的 Logs | 多半是 `DATABASE_URL` 不對，或 Neon 的專案被停用 |
| 「備份沒有完成」：password authentication failed | 2-4 的密碼 | 唯讀連線字串的密碼和 SQL 裡的不一樣：重新組一次，請 Repo 擁有者更新 Secret |
| 「備份沒有完成」：permission denied for table … | 2-4 的 SQL | 重跑 2-4 的 SQL 從 `GRANT CONNECT` 到最後一行 |
| 自己推部署用 Repo（2-1 第一次推，或下面「GitHub Actions 故障」）被拒絕：`refusing to allow … to create or update workflow … without workflow scope` | 推送的錯誤訊息 | 你的 Git 登入資訊少了 workflow 權限，GitHub 不讓它推 `.github/workflows/` 的檔案。用 gh 登入的：執行 `gh auth refresh -h github.com -s workflow`，再推一次；用自己的 Personal access token：classic 要勾 workflow，fine-grained 的 Workflows 要給 Read and write |
| GitHub Actions 故障 | https://www.githubstatus.com | 自己推部署用 Repo：在這一組 Repo 的資料夾執行 `git fetch origin && git push --force https://github.com/你的帳號/heri-2026a-g2-staging.git 要部署的Commit:refs/heads/stage` |
| 登入頁顯示「帳號或密碼不正確」，帳號確定存在 | 打的是不是本機的密碼；有沒有人改過密碼 | 改用初始密碼。有人改過又忘了：種子資料不會把改過的密碼改回去，用 3-5 的程序處理，並再提醒一次測試帳號不改密碼 |
| 組員說「登入失敗太多次，請 15 分鐘後再試」 | Render 的 Logs 搜尋 `login failed`：是不是有人一直打錯密碼 | 從第一次錯算起，最多 15 分鐘就會自動解除。急著用（示範、驗收）：Render 這一組的服務右上角 Manual Deploy → Restart service（重新啟動，約 1 分鐘，不重新打包，資料不變）；次數記在記憶體，重新啟動就清空 |
| 打開要等快 1 分鐘 | — | 免費方案閒置 15 分鐘會休眠，正常；示範或驗收前 10 分鐘先打開一次 |

## 5. 結訓後（Day 16 後 5 個工作天的限期修復與重審都結束之後）

1. 刪除 Render 的服務，以及還留著的 API Key。
2. 刪除 Neon 的專案。
3. 刪除部署用 Repo（`heri-2026a-g2-staging`）與 Fine-grained token。
4. 請各組的 Repo 擁有者刪掉 `STAGING_MIRROR_TOKEN`、`STAGING_READONLY_DATABASE_URL` 這兩個 Secret。
5. 「各組 Staging 一覽」標上「已刪除」與日期。
