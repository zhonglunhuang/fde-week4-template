# 種子資料（虛構的測試資料）

這裡放開發與 Staging 用的測試資料：每一種身分的測試帳號，以及示範與測試要用的資料。模板本身沒有種子檔，T1 會建立。

## 規則

- 檔名：`NN_名稱.sql`，兩位數字決定執行順序，例如 `01_users.sql`、`02_examples.sql`。
- 可以重複執行：用 `INSERT … ON CONFLICT DO NOTHING` 這類寫法，重跑不會多出重複的資料。
- 只放虛構的資料：姓名用「測試客人甲」這類一看就知道是測試的名字，電話用假的號碼，Email 用 `.example` 結尾的網域（不會寄到任何人）。
- 密碼不寫進任何檔案：每個測試帳號的密碼都是環境變數 `SEED_USER_PASSWORD`。種子檔裡寫 `current_setting('app.seed_password_hash')`，工具會先算好雜湊值放進去。
- 日期一律用「台灣的今天加幾天」：`(now() AT TIME ZONE 'Asia/Taipei')::date + 1` 是明天。不要寫死日期，過幾天測試資料才不會全部變成過去的單。
- 種子資料要符合目前的規則（例如狀態只用系統允許的值；有關聯的資料一起放齊）。

## 範例

先用 Migration 建好資料表（例如 `001_create_examples.sql`），再寫種子檔：

```sql
-- 01_users.sql：每一種身分的測試帳號（密碼是 SEED_USER_PASSWORD）
INSERT INTO users (email, name, role, password_hash)
SELECT v.email, v.name, v.role, current_setting('app.seed_password_hash')
FROM (VALUES
  ('manager@test.example', '測試管理者', 'manager'),
  ('clerk@test.example', '測試門市人員', 'clerk')
) AS v(email, name, role)
ON CONFLICT (email) DO NOTHING;
```

```sql
-- 02_examples.sql：日期用台灣的今天加幾天
INSERT INTO examples (code, title, due_date)
VALUES
  ('T-0001', '測試資料甲', (now() AT TIME ZONE 'Asia/Taipei')::date + 1),
  ('T-0002', '測試資料乙', (now() AT TIME ZONE 'Asia/Taipei')::date + 2)
ON CONFLICT (code) DO NOTHING;
```

上面的資料表與欄位只是例子（`examples` 這張表不存在），照你們的 PRD 與 Migration 寫。

## 怎麼執行

先在 `.env` 設定 `SEED_USER_PASSWORD`（自己取，至少 10 個字，不要用平常用的密碼），再執行：

```bash
npm run db:seed
```

- 沒有設定 `SEED_USER_PASSWORD`（或少於 10 個字）：不放任何資料，印出要怎麼設定，結束代碼 1。
- 全部檔案放在同一個交易：任何一個失敗，全部還原，不會只放一半。
- 每個檔案印一行 `[seed] 01_users……完成`。
- 部署時（Staging）用 `--if-empty`：資料庫還沒有任何帳號才放，已經有帳號就略過。Staging 的 `SEED_USER_PASSWORD` 由技術導師設定，沒設定時只印警告、照常啟動，不會建立測試帳號。
- 種子資料只在帳號還沒建立時寫入密碼：已經存在的帳號（`ON CONFLICT DO NOTHING`）不會被改回初始密碼，改過的密碼會留著。
