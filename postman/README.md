# Postman Collection

用 Postman 直接呼叫 API，不經過畫面：權限與資料範圍的檢查要用它證明「伺服器端真的擋住了」。

| 檔案 | 內容 |
|---|---|
| `practice.postman_collection.json` | 「取得 Token」（用帳號密碼換 Token，自動存進變數 `token`）與一個帶 Token 的範例請求（目前登入的人） |

## 匯入與設定

1. Postman → Import → 選 `practice.postman_collection.json`。左邊的 Collections 會多一個「練習專案：登入身分（Token）」。
2. 點左邊這個 Collection 的名稱，打開 Variables 分頁，在 Value 欄填：

   | 變數 | 填什麼 |
   |---|---|
   | `base_url` | 本機 `http://localhost:4000`（改了 `.env` 的 `API_PORT` 就跟著改）；Staging 填 Staging 的網址，例如 `https://heri-2026a-g2.onrender.com`，最後不要加 `/` |
   | `email` | 測試帳號（README 的「測試帳號」） |
   | `password` | 那個帳號的密碼：本機是 `.env` 的 `SEED_USER_PASSWORD`；Staging 是技術導師當面給的初始密碼（和本機的不一樣，Staging 的測試帳號不改密碼） |
   | `token` | 不用填，「取得 Token」會自動填 |

   不要按 Share：沒按 Share 的值只存在你的電腦；按了，值會分享出去，匯出時也會一起帶出去。

3. 送「取得 Token」（`POST {{base_url}}/api/auth/token`）：回應 200，Token 會自動存進 `token`，12 小時內有效。
4. 送「目前登入的人」：回應 200，內容是這個帳號的資料（不含密碼）。

## 帶登入身分呼叫其他 API

- 每個請求的 Headers 加 `Authorization: Bearer {{token}}`，或 Authorization 分頁選 Bearer Token、填 `{{token}}`。
- 沒有帶 Authorization 的請求，就是「沒有登入」，應該回 401。
- Postman 會自動帶上存起來的 Cookie：測「沒有登入」或換身分之前，先打開 Postman 的 Cookies，刪掉這個網址的 Cookie。
  伺服器端同時收到 Bearer 與 Cookie 時，以 Bearer 為準。
- 回應和預期不同時，先打開 Postman Console 看實際送出的 Header（帶的是哪一個身分），再下結論。

## 每個測試帳號一個 Token（例如每一種身分一個）

1. 在 Variables 加上每個帳號的變數，例如 `email_manager`、`email_clerk`、`email_baker`，
   以及對應的 `token_manager`、`token_clerk`、`token_baker`。測試帳號用同一個密碼時，`password` 共用一個就好。
2. 在「取得 Token」上按右鍵 → Duplicate，每個帳號一個：
   - Body 的 `{{email}}` 改成那個帳號的變數，例如 `{{email_clerk}}`。
   - Scripts 分頁的 Post-response（舊版叫 Tests）裡，`pm.collectionVariables.set('token', …)` 改成那個帳號的 Token 變數，例如 `'token_clerk'`。
3. 其他請求的 Authorization 填對應的 `{{token_clerk}}`：換身分，就是換成另一個 Token 變數。

## 匯出與分享（例如 Day 16 交給技術導師）

1. 確認 `password` 與所有 Token 變數都沒有按過 Share（沒按過的值只存在你的電腦，不會匯出）；按過的，先把值清空。
2. 和 Day 2 一樣：在 Collection 名稱旁按「⋯」→ More → Export collection（舊版叫 Export），再按 Export JSON。畫面讓你選格式就選 Collection v2.1。
3. 用文字編輯器打開匯出的 `.json` 檔，搜尋 `password` 與 `token`，確認後面沒有真正的密碼或 Token。

## 安全

- Token 和密碼一樣：不要貼到文件、截圖、聊天室或 Agent 的對話；截圖前把 Headers 裡的 Token 遮住。
- 送 `POST {{base_url}}/api/auth/logout`（帶那個 Token），那個 Token 就失效，之後回 401；重送「取得 Token」就好。
- 同一個帳號連續輸錯密碼 10 次，15 分鐘內不能登入（429「登入失敗太多次，請 15 分鐘後再試」）：等 15 分鐘；Staging 急著用，請帶組的技術導師重新啟動服務（`docs/STAGING.md` 的常見狀況）。
- 只對自己這一組的本機與 Staging 測試。
