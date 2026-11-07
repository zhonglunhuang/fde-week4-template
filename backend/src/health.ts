// 健康檢查 GET /api/health：每次都實際查一次資料庫（2 秒逾時）。
//   正常          200 {"status":"ok","database":"ok"}
//   資料庫有問題  503 {"status":"error","database":"error"}（後端照常執行，資料庫恢復後自動回到 200）
// APP_ENV 不是 development 時多一個 "version"（這次部署的版本），本機不加。
// 開場簡報（scripts/framework-config.sh 的 HEALTH_URL）、首頁、Render 的部署檢查都用它。
import { Router } from 'express';
import type { Db } from './db.js';
import { getVersion } from './version.js';

const DATABASE_CHECK_TIMEOUT_MS = 2000;

async function databaseIsUp(db: Db): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('database check timed out')), DATABASE_CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([db.query('SELECT 1'), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const healthRouter = Router();

healthRouter.get('/api/health', async (req, res) => {
  const ok = await databaseIsUp(req.db);
  const body: Record<string, string> = ok
    ? { status: 'ok', database: 'ok' }
    : { status: 'error', database: 'error' };
  if (req.config.appEnv !== 'development') body.version = getVersion();
  res.set('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json(body);
});
