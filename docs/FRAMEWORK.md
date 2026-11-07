# FRAMEWORK.md — Agent 協作框架（總覽 + 決策紀錄）

> **框架版本：v4.2.4**（版號規則見 §2.9；此為單一事實來源，`scripts/agent-status.sh` 簡報會讀這裡）
>
> 本檔記錄**協作框架本身**：角色入口怎麼設計、為什麼這樣設計、歷次變更。
> 框架的變更由 `framework` 入口討論與落地（豁免功能票）；每次變更**必須**同時
> (1) bump 上面的版號、(2) 在 §3 決策紀錄補一列（版號 / 日期 / 改了什麼 / 為什麼）。
> 產品功能的規格請看 `docs/SPEC.md`；工程規範請看 `AGENTS.md`。

## 1. 框架總覽

```
新對話開始
   │（模板未初始化 → 先進 [setup] 初始化精靈，完成後才有下面的流程）
   ▼
[team-leader] 專案現況簡報（SPEC 狀態 / ticket 看板 / 分支環境）
   │
   ├─→ [pm]        非工程師入口（不懂 code 的 PM/案主）：討論需求（必問角色/目的/驗收/邊界）
   │                → 開票 tickets/ + 同步 SPEC；使用者要的話 agent 主導、白話幫他開發並上實機
   │                討論過程與 demo 素材 → cache/（不進 git）
   │
   ├─→ [dev]       工程師入口：無票不開發 → 衝突/資安檢查 → 實作 → 推進票況 + 同步 SPEC
   │
   │   ↑ pm 與 dev 能力相同（都先開票、共用「分支與出貨流程」）；差在使用者是誰與呈現方式。
   │   共用出貨流程：從 stage 開 feature/* → 依票實作 → 檢查綠燈 → 問使用者 → merge 回 stage → 實機測試
   │
   └─→ [framework] 框架入口：討論與修改框架本身（入口、規則、資料夾約定）
                    → 落地後在本檔決策紀錄補一列（豁免票）
```

### 資料夾與規則檔的分工

| 位置 | 進 git | 角色 |
|------|:------:|------|
| `AGENTS.md` | ✅ | 唯一工程契約（規範「必須怎麼做」；`{{…}}` 佔位符由 setup 填寫） |
| `CLAUDE.md` | ✅ | Claude Code 入口行為（session 開始先 team-leader）與 adapter 說明 |
| `.agents/skills/` | ✅ | 所有角色入口與工作流的 canonical（單一來源） |
| `.claude/skills/` | ✅ | Claude Code adapter，只指回 canonical，不放第二套邏輯 |
| `scripts/framework-config.sh` | ✅ | 專案層設定（專案名、票號前綴、產品目錄、健康檢查 URL） |
| `.template-uninitialized` | ✅ | 模板未初始化標記；存在時 SessionStart 導向 setup，由 setup 刪除 |
| `tickets/` | ✅ | 功能票（產品開發唯一依據） |
| `docs/SPEC.md` | ✅ | 產品「目前實際行為」單一事實來源 |
| `docs/FRAMEWORK.md` | ✅ | 框架設計與決策紀錄（本檔） |
| `cache/` | ❌ | 戰情資料（PM 討論過程、demo 素材），可隨時丟棄 |

### Harness 原語對照（為什麼入口用 skill 做）

| 原語 | 特性 | 本框架的用法 |
|------|------|--------------|
| Skill（slash command） | 載入主對話、可互動提問 | 角色入口（pm/dev/framework/team-leader）＋ setup 精靈（都需要來回討論） |
| Subagent（Agent 工具，背景執行） | 獨立 context、跑完自動通知、不可互動 | 長任務背景執行——唯讀調查、demo 素材（pm）、依票實作於隔離 worktree（dev）；進行中每回合回報一行狀態 |
| CLAUDE.md 指令 | 每 session 自動載入 | 觸發「開場先 team-leader / 未初始化先 setup」 |
| Hook | 工具呼叫前後的攔截 | SessionStart（開場規則與即時狀態；未初始化改注入 setup 引導）＋ PreToolUse 票務閘門與 git 同步閘門 |

## 2. 框架規則摘要

1. **入口紀律**：新 session 先 team-leader 簡報 → AskUserQuestion 選入口，**無例外**——
   即使第一句話已明確指定任務，也先完成簡報與入口選項，選定後帶著任務進入口。
   （SessionStart hook 會注入開場規則與即時狀態，簡報直接沿用、不重跑指令。）
   **任何入口（pm / dev / framework）被進入時，都要先回報專案現況**（壓縮版 ≤10 行，帶角色視角）；
   本對話已簡報過則改 3 行內差異更新。
2. **無票不開發**（產品程式碼）：新功能 / 行為修改必須有 `tickets/` 的票；純問答、調查、不改行為的救火豁免。
   由 PreToolUse hook（`scripts/ticket-gate-hook.sh`）**機制化強制**：無「待開發/開發中」票時，
   `PRODUCT_DIRS` 內的檔案寫入直接被擋；救火經使用者同意後以 `cache/hotfix-override` 暫時放行，事後補票。
   票的格式與一致性由 `scripts/ticket-lint.sh` 檢查（`make ticket-lint`，含在 `make check`）。
3. **PM 必問四件事**：誰使用、目的、驗收標準、邊界——沒確認不開票。
   **PM 入口也能實際開發**（給不懂 code 的人用，agent 主導、白話回報），但**開發前一樣先開票**，
   無票不開發不豁免；pm 與 dev 差在使用者是誰與呈現方式，不在能力。
4. **票三態**：待開發 → 開發中 → 完成（作廢標記不刪檔）。開票一律用 `scripts/new-ticket.sh`
   （先 fetch 遠端再取號防撞號）；多 session 平行以**領票制**協作（標「開發中」同時填 `owner`，
   他人票不碰，見 `tickets/README.md`）。
5. **兩道確認閘**：開票後→問「現在開發嗎？」同意才動工；檢查綠燈後→問「上實機嗎？」
   同意才 merge/push/部署。授權單次有效，不跨票、不跨回合延續。
6. **框架變更豁免票**：走 framework 入口討論確認後直接改，但**必須**在本檔決策紀錄留痕。
7. **canonical/adapter 一致**：改工作流先改 `.agents/skills/`，再確認 `.claude/skills/` adapter 與
   CLAUDE.md / README / team-leader 入口清單同步。
8. **長任務走背景 subagent**：大範圍調查、demo 素材、已開票的長實作（限隔離 worktree）
   派背景 subagent 執行，主對話不中斷。任務描述必須自包含（subagent 中途不能提問）；
   進行中每回合開頭回報一行狀態，完成/失敗自動彙報；「無票不開發」同樣約束 subagent，
   實作結果由主對話驗證（run-checks）與驗收後才合回，票況與 SPEC 由主對話推進。
   派工門檻、模型調度、驗證判準見 `docs/harness/dispatch.md`。
9. **框架版號（semver）**：每次框架變更**必須** bump 檔頭「框架版本」並於 §3 補一列（含版號欄）。
   - **MAJOR**：不相容變更——移除/改寫入口、推翻既有規則、改變資料夾契約。
   - **MINOR**：新增能力——新入口、新機制/腳本、新規則（不破壞既有）。
   - **PATCH**：修 bug、文字、微調（不改行為契約）。
   一次涵蓋多項變更時，取最高等級 bump 一次；各項在 §3 分列、共用該版號。
   （**專案初始化（setup 填佔位符）不 bump**：屬專案設定，非框架變更，但在 §3 留一列。）
10. **分支與出貨流程**（pm/dev 共用，細節見 AGENTS.md「分支與出貨流程」、權威分支定義見 CONTRIBUTING.md
    「分支即環境」）：開發都從 **`stage`** 開 `feature/<票號>-<短題>`；判斷可實機測試時**先問使用者**，
    同意後 merge 回 `stage`，在實機環境驗收。分支模型：`stage` 整合分支、`prod` production。
    進 stage/prod 與部署都是對外動作，先確認。
11. **模板初始化（setup）**：`.template-uninitialized` 存在時，SessionStart hook 導向 setup 精靈；
    setup 只填佔位符與 `framework-config.sh`，不改框架規則；收尾刪除標記、在 §3 留痕（不 bump）。

## 3. 決策紀錄（changelog）

> 新版在上。每列：版號 / 日期 / 改了什麼 / 為什麼。版號規則見 §2.9。

| 版號 | 日期 | 決策（改了什麼） | 原因（為什麼） |
|------|------|------|------|
| v4.2.4 | 2026-11-07 | 練習專案模板的框架清理（原本記成 v4.2.2：第三週的 Repo 已經用 v4.2.2、v4.2.3 記「無票不開發」閘門的 Windows 修正，這裡也帶進來，所以改成 v4.2.4，同一個版號在每個練習 Repo 都是同一個變更）：(1) 移除 `docs/harness/` 底下源專案時期的完整論述與前史（archive 資料夾），`CLAUDE.md`、`docs/README.md`、`docs/harness/dispatch.md`、`docs/harness/maintenance.md` 不再指向它；(2) `user-walkthrough` skill、`scripts/new-ticket.sh`、`scripts/ticket-tools-test.sh` 的案例改成不帶源專案票號的說法（教訓與檢查項目不變；舊制相容的測試改用 `TK-0001`）；(3) `setup` 收尾多兩件事：把畫面上的專案名稱（`frontend/src/config.ts` 的 `PROJECT_NAME`、`frontend/index.html` 的 `<title>`）換成專案名稱——要在填 `PRODUCT_DIRS` 之前改，否則會被無票不開發的閘門擋下；票號前綴同時設成這個 Clone 的 `git config ticket.prefix`。PATCH：文件與初始化步驟的修正，不改規則 | 練習 Repo 是公開的模板，不能帶源專案的名稱、票號與歷史文件（營運決定）；第四週的模板用中性的專案名稱「練習專案骨架」，初始化時要能換成各組的專案名稱，而改畫面上的名稱會碰到產品程式碼的資料夾 |
| v4.2.3 | 2026-11-07 | `scripts/ticket-tools-test.sh` 的閘門測試改成從 stdin 把要修改的檔案路徑交給 python3（原本放在參數裡）。Windows 的 Git Bash（MSYS2）交給原生程式（例如 Microsoft Store 的 Python）的參數，只要看起來像 `/tmp/…` 這種路徑，就會先改寫成 Windows 的寫法（`C:/…/Temp/…`），和測試用的根目錄（Git Bash 看到的 `/tmp/…`）對不上：沒有開著的票時，「一般的路徑」與「Python 讀 pipe 用 cp950」兩項變成放行，`make ticket-lint`、`make check` 在 Windows 都會失敗。stdin 的內容不會被改寫；Claude Code 也是從 stdin 傳給閘門，所以閘門本身不用改。PATCH：只修測試，閘門與規則不變 | Windows 的學員從 Day 9 跑 `make check` 起每次都會失敗，閘門其實是好的。在 macOS 上用照 MSYS2 的規則改寫參數的 python3 替身重現：修正前 2 項失敗，修正後 18 項全過；拿修正後的測試跑 v4.2.2 之前的閘門，仍然抓到 4 項 |
| v4.2.2 | 2026-11-07 | 閘門也比對 Windows 格式的路徑（Claude Code 在 Windows 傳 `C:\…` 格式，原本比對不到、默默放行）：`scripts/ticket-gate-hook.sh` 把開頭是磁碟機代號的路徑（`C:\…`、`C:/…`）換成 Git Bash 的寫法（`/c/…`）再比對，這種路徑比對時不分大小寫（Windows 的路徑本來就不分），其他路徑照舊；Claude Code 傳來的內容一律當成 UTF-8 讀（Windows 的 Python 讀 pipe 預設用系統的編碼，例如 cp950，內容有中文就讀不出來，一樣默默放行）。`scripts/ticket-tools-test.sh` 加上閘門的測試：沒有開著的票時，一般的路徑、`C:\…`、`C:/…`、大小寫不同、用 cp950 讀都擋下，docs 放行；有開發中的票就放行；沒有 python3 直接說清楚。PATCH：修正閘門的漏洞，規則不變 | Windows 的學員（Git Bash 加 Claude Code）沒有票也改得了 `frontend/`、`backend/`，閘門不擋也不提示：`ROOT` 來自 Git Bash 的 `pwd`（`/c/…`），和 Claude Code 傳來的寫法不同。macOS、Linux 沒有 C 槽，測試用 `TICKET_GATE_TEST_ROOT` 假裝 Repo 在 `/c/…`（只有測試會設） |
| v4.2.1 | 2026-11-07 | `.claude/settings.json` 的 `deny` 預設加上 `Read(./.env)`：settings 預設擋 Agent 用讀檔工具讀 `.env`。只擋 `.env` 本身，不寫成 `Read(./.env.*)`，`.env.example` 照常可讀。PATCH：補一條預設權限，不改行為契約 | 課程與資安：學院 Day 9 講義「第一層：權限設定」教的就是這一條，模板要和教材一致；`.env` 放 Secrets，讀檔通常不會先問使用者，要靠 deny 擋住（Terminal 指令讀檔仍會跳確認，由人判斷） |
| v4.2.0 | 2026-08-14 | **回港源專案 v4.3.0–v4.12.1 的通用框架改進**（去產品化後移植）：(1) **四個通用 skill**——`ui-design`（v4.3.0 通用 UI/UX 檢查清單＋v4.10.0 輸入元件一致性四規則；來源專案的 PreToolUse 閘門因畫面層路徑依專案而異，模板不帶 hook、SKILL 內留機制化備忘）、`ux-writing`（v4.4.0 繁中 UX Writing：心法／標點／盤古之白／範例庫＋v4.5.0「套用即揭露」；術語表去產品化為「由專案自己累積」的空表＋示範列）、`grilling`（v4.7.0 vendored，MIT © Matt Pocock；pm 開票前必跑）、`user-walkthrough`（v4.12.0 真人操作走查；接進 dev 出貨流程「綠燈後、回報前必過」）；(2) **pm 開票前先 grill**（v4.7.0）——需求一進來先用 Skill 工具啟動 grilling 逼問一輪，共識再收斂到四件事；(3) **票號改作者前綴**（v4.11.0）——`git config ticket.prefix` 每 clone 一次、流水號只在自己前綴裡遞增（撞號是取號與推送間的競爭條件，fetch 再勤也看不到彼此；作者前綴讓取號不需要與任何人協調）；舊制 `TICKET_PREFIX`-XXXX 凍結、lint 兩制並收；`new-ticket.sh` 同步帶入 **fetch 全部遠端分支**（v4.8.0，只掃整合分支會看不到別人 feature 分支上的票）；agent-status／ticket-gate 的票 glob 改前綴無關；(4) **票務工具自動化測試**（v4.12.1）——`scripts/ticket-tools-test.sh` 九測項（未設前綴要擋／同前綴遞增／號碼空間獨立／id×檔名不一致／id 重複且錯誤路徑不炸／舊制相容…）掛進 `make ticket-lint`，「守規則的工具自己也要有測試」。**不帶入**：v4.9.0（Django migration lint 與 line-messaging，stack/產品綁定）、v4.6.0 的 hook 本體（畫面層路徑產品綁定，降級為 SKILL 內備忘）、v4.8.0 的 commit 自動推送 hook（部署拓樸綁定）。模板內驗證：ticket-lint OK、ticket-tools-test 9/9 過。MINOR：新增能力，不破壞既有 | 使用者要求把源專案演進出的框架更新與 skills 同步上模板 repo；照 v4.1.0 建立的移植方法論——逐條對照決策紀錄，只移植通用能力、產品內容一律不帶，來歷保留標「源專案」 |
| v4.1.0 | 2026-07-17 | **回港源專案 v3.2.0–v4.2.1 的通用框架改進**（去產品化後移植）：(1) **領票制**（源 v3.2.0）——票 frontmatter 加 `owner`、他人開發中票不碰、ticket-lint 對「開發中缺 owner」warn 不擋、agent-status 簡報顯示 owner、tickets/README 補「多 session 平行協作」；(2) **兩道確認閘**（源 v3.3.0）——開票後必問「現在開發嗎？」、綠燈後必問「上實機嗎？」，授權單次有效不跨票；入 pm/dev SKILL、AGENTS.md 嚴禁清單、§2 規則 5、sensors-backlog 機制化備忘；(3) **開票先 fetch 再取號**（源 v4.2.0+v4.2.1）——新增 `scripts/new-ticket.sh`（改讀 framework-config 的 `TICKET_PREFIX`，含 v4.2.1 的 `${VAR}` 大括號修正）＋ `make new-ticket`；(4) tickets/README 補「有 CI 就把 `make check` 掛進 CI」通用建議（源 v4.1.0 的 CI 強制在模板無 CI 可掛，降級為建議、由 setup/framework 入口落地）。**不帶入**源專案 v4.0.0「App-only/Web-admin 平台範圍」（產品決策）與所有 stack 綁定內容。連動同步：README「30 秒版」補領票制與兩道確認閘、`.claude/settings.json` 允許清單加 `make new-ticket`、§2.8→§2.9 引用更新。MINOR：新增機制與規則，不破壞既有 | 使用者要求把源專案演進出的新版框架同步回模板；逐條對照兩邊 FRAMEWORK.md 決策紀錄，只移植通用框架能力、產品內容一律不帶 |
| v4.0.0 | 2026-07-07 | **模板化（template 化）**：(1) 剝離源專案的全部業務程式碼、票、stack 綁定文件與 git 歷史，框架改為 stack 無關；(2) 目錄壓平成單一 repo（原「工作區＋專案子目錄」兩層併一層，hooks 路徑改 `$CLAUDE_PROJECT_DIR/scripts/`）；(3) 專案差異外部化到 `scripts/framework-config.sh`（專案名/票號前綴/產品目錄/健康檢查 URL），四支框架腳本改讀設定不寫死；(4) 新增 **setup 入口**（初始化精靈）＋ `.template-uninitialized` 標記：未初始化時 SessionStart hook 改注入首次使用引導，setup 問 5 組問題代填 AGENTS.md 佔位符與設定，收尾刪標記；(5) AGENTS.md 改為含 `{{…}}` 佔位符的骨架，stack 綁定 skills（add-*/deploy-safely/troubleshoot）移除、run-checks 改為由 setup 填寫的佔位版。MAJOR：移除入口、改變資料夾契約 | 使用者要把源專案的協作框架做成可發布的 template：業務程式碼是客戶 IP 不能散布；stack 綁定會限縮適用面；新使用者需要被引導而不是自己讀文件——用既有原語（skill + SessionStart hook + 標記檔）實作首次使用引導，不發明新機制 |
| — | 2026-07-02 ~ 07-04 | **前史（v1.0.0–v3.1.0，源專案）**：三角色入口以 skill 實作、每 session 開場簡報（SessionStart hook 強制）、無票不開發（PreToolUse hook 機制化）＋ ticket-lint、PM 升級為非工程師開發代理（能力=dev、差在呈現）、分支即環境出貨流程、框架版號制度、背景 subagent、harness 制度檔（dispatch/templates/sensors/maintenance）、git 同步閘門。完整的決策表沒有隨模板發布 | 每條規則的「為什麼」都來自源專案的真實踩坑（假設角色致重構、push 成功但 CD 失敗、平行開發互相覆蓋等）；歷史保留供翻舊帳，本表只留摘要 |
