// 伺服器 Log：印在執行 npm run dev:api 的那個分頁（Staging 印在 Render 的 Logs）。
//
// 每一行的格式（和第三週 Day 11、Day 12 教材的 Log 範例同一個格式）：
//   2026-11-19T14:52:31.104+08:00 INFO  req=b71c POST /api/orders/57/cancel user_id=5
//   時間（一律台灣時間 +08:00）、等級（INFO／WARN／ERROR，佔 5 格）、req=請求編號（有才印）、訊息、key=value
// Stack Trace 從第二行起縮排 4 格，只寫進 Log，不回給使用者。
// 不記姓名、Email、電話、Token 與請求內容；要辨識使用者只記 user_id。

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string | Error, fields?: LogFields): void;
}

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 台灣時間，例如 2026-11-19T14:52:31.104+08:00（主機用 UTC 也一樣）。 */
export function formatTimestamp(date: Date = new Date()): string {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().replace('Z', '+08:00');
}

function formatValue(value: string | number | boolean | null): string {
  const text = String(value);
  return text === '' || /[\s"]/.test(text) ? JSON.stringify(text) : text;
}

export function formatLine(level: LogLevel, message: string, fields?: LogFields, requestId?: string): string {
  const [firstLine = '', ...rest] = message.split('\n');
  const parts = [formatTimestamp(), level.padEnd(5)];
  if (requestId) parts.push(`req=${requestId}`);
  parts.push(firstLine);
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value !== undefined) parts.push(`${key}=${formatValue(value)}`);
  }
  const continuation = rest.filter((line) => line.trim() !== '').map((line) => `    ${line.trimStart()}`);
  return [parts.join(' '), ...continuation].join('\n');
}

/** 錯誤的原始訊息；Node 同時試多個位址失敗時（AggregateError）把每一個都列出來。 */
export function errorMessage(err: unknown): string {
  if (err instanceof AggregateError && !err.message && err.errors.length > 0) {
    return err.errors.map((inner) => errorMessage(inner)).join('; ');
  }
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

type LogSink = (line: string) => void;
const writeToStdout: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};
let sink: LogSink = writeToStdout;

/** 測試用：把 Log 導到別的地方（不給參數就恢復印到畫面）。 */
export function setLogSink(next?: LogSink): void {
  sink = next ?? writeToStdout;
}

export function createLogger(requestId?: string): Logger {
  return {
    info: (message, fields) => sink(formatLine('INFO', message, fields, requestId)),
    warn: (message, fields) => sink(formatLine('WARN', message, fields, requestId)),
    error: (message, fields) => {
      const text = message instanceof Error ? (message.stack ?? `${message.name}: ${message.message}`) : message;
      sink(formatLine('ERROR', text, fields, requestId));
    },
  };
}

/** 不屬於任何請求的 Log（啟動、連線池）。請求裡面一律用 req.log，會自動帶 req=。 */
export const logger = createLogger();
