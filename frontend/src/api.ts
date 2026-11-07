// 呼叫後端的唯一入口：一律用 api()，會自動加上 API 位址與登入資訊（Cookie）。
//
//   const me = await api<User>('/api/auth/me');
//   await api('/api/auth/login', { method: 'POST', body: { email, password } });
//
// 後端回錯誤時丟出 ApiError（status、code 與後端給的中文 message）；
// 完全連不到後端時丟出 ApiError，status 是 0。
import { appConfig } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${appConfig.apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'unreachable', '無法連線到後端，請確認後端已經啟動');
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = typeof data === 'object' && data !== null ? (data as { error?: unknown; message?: unknown }) : {};
    throw new ApiError(
      res.status,
      typeof body.error === 'string' ? body.error : 'http_error',
      typeof body.message === 'string' ? body.message : `後端回應錯誤（HTTP ${res.status}）`,
    );
  }
  return data as T;
}

/**
 * 健康檢查（在瀏覽器端呼叫，DevTools 的 Network 看得到 health 這個請求）：
 *   ok           200：後端正常、資料庫正常
 *   database     503：後端正常、資料庫異常
 *   unreachable  沒有回應：後端無法連線、資料庫無法確認
 *   unexpected   有回應但不是健康檢查的格式（例如 API 位址指到別的程式）
 */
export type HealthState = 'ok' | 'database' | 'unreachable' | 'unexpected';

export async function checkHealth(): Promise<HealthState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${appConfig.apiBaseUrl}/api/health`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
    const body: unknown = await res.json().catch(() => null);
    const status = typeof body === 'object' && body !== null ? (body as { status?: unknown }).status : undefined;
    if (res.status === 200 && status === 'ok') return 'ok';
    if (res.status === 503 && status === 'error') return 'database';
    return 'unexpected';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}
