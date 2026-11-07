// 登入的 session（模板內建；沒有票寫明，不要修改 backend/src/auth/）。
//
// - 登入成功時產生一個 Token（32 bytes 的 base64url），只交給使用者；
//   資料庫的 sessions.id 存的是 HMAC-SHA256(SESSION_SECRET, Token)，資料庫外流也拿不到 Token。
// - 有效 12 小時。sessions.kind 記這個 Token 給誰用：cookie（瀏覽器登入）或 api（Postman 用的 Token）。
// - Token 放在 Cookie（app_session，瀏覽器用），或 Authorization: Bearer <Token>（Postman 用）。
//   有 Authorization: Bearer 就只看它、不看 Cookie：Postman 換身分時，才不會混到 Cookie 裡別人的身分。
// - 每個請求都重新讀一次 users 的整列：帳號停用了，原本的登入立刻當成沒登入。
// - 登出時刪掉 session，同一個 Token（包括複製到 Postman 的）立刻失效。
import crypto from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { Db } from '../db.js';

export const SESSION_COOKIE = 'app_session';
export const SESSION_HOURS = 12;
const SESSION_MAX_AGE_MS = SESSION_HOURS * 60 * 60 * 1000;

export type SessionKind = 'cookie' | 'api';

/**
 * 登入者：users 表的整列，但不含 password_hash。
 * 之後的 Migration 在 users 加的欄位（例如員工編號 employee_no）會自動帶出來。
 */
export type UserRow = {
  id: number;
  email: string;
  name: string;
  /** 身分，例如 manager；模板不限定有哪些值，權限用 requireRole 檢查 */
  role: string | null;
  is_active: boolean;
  created_at: Date;
} & Record<string, unknown>;

/** 拿掉 password_hash：回給畫面、放進 req.user 的使用者資料一律經過這裡。 */
export function publicUser(row: Record<string, unknown>): UserRow {
  const { password_hash: _passwordHash, ...user } = row;
  return user as UserRow;
}

export function hashToken(secret: string, token: string): string {
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

/** 建立 session，回傳 Token（只有這一次拿得到）與到期時間。 */
export async function createSession(
  db: Db,
  secret: string,
  userId: number,
  kind: SessionKind,
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO sessions (id, user_id, kind, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))
     RETURNING expires_at`,
    [hashToken(secret, token), userId, kind, SESSION_HOURS],
  );
  return { token, expiresAt: rows[0]!.expires_at };
}

export async function deleteSession(db: Db, secret: string, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE id = $1', [hashToken(secret, token)]);
}

/** Token 對應的使用者；過期、找不到或帳號已停用都回 undefined（當成沒登入）。 */
export async function findSessionUser(db: Db, secret: string, token: string): Promise<UserRow | undefined> {
  const { rows } = await db.query(
    `SELECT u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now() AND u.is_active`,
    [hashToken(secret, token)],
  );
  return rows[0] ? publicUser(rows[0]) : undefined;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

/** 從請求取出 Token：有 Authorization: Bearer 就只看它；沒有才看 Cookie。 */
export function readToken(req: Request): string | undefined {
  const authorization = req.get('authorization')?.trim();
  if (authorization && /^bearer(\s|$)/i.test(authorization)) {
    return authorization.slice(6).trim() || undefined;
  }
  return readCookie(req.get('cookie'), SESSION_COOKIE);
}

function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    // Staging 是 https，Cookie 只走加密連線
    secure: req.config.appEnv !== 'development',
  };
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

/** 每個 /api 請求先解析登入資訊：登入中就把 users 的整列（不含 password_hash）放進 req.user。 */
export const loadSession: RequestHandler = async (req, _res, next) => {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  const token = readToken(req);
  if (token) req.user = await findSessionUser(req.db, req.config.sessionSecret, token);
  next();
};
