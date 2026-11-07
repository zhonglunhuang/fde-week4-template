// 需要登入、需要某種身分的 API（模板內建；沒有票寫明，不要修改 backend/src/auth/）。
//
//   router.get('/', requireUser, async (req, res) => {
//     const user = getUser(req);              // users 的整列（不含 password_hash），例如 user.id、user.role
//     ...資料範圍、狀態一律在這裡（伺服器端）檢查，不相信畫面送來的身分或狀態...
//   });
//   router.post('/', requireRole('manager', 'clerk'), async (req, res) => { ... });   // 只有這些身分能用
//
// 沒登入（或帳號已停用）：401 {"error":"unauthorized","message":"請先登入"}
// 身分不符：             403 {"error":"forbidden","message":"沒有權限"}
// 身分的值（manager、clerk……）由各專案自己決定，模板不列清單。
import type { Request, RequestHandler } from 'express';
import { httpError } from '../middleware/error-handler.js';
import type { UserRow } from './session.js';

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(httpError(401, 'unauthorized', '請先登入'));
    return;
  }
  next();
};

/** 只有這些身分（users.role）能用；沒登入回 401，身分不符回 403。 */
export function requireRole(...roles: string[]): RequestHandler {
  if (roles.length === 0) throw new Error('requireRole 至少要給一個身分，例如 requireRole("manager")');
  return (req, _res, next) => {
    if (!req.user) {
      next(httpError(401, 'unauthorized', '請先登入'));
      return;
    }
    const role = req.user.role;
    if (typeof role !== 'string' || !roles.includes(role)) {
      next(httpError(403, 'forbidden', '沒有權限'));
      return;
    }
    next();
  };
}

export function getUser(req: Request): UserRow {
  if (!req.user) throw httpError(401, 'unauthorized', '請先登入');
  return req.user;
}
