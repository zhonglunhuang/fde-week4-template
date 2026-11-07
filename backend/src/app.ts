// 組裝後端：middleware 的順序、內建的 API、錯誤處理。新功能的 API 在下面「新功能的 API」那裡註冊。
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type RequestHandler } from 'express';
import { createAuthRouter } from './auth/routes.js';
import { loadSession, type UserRow } from './auth/session.js';
import { REPO_ROOT, type Config } from './config.js';
import type { Db } from './db.js';
import { healthRouter } from './health.js';
import { logger, type Logger } from './logger.js';
import { apiNotFound, errorHandler } from './middleware/error-handler.js';
import { logRequest, requestContext } from './middleware/request-log.js';
import { getVersion, versionRouter } from './version.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- 擴充 Express 的 Request 型別只能這樣寫
  namespace Express {
    interface Request {
      /** 資料庫：req.db.query()、req.db.tx() */
      db: Db;
      config: Config;
      /** 這個請求的 Log，自動帶 req=請求編號 */
      log: Logger;
      requestId: string;
      /** 登入者（users 的整列，不含 password_hash）；沒登入是 undefined。需要登入的 API 用 requireUser、requireRole 與 getUser(req)。 */
      user?: UserRow;
    }
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  /** 打包好的前端（development 以外才用），預設 frontend/dist；測試可以換成別的資料夾 */
  frontendDir?: string;
}

/** 開發時前端（WEB_PORT，預設 3000）和後端（4000）不同埠，要允許前端呼叫，而且帶登入資訊。 */
function devCors(webPort: number): RequestHandler {
  const allowed = new Set([`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`]);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed.has(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Expose-Headers': 'X-Request-Id',
        Vary: 'Origin',
      });
      if (req.method === 'OPTIONS') {
        res.set({
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '600',
        });
        res.status(204).end();
        return;
      }
    }
    next();
  };
}

/** development 以外（Staging）：同一個服務提供打包好的前端（frontend/dist）與 /config.js。 */
function serveFrontend(app: Express, config: Config, distDir: string): void {
  const indexHtml = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtml)) logger.warn('frontend build not found; run npm run build', { path: indexHtml });

  const configScript = `window.APP_CONFIG=${JSON.stringify({
    apiBaseUrl: config.apiBaseUrl,
    appEnv: config.appEnv,
    version: getVersion(),
  })};\n`;
  app.get('/config.js', (_req, res) => {
    res.type('text/javascript').set('Cache-Control', 'no-store').send(configScript);
  });
  app.use(express.static(distDir, { index: false }));
  // 不是 /api 的 GET 一律回 index.html，讓前端的路由（例如 /login）重新整理也打得開
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    res.set('Cache-Control', 'no-cache').sendFile(indexHtml);
  });
}

export function createApp({ config, db, frontendDir }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.appEnv !== 'development') {
    app.set('trust proxy', 1); // Render 前面有一層代理
    app.use((_req, res, next) => {
      res.set('X-Robots-Tag', 'noindex'); // 測試環境不讓搜尋引擎收錄
      next();
    });
  }

  app.use((req, _res, next) => {
    req.config = config;
    req.db = db;
    next();
  });
  if (config.appEnv === 'development') app.use(devCors(config.webPort));
  app.use(requestContext);
  app.use(healthRouter);
  app.use(versionRouter); // /api/version 不用登入，也不查資料庫
  app.use(loadSession);
  app.use(logRequest); // 解析完登入資訊才印請求那一行；解析失敗（資料庫停了）也照印，再交給錯誤處理
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth', createAuthRouter());
  // ── 新功能的 API 在這裡註冊，例如：app.use('/api/orders', ordersRouter);

  app.use('/api', apiNotFound);
  if (config.appEnv !== 'development') {
    serveFrontend(app, config, frontendDir ?? path.join(REPO_ROOT, 'frontend', 'dist'));
  }
  app.use(errorHandler);
  return app;
}
