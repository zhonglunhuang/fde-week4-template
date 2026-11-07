# 練習專案骨架（第四週的 Harness 專案模板）

> 從這個模板建立你們組的 Repo：協作框架（AGENTS.md、Skills、閘門）加上 Node.js 後端、React 前端、PostgreSQL 資料庫，
> 以及帳號密碼登入、修改密碼，和 Staging 的部署、回滾、備份與只讀查詢（都在 GitHub 上操作）。
> 上半部是這個專案怎麼跑起來、怎麼用 Staging；下半部是 Harness 框架的說明。

## 專案（未初始化）

第一次用 Claude Code 開啟這個資料夾時，會自動進入初始化引導（setup）。初始化完成後，這一段會換成專案名稱與一句話定位。

## 第四週：建立與初始化

每組派一位組員建立 Repo。建立的人就是 Repo 的擁有者：之後技術導師會請他在 Repo 的設定裡貼上部署 Staging 用的資料，只有擁有者能設定。

1. 先到第三週的專案資料夾執行 `docker compose stop db`，停掉第三週的資料庫（兩個專案的資料庫都用 5432 埠）。
2. 在 GitHub 打開這個模板 Repo，按「Use this template」→「Create a new repository」。Repository name 填 `heri-orders-組別`（例如 `heri-orders-g2`），選 Private，再按「Create repository」。
3. 照 Day 9 的做法 Clone 下來，在專案資料夾執行 `claude` 打開 Agent，照下表回答初始化的問題。Commit 與推上 GitHub 之前，一樣先看 `git status`、`git diff --stat HEAD` 與 `git remote -v`。

   | 問題 | 建議的回答 |
   |---|---|
   | 專案名稱與一句話定位 | 禾日烘焙坊訂單系統：讓門市與廚房在同一個系統處理訂製蛋糕的訂單 |
   | 技術棧 | 照 README，已經決定好，不要改 |
   | 產品程式碼放在哪些資料夾 | `backend`、`frontend`（下面「目錄」一節） |
   | 票號前綴與使用者角色 | 前綴：你名字的英文縮寫（2–4 個大寫字母，例如 `AMY`）；角色：先寫訪談聽到的身分（例如管理者、門市人員、師傅），PRD 定案後再改 |
   | 檢查指令與健康檢查網址 | 檢查是 `make check`；健康檢查是 `http://localhost:4000/api/health` |

4. 到 Repo 的 Settings → Collaborators，把其他組員、老師與技術導師加進來（GitHub 帳號見課程 LINE 群組的記事本）。技術導師要有寫入權限（預設就是）。
5. 其他組員接受邀請後各自 Clone。每位組員（包括建立 Repo 的人）在自己的 Clone 設定自己的票號前綴，每個 Clone 設一次：

   ```bash
   git config ticket.prefix 你的英文縮寫
   ```

   再照下面「本機啟動」啟動，確認 `make check` 通過。

看到什麼代表完成：GitHub 上看得到初始化的 Commit；每位組員的電腦都啟動得起來、`make check` 最後一行是 `[check] OK`。

## 需要的工具

| 工具 | 版本 | 怎麼確認 |
|---|---|---|
| Node.js | 24.14.1 以上的 24 版，或 26 版（都是長期支援版 LTS） | `node -v` 印出 v24.14.1 以上的 v24，或 v26 開頭 |
| Docker Desktop | 最新版 | 打開 Docker Desktop，`docker ps` 印出 `CONTAINER ID` 開頭的標題列 |
| Git | 近期的版本 | `git --version` |
| python3 | 3.8 以上 | `python3 --version`（Harness 的閘門腳本要用） |
| make | 任何版本 | `make --version` |
| Claude Code | 公司開通的帳號 | 在專案資料夾輸入 `claude` |

- 先下載資料庫的映像檔，上課就不用等：`docker pull postgres:17-alpine`。
- Node.js 24.14.0 以前的版本附的 npm，會改寫 `package-lock.json`，`npm install` 之後 `git status` 就不乾淨。所以版本不對時，`npm install` 會直接停止（`EBADENGINE`）。已經裝了舊的 24，到 nodejs.org 下載最新的 24 LTS 重新安裝。
- Windows：
  - 指令在 Git Bash 打。下面「本機啟動」的六行在 PowerShell 也能打，但 `make` 一定要在 Git Bash 打。
  - Python 從 Microsoft Store 安裝，才會有 `python3` 指令；裝好在 Git Bash 打 `python3 --version` 確認。沒有 `python3` 的話，閘門讀不到內容，會默默放行。
  - make 沒有內建：在 PowerShell 執行 `winget install ezwinports.make`，關掉再重開 Git Bash。

## 目錄

產品程式碼在 `frontend/` 與 `backend/`（「無票不開發」閘門守的就是這兩個資料夾）。其他是 Harness 的框架檔，說明在下半部。

| 位置 | 內容 |
|---|---|
| `frontend/` | 畫面（React＋Vite）：首頁的健康狀態、登入、修改密碼 |
| `backend/src/` | API（Express）：健康檢查 `/api/health`、版本 `/api/version`、登入 `/api/auth/*` |
| `backend/src/auth/` | **登入與權限的共用程式**：帳號密碼登入、Postman 用的 Token、修改密碼、`requireUser`、`requireRole`。畫面這一側在 `frontend/src/auth.tsx`、`frontend/src/pages/Login.tsx`、`frontend/src/pages/ChangePassword.tsx`、`frontend/src/components/RequireLogin.tsx`。沒有票寫明，不改這些檔案 |
| `backend/db/migrations/` | 資料庫結構的 Migration（`NNN_名稱.sql`，只新增；`000` 是模板內建的 users 與 sessions） |
| `backend/db/seeds/` | 種子資料（`NN_名稱.sql`，T1 建立；測試帳號的密碼讀 `SEED_USER_PASSWORD`） |
| `backend/test/` | 自動化測試（Vitest） |
| `backend/scripts/` | Staging 用的腳本：Render 的打包與啟動、GitHub Actions 的部署、備份、只讀查詢，以及技術導師匯出 Log 的 `render-logs.mjs` |
| `.github/` | GitHub Actions：「檢查」「部署 Staging」「備份 Staging 資料庫」「Staging 只讀查詢」，以及只讀查詢的 Issue 表單 |
| `postman/` | Postman Collection：用帳號密碼取得 Token、帶 Token 呼叫 API（用法見 `postman/README.md`） |
| `docs/` | `SPEC.md`（功能規格書）、`STAGING.md`（組員怎麼用 Staging）、`staging-mentor.md`（技術導師怎麼建 Staging）、框架文件；PRD 放 `docs/PRD.md`、開發計畫放 `docs/dev-plan.md` |
| `docker-compose.yml` | 本機的練習資料庫（PostgreSQL 17） |
| `.env.example` | 環境變數範本 |

## 本機啟動

先到第三週的專案資料夾執行 `docker compose stop db`（停掉第三週的資料庫，兩個專案都用 5432 埠），再回到這個專案資料夾，一行一行打（不要整段貼上）：

```bash
npm install                # 安裝套件
cp .env.example .env       # 準備環境變數，再打開 .env 填值
docker compose up -d db    # 用 Container 啟動練習資料庫（-d：在背景執行）
npm run db:migrate         # 建立資料表
npm run dev:api            # 啟動後端：http://localhost:4000
npm run dev:web            # 啟動前端：http://localhost:3000
```

- `.env` 要自己填兩個值，其他照範本：
  - `SESSION_SECRET`：Mac 與 Git Bash 打 `openssl rand -hex 32`；PowerShell 打 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`。把印出的那串文字貼到 `SESSION_SECRET=` 的後面。
  - `SEED_USER_PASSWORD`：種子資料的測試帳號共用的密碼，自己取一個至少 10 個字、平常沒在用的。T1 建好種子資料之後，執行 `npm run db:seed`，就能用測試帳號與這個密碼登入。
  - `.env` 不可以提交，也不要貼給任何人。
- 資料庫第一次啟動要花幾秒準備：打 `docker compose ps`，STATUS 後面是 `(health: starting)` 就再打一次，等它變成 `(healthy)`，再執行 `npm run db:migrate`。太早執行會看到 `ECONNREFUSED` 或 `the database system is starting up`，等 10 秒再跑一次。
- 後端與前端各佔一個 Terminal 分頁，要一直開著；按 Control + C 停止。
  - 前端的程式（`frontend/`）存檔後，瀏覽器的畫面會自動更新，不用重新啟動。
  - 後端的程式（`backend/`）改了，要重新啟動後端，它不會自動重新載入。
  - `.env` 改了，後端與前端都不會自動重新讀：要重新啟動用到那個值的那一個（例如 `API_BASE_URL` 是前端在用），不確定就兩個都重新啟動。
- 後端只接受這台電腦自己的連線（只綁本機的 `127.0.0.1` 與 `::1`）：同一個網路的其他電腦或手機連不進來。
- Windows：上面六行在 PowerShell 與 Git Bash 都能直接打（`cp` 也可以）。

確認真的跑起來了：

| 層 | 怎麼檢查 | 正常的樣子 |
|---|---|---|
| 資料庫 | `docker compose ps` | db 是 `Up … (healthy)`，PORTS 是 `127.0.0.1:5432->5432/tcp` |
| 後端 | 打開 http://localhost:4000/api/health | `{"status":"ok","database":"ok"}` |
| 前端 | 打開 http://localhost:3000 | 「後端：正常」「資料庫：正常」，頁面最下面是「版本 local」 |
| 前後端串接 | DevTools 的 Network 面板 | `health` 請求的狀態碼是 200 |
| 整個專案 | `make check` | 最後一行 `[check] OK` |

### 3000 或 4000 被佔用時

- 4000 被佔用：在 `.env` 把 `API_PORT` 改成沒被佔用的埠（例如 4001），`API_BASE_URL` 一起改成 `http://localhost:4001`，後端與前端都重新啟動。
- 3000 被佔用：在 `.env` 加一行 `WEB_PORT=3001`（選填的變數，`.env.example` 裡沒有）。前端改用這個埠，後端也改成允許這個埠的前端呼叫；後端與前端都重新啟動，改開 http://localhost:3001。
- 開場簡報的健康檢查看的是 `scripts/framework-config.sh` 的 `HEALTH_URL`（全組共用）。只有你的電腦換埠時，不要改它，簡報的健康檢查會顯示失敗，知道原因就好。

## 資料庫指令

| 指令 | 做什麼 |
|---|---|
| `npm run db:migrate` | 照編號執行還沒跑過的 Migration（`backend/db/migrations/`）；每個環境記得自己跑到哪 |
| `npm run db:seed` | 放入種子資料（`backend/db/seeds/`）；要先在 `.env` 設定 `SEED_USER_PASSWORD`。可以重複執行，不會多出重複的資料 |
| `npm run db:reset` | 重建本機的資料庫：清空，從 000 起重跑全部 Migration，再放種子資料（只能在本機用，會刪掉本機資料庫的所有資料） |
| `npm run db:query -- "SELECT * FROM users;"` | 查看本機的資料庫，結果印成表格（最多 200 列）；只能查、不能改，一次一個查詢 |

`db:query` 的「只能查、不能改」是真的擋得住，不只是約定：

- 只接受 `SELECT`、`WITH`、`TABLE`、`VALUES`、`EXPLAIN`、`SHOW` 開頭的一個查詢（註解不算開頭）。`COPY`、`DO`、`SET` 這類指令，還沒連資料庫就拒絕，印 `[query] 已拒絕：…`。
- 用只能讀的資料庫帳號 `app_readonly` 執行。第一次執行時自動建立，密碼和 `DATABASE_URL` 的帳號相同。這個帳號只有讀取的權限，改不了資料。
- 在唯讀的交易裡執行，最後一律還原（ROLLBACK）。

要改資料，一律寫成 Migration 或種子資料。Staging 的資料庫不用這個指令查，用 Issue 表單「Staging 只讀查詢」（`docs/STAGING.md`）。

## 測試帳號

T1（資料表與種子資料）完成後，把種子資料建立的帳號填進這張表。密碼不寫在這裡，也不寫在任何文件或聊天室：本機的密碼是你自己 `.env` 的 `SEED_USER_PASSWORD`；Staging 的初始密碼由帶組的技術導師當面告訴組員。

| 帳號 | 身分 |
|---|---|
| （T1 完成後填，例如 `manager@heri.example`） | （例如 管理者） |

- 測試帳號不用改密碼：本機的密碼是你自己設的；Staging 的測試帳號全組與技術導師共用，**不要改密碼**。
- 「第一次登入就改密碼」是 Day 16 交給客戶的帳號：初始密碼在驗收會議上當面告訴客戶，請他第一次登入就從頁首的「修改密碼」換掉。
- 種子資料重跑不會把改過的密碼改回去。

## 登入與權限（模板內建的共用程式）

| API | 做什麼 |
|---|---|
| `POST /api/auth/login` | Email 與密碼登入（瀏覽器用）：設定 HttpOnly 的 Cookie，12 小時有效 |
| `POST /api/auth/token` | Email 與密碼換一個 Token（Postman 用），12 小時有效 |
| `POST /api/auth/logout` | 登出：這一個 Cookie 或 Token 立刻失效 |
| `GET /api/auth/me` | 目前登入的人：`users` 的整列，不含密碼；T1 用 Migration 加的欄位（例如 `employee_no`）會自動出現 |
| `POST /api/auth/password` | 修改自己的密碼：目前的密碼加新密碼（至少 10 個字）；其他已經登入的視窗不會被登出 |

- 密碼錯、帳號不存在、帳號已停用，一律回 401「帳號或密碼不正確」，不透露是哪一種；同一個帳號連續錯 10 次（同時送出很多次也一樣），15 分鐘內不能再登入（429「登入失敗太多次，請 15 分鐘後再試」）。修改密碼時目前的密碼錯 10 次，15 分鐘內也不能再改。
- 需要登入的 API 掛 `requireUser`；只給某些身分用的掛 `requireRole('manager', 'clerk')`，身分不符回 403「沒有權限」。身分存在 `users.role`，有哪些值由你們的 PRD 決定，模板不限定。
- 用 `getUser(req)` 取得登入者；資料範圍（例如只能看自己建立的資料）一律在伺服器端用登入者的欄位過濾，不相信畫面送來的身分或其他權威欄位。
- 同時帶 `Authorization: Bearer` 與 Cookie 時，以 Bearer 為準：Postman 換身分時，不會被存起來的 Cookie 干擾。

## 用 Postman 帶登入身分

1. Postman → Import → 選 `postman/practice.postman_collection.json`。
2. 點左邊這個 Collection 的名稱，打開 Variables 分頁，在 Value 欄填 `base_url`（本機是 `http://localhost:4000`，Staging 填 Staging 的網址）、`email`、`password`
   （本機是你 `.env` 的 `SEED_USER_PASSWORD`；Staging 是技術導師當面給的初始密碼，兩個不一樣）。
   不要按 Share：沒按 Share 的值只存在你的電腦；按了，值會分享出去，匯出時也會一起帶出去。
3. 送「取得 Token」（`POST {{base_url}}/api/auth/token`）：回應的 Token 會自動存進變數 `token`。
4. 其他請求的 Authorization 分頁選 Bearer Token，填 `{{token}}`（或 Headers 加 `Authorization: Bearer {{token}}`）。換身分就換成另一個 Token 變數；沒有帶 Authorization 就是「沒有登入」。
5. 要用好幾個身分：複製「取得 Token」，每個帳號一組變數，例如 `email_manager`、`token_manager`（`postman/README.md` 有步驟）。
6. 匯出分享（例如 Day 16 交給技術導師）：和 Day 2 一樣，在 Collection 名稱旁按「⋯」→ More → Export collection，再按 Export JSON。
   匯出後用文字編輯器打開 `.json` 檔，搜尋 `password` 與 `token`，確認後面沒有真正的密碼或 Token（按過 Share 的值會在裡面，先清掉再匯出）。

Postman 會自動帶上存起來的 Cookie：測「沒有登入」之前，先在 Postman 的 Cookies 刪掉這個網址的 Cookie。

## Staging（線上的測試環境）

- 網址：（帶組的技術導師建好後填在這裡，例如 `https://heri-2026a-g2.onrender.com`）
- Staging 由帶組的技術導師用 Render（網站）與 Neon（資料庫）代管。組員不用註冊這兩個服務，全部在 GitHub 上操作：

  | 要做的事 | 在哪裡 |
  |---|---|
  | 部署、部署指定的版本、回滾 | Actions →「部署 Staging」→ Run workflow，填版本（`stage`、標籤或 Commit 編號） |
  | 備份資料庫 | Actions →「備份 Staging 資料庫」→ Run workflow（每次部署前也會自動備份） |
  | 只讀查詢 | Issues → New issue →「Staging 只讀查詢」 |
  | 看線上是哪一版 | `Staging 網址/api/version`，或頁面最下面的「版本」 |
  | 看 Log | 請帶組的技術導師協助 |

- 合併進 `stage` 不等於部署：合併之後，要有人執行「部署 Staging」，線上才會換成新版。
- 詳細做法：組員看 `docs/STAGING.md`；技術導師建 Staging 看 `docs/staging-mentor.md`。

## 版本標記

照課程的做法用 GitHub Release，Harness 沒有另外規定（`docs/FRAMEWORK.md` 的版號只管框架本身）：

- 標籤：`v1.0.0-rc1`、`v1.0.0-rc2`……（候選發布版本）；驗收通過後，在同一個 Commit 標 `v1.0.0`。
- Target 選 `stage`（可以的話，選 Staging 正在跑的那一個 Commit），勾 Set as a pre-release（正式版 `v1.0.0` 不勾）。
- 標好之後打開 Tags 頁面，確認標籤指向的 Commit 和 `Staging 網址/api/version` 的 `commit` 一樣。
- 要部署某個標籤，或回滾到某個標籤：「部署 Staging」的版本欄填標籤，例如 `v1.0.0-rc1`。

## PRD 與開發計畫

- PRD 放 `docs/PRD.md`，開發計畫放 `docs/dev-plan.md`（Markdown）。`docs/` 不是產品程式碼的資料夾，Agent 寫在這裡不會被票務閘門擋下。
- PRD 改版時，這個檔案也要一起更新；功能的現況寫在 `docs/SPEC.md`。

## 檢查

```bash
make check
```

依序跑：票務檢查（ticket-lint）→ 程式風格（`npm run lint`）→ 型別（`npm run typecheck`）→ 測試（`npm test`）→ 正式版打包（`npm run build`），全部通過最後一行印 `[check] OK`。測試會連本機資料庫（自動建立並使用 `app_test` 與 `app_test_template`，不動你的練習資料），所以要先 `docker compose up -d db`。`app_test` 跑過全部的 Migration，你們的測試用它；模板自己的測試用只跑過模板內建 000 的 `app_test_template`，所以你們加了欄位、限制或資料表之後，模板的測試照樣通過。開 PR 與合併進 `stage` 時，GitHub Actions 的「檢查」也會跑一次。

## 常見錯誤

| 訊息裡的關鍵字 | 意思 | 怎麼辦 |
|---|---|---|
| `command not found`（例如 `docker`、`node`） | 電腦找不到這個工具 | 確認已經安裝；裝完要重開 Terminal |
| `Cannot connect to the Docker daemon`、`failed to connect to the docker API` 或 `error during connect`（依 Docker 的版本與作業系統而不同） | Container 工具沒有在執行 | 打開 Docker Desktop，等它啟動完成 |
| `port is already allocated`（啟動資料庫時） | 5432 埠已經被別的資料庫或 Container 佔用，最常見的是第三週的資料庫還開著 | 到第三週的專案資料夾執行 `docker compose stop db`；不是的話用 `docker ps` 看是哪一個 Container。不要用 `docker compose down -v` 重來，它會刪掉資料 |
| `ECONNREFUSED`，後面接著 `:5432` | 連不上資料庫：那個位址和埠沒有程式在接聽 | 用 `docker compose ps` 看資料庫有沒有在跑；沒有就啟動它，再重新啟動後端 |
| 剛啟動資料庫就建立資料表，出現 `ECONNREFUSED` 或 `the database system is starting up` | 資料庫還在準備，還不能連線 | 等 10 秒，再執行一次 `npm run db:migrate` |
| `password authentication failed for user "app"` | 5432 埠上是別的資料庫（例如第三週的），帳號對不上 | 停掉第三週的資料庫（`docker compose stop db`），再 `docker compose up -d db` |
| `缺少環境變數 SESSION_SECRET，請參考 .env.example` | `.env` 不存在，或少了這個值（空值也算缺少） | 對照 `.env.example` 補上，再重新啟動後端 |
| `[seed] 缺少 SEED_USER_PASSWORD` | 有種子資料，但 `.env` 還沒設定測試帳號的密碼 | 在 `.env` 的 `SEED_USER_PASSWORD=` 後面填一個至少 10 個字的密碼，再執行一次 |
| 登入時「帳號或密碼不正確」 | 帳號打錯、密碼不是 `SEED_USER_PASSWORD`、帳號已停用，或還沒放種子資料 | 確認 README「測試帳號」的帳號與 `.env` 的密碼；還沒有帳號就先 `npm run db:seed` |
| `EADDRINUSE` 或 `address already in use` | 這個埠已經被別的程式佔用 | 找到並關掉另一個還在跑的程式（常常是忘了關的舊分頁），Mac 可以用 `lsof -i :4000` 查是誰；或照上面「3000 或 4000 被佔用時」換埠 |
| `Cannot find module`、`tsx: command not found` | 套件沒有安裝 | 執行 `npm install` |
| `EBADENGINE`、`Unsupported engine`（執行 `npm install` 時） | Node.js 的版本不對：要 24.14.1 以上的 24 版，或 26 版 | 照「需要的工具」重新安裝 Node.js，關掉再重開 Terminal，`node -v` 確認版本，再執行一次 `npm install` |
| `relation ... does not exist` | 資料表還沒建立 | 執行 `npm run db:migrate` |
| 首頁顯示「後端：無法連線」 | 前端連不到後端 | 看後端的分頁有沒有在跑、有沒有錯誤；看 Network 面板的請求網址對不對 |
| 首頁顯示「資料庫：異常」 | 後端還在，但連不上資料庫 | `docker compose ps` 看 db 是不是 Up；停了就 `docker compose start db` |

---

## Harness 協作框架

> 給「用 AI Agent 開發軟體」的個人與小團隊：一套**角色入口 + 功能票 + 機制化閘門**的
> 協作框架，讓不懂 code 的案主/PM 和工程師共用同一個 repo、同一套規則，
> 而且規則靠 hook 強制執行，不靠自律。

### 這個框架解決什麼問題

VibeCoding 常見的坑：agent 假設需求就動工、改 A 壞 B 沒人發現、「能跑」就當「能上線」、
討論結論散落對話裡下次全忘。本框架的對策：

| 機制 | 對策 |
|------|------|
| **無票不開發**（hook 強制） | 沒有確認過「誰用/目的/驗收/邊界」的功能票，產品程式碼直接改不動 |
| **SPEC 單一事實來源** | 系統現在做什麼全記在 `docs/SPEC.md`，動工前先讀、改完必同步 |
| **角色入口** | 案主走 pm（全程白話）、工程師走 dev（工程語言），能力相同、守門相同 |
| **每次變更留痕** | 框架規則變更記 `docs/FRAMEWORK.md`（帶版號），功能變更記票與 SPEC |
| **開場簡報**（hook 強制） | 每個新對話自動報告專案現況，不用問「上次做到哪」 |

### 快速開始

1. **取得模板**：在 GitHub 按「Use this template」建立自己的 Repo，再 Clone 下來，作為你的專案根目錄。
2. **用 [Claude Code](https://claude.com/claude-code) 開啟**（桌面 app 或 CLI 皆可）。
3. **打任何字**——第一個對話會自動進入**初始化引導**：回答 5 組問題
   （專案名稱、技術棧、程式碼目錄、票號前綴、檢查指令），agent 會代你填好所有設定。
   答不出來的都可以跳過，之後再補。
4. 初始化完成後，每個新對話自動出現**專案現況簡報**與入口選項；
   直接說你要做的第一個功能即可。

> 不用 Claude Code 的 agent（Codex / Cursor）也能用：規則都在 `AGENTS.md` 與
> `.agents/skills/`，但 hooks（票務閘門、開場簡報）僅在 Claude Code 生效，其他 agent 靠紀律遵守。

### 開發協作流程

```
新對話開始
   │
   ▼
[team-leader] 專案現況簡報（SPEC 狀態 / ticket 看板 / 分支環境）
   │
   ├─→ [pm]        非工程師入口：討論需求（必問誰用/目的/驗收/邊界）→ 開票 →
   │                （要的話）agent 主導白話開發 → 實機測試 → 驗收
   │
   ├─→ [dev]       工程師入口：無票不開發 → 衝突/資安檢查 → 實作 → 驗證 → 推進票況
   │
   └─→ [framework] 框架入口：改協作框架本身（豁免票，必留決策紀錄）
```

pm 與 dev **能力相同**（都先開票、共用「分支與出貨流程」），差在使用者是誰與呈現方式。
完整規則與設計理由見 [docs/FRAMEWORK.md](docs/FRAMEWORK.md)。

### 框架的檔案

| 位置 | 進 git | 角色 |
|------|:------:|------|
| `AGENTS.md` | ✅ | 唯一工程契約（所有 agent 動工前先讀） |
| `CLAUDE.md` | ✅ | Claude Code 入口行為與路由 |
| `.agents/skills/` | ✅ | 角色入口與工作流的 canonical（單一來源） |
| `.claude/skills/` | ✅ | Claude Code adapter，只指回 canonical |
| `.claude/settings.json` | ✅ | hooks（開場簡報、票務閘門、git 同步閘門）與權限 |
| `tickets/` | ✅ | 功能票（產品開發唯一依據） |
| `docs/SPEC.md` | ✅ | 產品「目前實際行為」單一事實來源 |
| `docs/FRAMEWORK.md` | ✅ | 框架設計與決策紀錄（帶版號） |
| `docs/harness/` | ✅ | agent 派工制度（門檻、模板、判準） |
| `scripts/` | ✅ | 框架腳本（簡報、閘門、lint；專案設定在 `framework-config.sh`） |
| `cache/` | ❌ | 戰情資料（討論過程、demo 素材），可隨時丟棄 |
| `.env` | ❌ | 每個人自己的環境變數與 Secrets（只有 `.env.example` 進 git） |

### 框架規則 30 秒版

1. 新 session 先 team-leader 簡報 → 選入口，無例外。
2. 無票不開發（hook 強制）；PM 開票必問「誰用 / 目的 / 驗收 / 邊界」；
   開票用 `make new-ticket`（先 fetch 遠端再取號，防撞號）。
3. 票三態：待開發 → 開發中 → 完成（作廢不刪檔）；動工＝領票（標「開發中」＋填 `owner`，
   他人開發中的票不碰）。
4. 兩道確認閘：開票後問「現在開發嗎？」、綠燈後問「上實機嗎？」——授權單次有效，不跨票延續。
5. 功能改了，`docs/SPEC.md` 同一次變更同步，否則不算完成。
6. 框架變更豁免票，但必 bump 版號＋寫 `docs/FRAMEWORK.md` 決策紀錄。
7. 對外/不可逆動作（merge 整合分支、部署、刪資料）一律先問使用者。
8. push 前先 `git pull --rebase`（hook 強制），避免平行開發互相覆蓋。

### 來歷

本框架萃取自一個真實外包專案的協作制度（框架版本演進與每條規則的「為什麼」
完整保留在 [docs/FRAMEWORK.md](docs/FRAMEWORK.md) 決策紀錄與 [docs/harness/](docs/harness/) 案例）。
