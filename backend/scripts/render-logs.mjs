// 技術導師用：把一個 Render 服務某段日期的 Log 存成檔案（Day 16 的 Log 檢查：搜尋有沒有印出客人的電話）。
//
//   node backend/scripts/render-logs.mjs <服務 ID> <開始日期> [結束日期] > staging.log
//   例：node backend/scripts/render-logs.mjs srv-abc123 2026-11-18 2026-11-20 > staging.log
//
// - 日期是台灣的日期（YYYY-MM-DD），包含結束日期那一整天；沒給結束日期，就只匯出開始日期那一天。
//   Render 免費方案的 Log 只保留幾天，太早的日期會是空的。
// - 服務 ID（srv- 開頭）在 Render 服務頁面的網址或 Settings 裡；各組的寫在「各組 Staging 一覽」。
// - RENDER_API_KEY：先從環境變數讀；沒有就在畫面上請你貼上（不會顯示出來）。
//   這把 Key 讀得到這個 Render 帳號裡的每一個服務：要用的時候才在 Account Settings → API Keys 建立，
//   只在你自己的電腦上執行，匯出完就刪掉。
// - 檔案裡每一行是「台灣時間 Log 的內容」，照時間排序；進度印在畫面上（stderr），不會混進檔案。
// - 只用 Node.js 內建的功能（fetch），不用先 npm install。
import { isMain, sleep } from './staging-common.mjs';

const API_BASE = 'https://api.render.com/v1';
const PAGE_LIMIT = 100;
const MAX_PAGES = 5000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export class LogsError extends Error {}

/** 台灣時間到毫秒，例如 2026-11-19 14:52:31.104。 */
export function taipeiTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 23).replace('T', ' ');
}

/** 台灣日期（含那一整天）→ 查詢用的 startTime、endTime（UTC）。 */
export function timeRange(startDate, endDate = startDate) {
  for (const value of [startDate, endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || Number.isNaN(new Date(`${value}T00:00:00+08:00`).getTime())) {
      throw new LogsError(`日期要寫成 YYYY-MM-DD，例如 2026-11-20（現在是 ${value ?? '空白'}）`);
    }
  }
  const start = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(new Date(`${endDate}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000);
  if (end <= start) throw new LogsError('結束日期不能比開始日期早');
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

/** 一則 Log → 檔案裡的一行（多行的訊息，後面幾行縮排，grep 一樣搜尋得到）。 */
export function formatLogLine(entry) {
  const message = String(entry.message ?? '').replace(/\r?\n/g, '\n    ');
  return `${taipeiTimestamp(entry.timestamp)} ${message}`;
}

async function request(apiBase, apiKey, path, params, { report }) {
  const url = new URL(`${apiBase}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  for (let attempt = 1; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      if (attempt >= 4) throw new LogsError('連不上 Render 的 API，請確認網路後再試一次');
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 6) throw new LogsError(`Render 的 API 一直回 ${res.status}，請過幾分鐘再試`);
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 5000 * attempt;
      report(`Render 的 API 回 ${res.status}，${Math.ceil(waitMs / 1000)} 秒後再試`);
      await sleep(waitMs);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new LogsError('Render 不接受這個 API Key：確認貼的是完整的 Key，而且這個帳號看得到這個服務');
    }
    if (res.status === 404) throw new LogsError('找不到這個服務：確認服務 ID（srv- 開頭）有沒有打錯');
    if (!res.ok) throw new LogsError(`Render 的 API 回 ${res.status}`);
    return res.json();
  }
}

/**
 * 依序取得這段時間的 Log（由舊到新），每一則呼叫 onLog。回傳總共幾則。
 * 照 Render 的分頁方式：hasMore 是 true，就用 nextStartTime、nextEndTime 查下一頁。
 */
export async function fetchLogs({ serviceId, startTime, endTime, apiKey, apiBase = API_BASE, onLog, report = () => {} }) {
  const service = await request(apiBase, apiKey, `/services/${encodeURIComponent(serviceId)}`, undefined, { report });
  const ownerId = service?.ownerId;
  if (!ownerId) throw new LogsError('Render 回傳的服務資料沒有 ownerId');

  const seen = new Set();
  let total = 0;
  let range = { startTime, endTime };
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await request(
      apiBase,
      apiKey,
      '/logs',
      { ownerId, resource: serviceId, direction: 'forward', limit: String(PAGE_LIMIT), ...range },
      { report },
    );
    const logs = Array.isArray(body?.logs) ? body.logs : [];
    for (const entry of logs) {
      const key = entry.id ?? `${entry.timestamp}|${entry.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += 1;
      onLog(entry);
    }
    const last = logs[logs.length - 1];
    report(`第 ${page} 頁，共 ${total} 則${last ? `（到 ${taipeiTimestamp(last.timestamp).slice(0, 19)}）` : ''}`);
    if (!body?.hasMore || !body.nextStartTime || !body.nextEndTime) return total;
    const next = { startTime: body.nextStartTime, endTime: body.nextEndTime };
    if (next.startTime === range.startTime && next.endTime === range.endTime && logs.length === 0) return total;
    range = next;
  }
  report(`已經取了 ${MAX_PAGES} 頁，先停在這裡；需要更多請把日期範圍分小一點`);
  return total;
}

/** 在畫面上請使用者貼上 API Key，不顯示輸入的內容。 */
function promptHidden(question) {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    return Promise.reject(
      new LogsError(
        '沒有 RENDER_API_KEY，這個視窗也沒辦法輸入。先執行 read -s RENDER_API_KEY 貼上 Key、按 Enter，再執行 export RENDER_API_KEY，然後重新執行這個指令',
      ),
    );
  }
  stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new LogsError('已取消'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

const USAGE = '用法：node backend/scripts/render-logs.mjs <服務 ID> <開始日期> [結束日期] > staging.log\n例如：node backend/scripts/render-logs.mjs srv-abc123 2026-11-18 2026-11-20 > staging.log';

export async function main(argv = process.argv.slice(2), env = process.env) {
  const report = (message) => process.stderr.write(`[render-logs] ${message}\n`);
  try {
    const [serviceId, startDate, endDate] = argv;
    if (!serviceId || !startDate || argv.length > 3) throw new LogsError(USAGE);
    if (!/^srv-[A-Za-z0-9]+$/.test(serviceId)) {
      throw new LogsError(`服務 ID 要是 srv- 開頭（現在是 ${serviceId}）\n${USAGE}`);
    }
    const { startTime, endTime } = timeRange(startDate, endDate);
    if (process.stdout.isTTY) report('提醒：Log 會印在畫面上；要存成檔案，指令最後加上 > staging.log');
    const apiKey = env.RENDER_API_KEY?.trim() || (await promptHidden('貼上 Render 的 API Key（不會顯示），按 Enter：'));
    if (!apiKey) throw new LogsError('沒有輸入 API Key');

    report(`匯出 ${serviceId} 從 ${startDate} 到 ${endDate ?? startDate}（台灣日期）的 Log……`);
    const total = await fetchLogs({
      serviceId,
      startTime,
      endTime,
      apiKey,
      apiBase: env.RENDER_API_BASE?.trim() || API_BASE,
      onLog: (entry) => process.stdout.write(`${formatLogLine(entry)}\n`),
      report,
    });
    report(`完成：共 ${total} 則`);
    report('這把 API Key 讀得到這個 Render 帳號的每一個服務：不再匯出就到 Render 的 Account Settings → API Keys 刪掉');
    return 0;
  } catch (err) {
    report(err instanceof LogsError ? err.message : `發生沒有預期的錯誤：${err?.message ?? err}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main();
