// 「Staging 只讀查詢」（.github/workflows/staging-select.yml）：組員在 Issue 表單貼上 SELECT，
// 這支腳本用唯讀帳號在 Staging 的資料庫執行，結果排成文字表格，印出要留在 Issue 的留言（Markdown）。
//
// 只能查、不能改。三層一起守，任何一層都擋得住：
//   1. 只接受查詢：拿掉開頭的註解後，要以 SELECT、WITH 或 EXPLAIN 開頭；一次只能一個查詢。
//   2. 唯讀帳號：STAGING_READONLY_DATABASE_URL 是技術導師用 SQL 建的 staging_reader，只有 SELECT 的權限，
//      而且預設就是唯讀交易（docs/staging-mentor.md）。
//   3. 唯讀交易：BEGIN READ ONLY → 查詢 → 一律 ROLLBACK；statement_timeout 10 秒，查太久就停。
// 結果最多顯示 200 列。錯誤只顯示 PostgreSQL 的那一句（例如 relation "orders" does not exist），
// 不顯示連線資訊。時間一律用台灣時間（TimeZone = Asia/Taipei），current_date 也是台灣的今天。
//
//   ISSUE_BODY=… STAGING_READONLY_DATABASE_URL=… node backend/scripts/staging-select.mjs > comment.md
import pg from 'pg';
import { isMain, taipeiTime } from './staging-common.mjs';

export const MAX_ROWS = 200;
export const STATEMENT_TIMEOUT = '10s';
const MAX_CELL_LENGTH = 80;
const MAX_COMMENT_LENGTH = 60_000;
export const ALLOWED_KEYWORDS = ['SELECT', 'WITH', 'EXPLAIN'];
export const CONFIRM_LINE = '請第二位組員確認範圍後，在下面留言。';

// 日期與時間照資料庫給的文字顯示（台灣時間），不轉成 JavaScript 的 Date：date、time、timestamp、timestamptz、timetz
const RAW_TEXT_TYPES = new Set([1082, 1083, 1114, 1184, 1266]);
const types = {
  getTypeParser: (oid, format) => (RAW_TEXT_TYPES.has(oid) ? (value) => value : pg.types.getTypeParser(oid, format)),
};

/** Issue 內文裡第一個 ```sql 區塊的內容；沒有就回 undefined。 */
export function extractSql(body) {
  const match = /```sql[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```/i.exec(String(body ?? ''));
  const sql = match?.[1]?.trim();
  return sql && sql !== '_No response_' ? sql : undefined;
}

/** Issue 表單「為什麼要查」那一段。 */
export function extractPurpose(body) {
  const match = /###\s*為什麼要查[^\n]*\n+([\s\S]*?)(?:\n###\s|$)/.exec(String(body ?? ''));
  const text = match?.[1]?.trim();
  return text && text !== '_No response_' ? text : undefined;
}

/** 拿掉開頭的空白與註解（-- 到行尾、/* … *\/，可以一層包一層）。 */
export function stripLeadingComments(sql) {
  let rest = String(sql);
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (rest.startsWith('--')) {
      const end = rest.search(/[\n\r]/);
      rest = end === -1 ? '' : rest.slice(end);
    } else if (rest.startsWith('/*')) {
      let depth = 0;
      let i = 0;
      do {
        if (rest.startsWith('/*', i)) {
          depth += 1;
          i += 2;
        } else if (rest.startsWith('*/', i)) {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      } while (depth > 0 && i < rest.length);
      rest = rest.slice(i);
    } else {
      return rest;
    }
  }
}

/** 接受就回 undefined，不接受就回原因（給人看的中文）。 */
export function checkSelect(sql) {
  const rest = stripLeadingComments(sql);
  if (rest === '') return '沒有要執行的查詢（只有註解或空白）';
  const keyword = /^\(*\s*([A-Za-z_]+)/.exec(rest)?.[1]?.toUpperCase();
  if (keyword && ALLOWED_KEYWORDS.includes(keyword)) return undefined;
  return `這裡只能查詢：SQL 要以 SELECT、WITH 或 EXPLAIN 開頭（這次的開頭是 ${keyword ?? '看不出來的指令'}）。要修改資料，請找帶組的技術導師`;
}

/** 連線設定：網址有 sslmode 或 channel_binding（Neon 給的會有）就改用驗證憑證的 SSL。 */
export function connectionConfig(databaseUrl) {
  let connectionString = databaseUrl;
  let ssl;
  try {
    const url = new URL(databaseUrl);
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode !== null || url.searchParams.has('channel_binding')) {
      url.searchParams.delete('sslmode');
      url.searchParams.delete('channel_binding');
      connectionString = url.toString();
      ssl = sslmode === 'disable' ? false : { rejectUnauthorized: true };
    }
  } catch {
    // 網址格式不對：交給 pg 回報
  }
  // 休眠中的 Neon 資料庫要幾秒才醒，連線等久一點
  return { connectionString, ssl, connectionTimeoutMillis: 20_000, types };
}

export class ConnectError extends Error {}

/**
 * 在唯讀交易裡執行一個查詢，最後一律 ROLLBACK。只留前 maxRows 列（其他的只數列數，不放進記憶體）。
 * 回傳 { columns, rows, rowCount, command }；查詢的錯誤照原樣丟出（有 code 與 message）；連不上丟出 ConnectError。
 */
/**
 * @param {string} databaseUrl
 * @param {string} sql
 * @param {{ maxRows?: number, statementTimeout?: string }} [options]
 * @returns {Promise<{ columns: string[], rows: unknown[][], rowCount: number, command?: string }>}
 */
export async function runSelect(databaseUrl, sql, { maxRows = MAX_ROWS, statementTimeout = STATEMENT_TIMEOUT } = {}) {
  const client = new pg.Client(connectionConfig(databaseUrl));
  client.on('error', () => {}); // 連線中途斷掉：錯誤由下面的查詢回報
  try {
    await client.connect();
  } catch {
    await client.end().catch(() => {});
    throw new ConnectError('連不上 Staging 的資料庫');
  }
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${pg.escapeLiteral(statementTimeout)}`);
    await client.query("SET LOCAL TimeZone = 'Asia/Taipei'");
    const result = await new Promise((resolve, reject) => {
      // queryMode: extended 一次只接受一個查詢，擋掉「COMMIT; DELETE …」這種跳出唯讀交易的寫法
      const query = new pg.Query({ text: sql, queryMode: 'extended', rowMode: 'array' });
      const rows = [];
      let rowCount = 0;
      let columns = [];
      query.on('row', (row, res) => {
        if (columns.length === 0 && res?.fields) columns = res.fields.map((field) => field.name);
        rowCount += 1;
        if (rows.length < maxRows) rows.push(row);
      });
      query.on('error', reject);
      query.on('end', (res) => {
        if (columns.length === 0 && res?.fields) columns = res.fields.map((field) => field.name);
        resolve({ columns, rows, rowCount, command: res?.command });
      });
      client.query(query);
    });
    return result;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

function isWide(codePoint) {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** 等寬字型上佔幾格：中文、全形符號佔 2 格，表格才對得齊。 */
function displayWidth(text) {
  let width = 0;
  for (const char of text) width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
  return width;
}

function pad(text, width) {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function formatCell(value) {
  if (value === null || value === undefined) return 'NULL';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  text = text.replace(/\r?\n/g, '↵').replaceAll('`', "'");
  return [...text].length > MAX_CELL_LENGTH ? `${[...text].slice(0, MAX_CELL_LENGTH - 1).join('')}…` : text;
}

/** 文字表格（和 psql 的樣子差不多）：rows 是陣列的陣列。 */
export function formatTable(columns, rows) {
  const header = columns.map((column) => formatCell(column));
  const cells = rows.map((row) => columns.map((_column, i) => formatCell(row[i])));
  const widths = header.map((name, i) => Math.max(displayWidth(name), ...cells.map((line) => displayWidth(line[i]))));
  const render = (values) => ` ${values.map((value, i) => pad(value, widths[i])).join(' | ')}`.trimEnd();
  return [render(header), `-${widths.map((width) => '-'.repeat(width)).join('-+-')}-`, ...cells.map(render)].join('\n');
}

/** 資料庫擋下來的原因，補一句中文。 */
function explainError(err) {
  const code = err?.code;
  const message = String(err?.message ?? err);
  if (code === '25006') return `${message}（這裡是唯讀的，不能修改資料）`;
  if (code === '42501') return `${message}（唯讀帳號沒有這個權限）`;
  if (code === '57014') return `${message}（查詢超過 10 秒，被停止了：縮小範圍再試）`;
  if (code === '42601' && /multiple commands/.test(message)) return `${message}（一次只能執行一個查詢）`;
  if (code === '42P01') return `${message}（找不到這個資料表：確認表名）`;
  return message;
}

function sqlBlock(sql) {
  return ['```sql', sql.replaceAll('```', "'''"), '```'].join('\n');
}

const USAGE = [
  '用法：Issues → New issue → 選「Staging 只讀查詢」，把 SELECT 貼進 SQL 欄（可以多行、可以有 `--` 註解），',
  '寫一句為什麼要查，再送出。要重新執行，編輯這個 Issue 的內容就好。',
].join('');

/**
 * 要留在 Issue 的留言（Markdown）。有 error 就寫沒有執行成功的原因，否則把 result 排成表格。
 * @param {{ sql?: string, purpose?: string, error?: string, at?: Date,
 *   result?: { columns: string[], rows: unknown[][], rowCount: number, command?: string } }} options
 */
export function buildComment({ sql, purpose, result, error, at = new Date() }) {
  const lines = ['### Staging 只讀查詢的結果', '', `- 執行時間：${taipeiTime(at)}（台灣時間）`];
  if (purpose) lines.push(`- 為什麼要查：${purpose.replace(/\s+/g, ' ')}`);
  if (sql) lines.push('', sqlBlock(sql));
  lines.push('');
  if (error) {
    lines.push(`**沒有執行成功**：${error}`, '', USAGE);
  } else if (result.columns.length === 0) {
    lines.push(`執行完成（${result.command ?? '查詢'}），沒有回傳任何欄位。`, '', CONFIRM_LINE);
  } else {
    const shown = result.rows.length;
    lines.push(
      '```text',
      formatTable(result.columns, result.rows),
      '```',
      '',
      result.rowCount > shown ? `共 ${result.rowCount} 列，只顯示前 ${shown} 列（縮小範圍或加上 LIMIT）。` : `共 ${result.rowCount} 列。`,
      '',
      CONFIRM_LINE,
    );
  }
  lines.push('', '<sub>唯讀帳號、唯讀交易，最後一律還原（ROLLBACK）；只能查、不能改。</sub>', '');
  let comment = lines.join('\n');
  if (comment.length > MAX_COMMENT_LENGTH) {
    comment = `${comment.slice(0, MAX_COMMENT_LENGTH)}\n…（太長了，後面省略；請縮小範圍或少選幾個欄位）\n\n${CONFIRM_LINE}\n`;
  }
  return comment;
}

/**
 * 讀 Issue 內文、執行、回傳留言。使用上的錯誤（不是 SELECT、資料表不存在）寫在留言裡，不丟錯。
 * @param {{ issueBody?: string, databaseUrl?: string, now?: () => Date }} options
 */
export async function commentFor({ issueBody, databaseUrl, now = () => new Date() }) {
  const sql = extractSql(issueBody);
  const purpose = extractPurpose(issueBody);
  if (!sql) return buildComment({ purpose, error: '找不到 SQL：表單的 SQL 欄是空的。', at: now() });
  const refusal = checkSelect(sql);
  if (refusal) return buildComment({ sql, purpose, error: refusal, at: now() });
  if (!databaseUrl) {
    return buildComment({
      sql,
      purpose,
      error: '還沒設定 Staging 的唯讀連線（STAGING_READONLY_DATABASE_URL），請找帶組的技術導師。',
      at: now(),
    });
  }
  try {
    const result = await runSelect(databaseUrl, sql);
    return buildComment({ sql, purpose, result, at: now() });
  } catch (err) {
    const error =
      err instanceof ConnectError
        ? '連不上 Staging 的資料庫。等 1 分鐘後編輯一下這個 Issue 的內容重新執行；一直這樣，請找帶組的技術導師。'
        : `資料庫回應：${explainError(err)}`;
    return buildComment({ sql, purpose, error, at: now() });
  }
}

if (isMain(import.meta.url)) {
  const comment = await commentFor({
    issueBody: process.env.ISSUE_BODY,
    databaseUrl: process.env.STAGING_READONLY_DATABASE_URL?.trim(),
  });
  process.stdout.write(comment);
}
