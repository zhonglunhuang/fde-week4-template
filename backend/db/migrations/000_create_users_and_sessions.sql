-- 模板內建：登入用的帳號（users）與登入紀錄（sessions）。
-- 之後要在 users 加欄位（例如員工編號 employee_no），一律新增一個 Migration，不要改這個檔。
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- 身分：模板不限定有哪些值（例如 manager、clerk、baker），由專案自己決定；權限用 requireRole 檢查
  role TEXT,
  -- 密碼的雜湊值（scrypt，backend/src/auth/password.ts），不存密碼本身；沒有設定的帳號不能登入
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 登入時 Email 不分大小寫，所以只差在大小寫的兩個 Email 也不能同時存在
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE sessions (
  -- HMAC-SHA256(SESSION_SECRET, Token)，資料庫不存 Token 本身
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- cookie：瀏覽器登入；api：POST /api/auth/token 給 Postman 用的 Token
  kind TEXT NOT NULL CHECK (kind IN ('cookie', 'api')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
