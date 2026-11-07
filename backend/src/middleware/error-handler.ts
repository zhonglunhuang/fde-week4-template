// 錯誤回應：一律是 {"error":"代碼","message":"看得懂的中文"}，不回 Stack Trace。
//
//   預期內的錯誤（權限、狀態、輸入不對）：throw httpError(400, 'invalid_input', '請填寫名稱');
//   沒預期到的錯誤：Stack Trace 只寫進 Log（ERROR req=…），使用者看到 500「系統忙碌，請稍後再試」。
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function httpError(status: number, code: string, message: string): HttpError {
  return new HttpError(status, code, message);
}

/** 不存在的 /api 路徑。 */
export const apiNotFound: RequestHandler = (_req, _res, next) => {
  next(httpError(404, 'not_found', '找不到這個網址'));
};

/** express.json() 解析失敗時丟出的錯誤（body-parser 會帶 type）。 */
function bodyParserError(err: unknown): HttpError | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err)) return undefined;
  if (err.type === 'entity.parse.failed') return httpError(400, 'invalid_json', '送出的資料格式不正確（不是 JSON）');
  if (err.type === 'entity.too.large') return httpError(413, 'payload_too_large', '送出的資料太大');
  return undefined;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const known = err instanceof HttpError ? err : bodyParserError(err);
  if (known) {
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(known.status).json({ error: known.code, message: known.message });
    return;
  }

  (req.log ?? logger).error(err instanceof Error ? err : new Error(String(err)));
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: 'internal', message: '系統忙碌，請稍後再試' });
};
