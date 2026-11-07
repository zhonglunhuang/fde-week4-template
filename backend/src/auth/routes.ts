// 登入相關的 API（模板內建；沒有票寫明，不要修改 backend/src/auth/）。
//
//   POST /api/auth/login     body {"email":"…","password":"…"}；設定 Cookie（瀏覽器用），回 {"user":{…}}
//   POST /api/auth/token     body 同上；不設 Cookie，回 {"token":"…","expiresAt":"…","user":{…}}（Postman 用）
//   POST /api/auth/logout    刪掉這一個登入（Cookie 或 Token），回 204
//   GET  /api/auth/me        登入者：users 的整列，不含 password_hash；沒登入回 401
//   POST /api/auth/password  body {"currentPassword":"…","newPassword":"…"}；修改自己的密碼，回 204
//
// - 帳號不存在、密碼錯、帳號已停用，一律回 401「帳號或密碼不正確」，不透露是哪一種。
// - 同一個 IP 對同一個帳號連續登入失敗 10 次，15 分鐘內不再接受登入（429），擋掉猜密碼。
//   查密碼之前先佔一次失敗的名額，密碼對了才清掉：同時送出很多次，也只有前 10 次會查密碼，其他的直接 429。
//   次數記在這個後端的記憶體（重新啟動就清空），最多記 10,000 組，滿了先刪最早的一筆；Email 超過 254 個字
//   （Email 的長度上限）直接回 401，不查資料庫、也不記次數。不管送來多少、多長的亂填帳號，佔的記憶體都有上限。
// - 修改密碼時「目前的密碼」也一樣：同一個帳號 15 分鐘內錯 10 次，就先不接受（429）。
// - 修改密碼後，舊密碼不能再登入；已經登入的視窗與 Token 不會被登出（UAT 中途不會被踢出去）。
// - Log 只記 user_id，不記 Email、密碼或 Token。
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { httpError } from '../middleware/error-handler.js';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from './password.js';
import { getUser, requireUser } from './require-user.js';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  publicUser,
  readToken,
  setSessionCookie,
  type UserRow,
} from './session.js';

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
/** 失敗次數最多記幾組（IP＋Email）；滿了先刪最早記下的一筆。 */
const MAX_TRACKED_KEYS = 10_000;
/** Email 最多幾個字（Email 的長度上限）。 */
const MAX_EMAIL_LENGTH = 254;

export interface FailureCounter {
  /**
   * 查密碼之前先佔一次失敗的名額；15 分鐘內已經錯滿 10 次就回 false（不佔名額）。
   * 先佔再查，同時送出很多次也只有前 10 次會去查密碼。
   */
  reserve(key: string, now?: number): boolean;
  /** 沒查完就出錯（例如資料庫連不上）：還回剛才佔的名額，不算一次失敗。 */
  release(key: string): void;
  /** 密碼對了：清掉這一組的次數。 */
  reset(key: string): void;
  /** 15 分鐘內錯滿 10 次：暫時不接受。 */
  blocked(key: string, now?: number): boolean;
  /** 目前記了幾組。 */
  readonly size: number;
}

/**
 * 登入失敗的次數（每個後端各自記在記憶體；重新啟動就清空）。
 * 最多記 maxKeys 組，滿了先刪最早記下的一筆。不整個清空：整個清空的話，
 * 送一堆亂填的帳號，就能把正在被猜密碼、已經擋下的帳號一起解開。
 */
export function createFailureCounter({ maxKeys = MAX_TRACKED_KEYS }: { maxKeys?: number } = {}): FailureCounter {
  // Map 照加入的順序排，第一筆就是最早記下的（過了 15 分鐘再錯，會刪掉重新加在最後面）
  const failures = new Map<string, { count: number; firstAt: number }>();
  const live = (key: string, now: number) => {
    const entry = failures.get(key);
    if (entry && now - entry.firstAt > FAILURE_WINDOW_MS) {
      failures.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    reserve(key, now = Date.now()) {
      const entry = live(key, now);
      if (entry) {
        if (entry.count >= MAX_FAILURES) return false;
        entry.count += 1;
        return true;
      }
      if (failures.size >= maxKeys) {
        const oldest = failures.keys().next();
        if (!oldest.done) failures.delete(oldest.value);
      }
      failures.set(key, { count: 1, firstAt: now });
      return true;
    },
    release(key) {
      const entry = failures.get(key);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count <= 0) failures.delete(key);
    },
    reset(key) {
      failures.delete(key);
    },
    blocked(key, now = Date.now()) {
      return (live(key, now)?.count ?? 0) >= MAX_FAILURES;
    },
    get size() {
      return failures.size;
    },
  };
}

/**
 * 計數用的鍵：IP 與 Email（不分大小寫、前後的空白不算）的 SHA-256，固定 43 個字。
 * 送來的 IP（X-Forwarded-For）或 Email 再長，每一組佔的記憶體都一樣，記憶體裡也不留 Email 本身。
 */
export function failureKey(ip: string | undefined, email: string): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([ip ?? '', email.trim().toLowerCase()]))
    .digest('base64url');
}

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null && name in body ? (body as Record<string, unknown>)[name] : undefined;
}

function invalidCredentials() {
  return httpError(401, 'invalid_credentials', '帳號或密碼不正確');
}

export interface AuthRouterOptions {
  /** 登入失敗的計數（鍵是 IP 加 Email）；預設每個後端一個。測試換成自己建的，才看得到裡面記了幾組。 */
  failures?: FailureCounter;
  /** 修改密碼時「目前的密碼」錯的計數（鍵是帳號的 id）；預設每個後端一個。 */
  passwordFailures?: FailureCounter;
}

export function createAuthRouter({
  failures = createFailureCounter(),
  passwordFailures = createFailureCounter(),
}: AuthRouterOptions = {}): Router {
  const router = Router();

  /** 檢查帳號密碼，對了回傳使用者（不含 password_hash）。 */
  async function authenticate(req: Request): Promise<UserRow> {
    const email = field(req.body, 'email');
    const password = field(req.body, 'password');
    if (typeof email !== 'string' || email.trim() === '' || typeof password !== 'string' || password === '') {
      throw httpError(400, 'invalid_input', '請輸入 Email 與密碼');
    }
    if (email.trim().length > MAX_EMAIL_LENGTH) {
      // 沒有這麼長的 Email：回一樣的 401，不查資料庫、也不記次數（記下來的話，每一個都要佔記憶體）
      req.log.warn('login failed', { reason: 'email_too_long' });
      throw invalidCredentials();
    }
    const key = failureKey(req.ip, email);
    // 先佔一次失敗的名額再查密碼：同時送出很多次，也只有前 10 次會查，其他的直接 429
    if (!failures.reserve(key)) {
      throw httpError(429, 'too_many_attempts', '登入失敗太多次，請 15 分鐘後再試');
    }

    let row: UserRow | undefined;
    let passwordOk: boolean;
    try {
      const { rows } = await req.db.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
      row = rows[0];
      const passwordHash = typeof row?.password_hash === 'string' ? row.password_hash : undefined;
      passwordOk = password.length <= MAX_PASSWORD_LENGTH && (await verifyPassword(password, passwordHash));
    } catch (err) {
      failures.release(key); // 沒查完（例如資料庫連不上）不算一次失敗
      throw err;
    }
    if (!row || !passwordOk || row.is_active !== true) {
      // 剛才佔的名額就是這一次的失敗
      req.log.warn('login failed', row ? { user_id: row.id } : undefined);
      throw invalidCredentials();
    }
    failures.reset(key);
    await req.db.query('DELETE FROM sessions WHERE expires_at < now()');
    return publicUser(row);
  }

  router.post('/login', async (req, res) => {
    const user = await authenticate(req);
    const { token } = await createSession(req.db, req.config.sessionSecret, user.id, 'cookie');
    setSessionCookie(req, res, token);
    req.log.info('login succeeded', { user_id: user.id });
    res.json({ user });
  });

  router.post('/token', async (req, res) => {
    const user = await authenticate(req);
    const { token, expiresAt } = await createSession(req.db, req.config.sessionSecret, user.id, 'api');
    req.log.info('token issued', { user_id: user.id });
    res.json({ token, expiresAt, user });
  });

  router.post('/logout', async (req, res) => {
    const token = readToken(req);
    if (token) await deleteSession(req.db, req.config.sessionSecret, token);
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  router.get('/me', requireUser, (req, res) => {
    res.json(getUser(req));
  });

  router.post('/password', requireUser, async (req, res) => {
    const user = getUser(req);
    const currentPassword = field(req.body, 'currentPassword');
    const newPassword = field(req.body, 'newPassword');
    if (typeof currentPassword !== 'string' || currentPassword === '' || typeof newPassword !== 'string') {
      throw httpError(400, 'invalid_input', '請輸入目前的密碼與新密碼');
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw httpError(400, 'password_too_short', `新密碼至少要 ${MIN_PASSWORD_LENGTH} 個字`);
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      throw httpError(400, 'password_too_long', `新密碼最多 ${MAX_PASSWORD_LENGTH} 個字`);
    }

    // 和登入一樣：先佔一次失敗的名額再查目前的密碼，同一個帳號 15 分鐘內錯滿 10 次就先不接受
    const key = String(user.id);
    if (!passwordFailures.reserve(key)) {
      throw httpError(429, 'too_many_attempts', '目前的密碼錯太多次，請 15 分鐘後再試');
    }
    let currentOk: boolean;
    try {
      const { rows } = await req.db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      const stored = typeof rows[0]?.password_hash === 'string' ? rows[0].password_hash : undefined;
      currentOk = currentPassword.length <= MAX_PASSWORD_LENGTH && (await verifyPassword(currentPassword, stored));
    } catch (err) {
      passwordFailures.release(key);
      throw err;
    }
    if (!currentOk) {
      req.log.warn('password change failed', { user_id: user.id });
      throw httpError(400, 'wrong_password', '目前的密碼不正確');
    }
    passwordFailures.reset(key);
    if (newPassword === currentPassword) throw httpError(400, 'same_password', '新密碼要和目前的密碼不同');

    await req.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(newPassword), user.id]);
    req.log.info('password changed', { user_id: user.id });
    res.status(204).end();
  });

  return router;
}
