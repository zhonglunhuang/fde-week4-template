// Request log：每個 /api 請求印兩行，用 req=請求編號 串起同一個請求（Day 7 學過的讀法）。
//   INFO  req=b71c POST /api/orders/57/cancel user_id=5     ← 解析完登入資訊才印；有登入才帶 user_id
//   INFO  req=b71c responded status=500                     ← 回應送出時
//   WARN  req=a913 GET /api/orders slow response duration_ms=1840   ← 超過 1 秒另外印
// 查不到登入資訊（例如資料庫停了）也照樣印這兩行，中間是錯誤處理印的 ERROR。
// /api/health 與靜態檔不記。請求裡要寫 Log，一律用 req.log.info/warn/error，會自動帶 req=。
import crypto from 'node:crypto';
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import { createLogger } from '../logger.js';

const SLOW_RESPONSE_MS = 1000;

/** 每個請求的編號（2 bytes 的 hex，例如 b71c）與 req.log；回應的 header 會帶 X-Request-Id。 */
export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = crypto.randomBytes(2).toString('hex');
  req.log = createLogger(req.requestId);
  res.locals.startedAt = performance.now();
  res.set('X-Request-Id', req.requestId);
  next();
};

function pathOf(url: string): string {
  return url.split('?')[0] ?? url;
}

/** 印請求那一行（有登入才帶 user_id），並在回應送出時印結果；超過 1 秒另外印 WARN。 */
function startRequestLog(req: Request, res: Response): void {
  const path = pathOf(req.originalUrl);
  if (!path.startsWith('/api/') || path === '/api/health') return;
  req.log.info(`${req.method} ${path}`, req.user ? { user_id: req.user.id } : undefined);
  res.on('finish', () => {
    req.log.info('responded', { status: res.statusCode });
    const startedAt = typeof res.locals.startedAt === 'number' ? res.locals.startedAt : performance.now();
    const durationMs = Math.round(performance.now() - startedAt);
    if (durationMs > SLOW_RESPONSE_MS) {
      req.log.warn(`${req.method} ${path} slow response`, { duration_ms: durationMs });
    }
  });
}

/**
 * 掛在解析登入資訊（loadSession）之後。兩個 handler 每個請求只會跑到其中一個：
 * - 解析成功：印請求那一行，接著處理請求。
 * - 解析失敗（例如資料庫停了，查不了登入資訊）：一樣印請求那一行（沒有 user_id），
 *   再把錯誤交給錯誤處理（印 ERROR、回 500），回應送出時照樣印 responded status=500。
 */
export const logRequest: [RequestHandler, ErrorRequestHandler] = [
  (req, res, next) => {
    startRequestLog(req, res);
    next();
  },
  (err, req, res, next) => {
    startRequestLog(req, res);
    next(err);
  },
];
