// npm run db:query -- "SELECT * FROM users;"：查看資料庫，結果印成表格（最多 200 列）。
//
// 只能查、不能改。三層一起守，任何一層都擋得住：
//   1. 只接受查詢：去掉註解後，開頭要是 SELECT、WITH、TABLE、VALUES、EXPLAIN 或 SHOW，而且一次只能一個。
//      COPY、DO、SET、CALL 這類指令，還沒連資料庫就拒絕。
//   2. 用只能讀的資料庫帳號 app_readonly 執行（第一次執行時自動建立）：
//      只有讀取資料的權限（pg_read_all_data），不是管理員，所以改不了資料，
//      也不能用 COPY … TO PROGRAM 在資料庫的主機上執行指令、讀主機上的檔案，或切換成管理員帳號。
//   3. 在唯讀的交易裡執行（BEGIN READ ONLY），最後一律 ROLLBACK。
// 錯誤訊息照原文印出，例如 relation "orders" does not exist。
// （Staging 的只讀查詢不用這個指令，用 GitHub 的 Issue 表單「Staging 只讀查詢」，見 docs/STAGING.md。）
import pg from 'pg';
import { createDb, passwordOf, withUser, type Db } from '../src/db.js';
import { errorMessage } from '../src/logger.js';
import { CliError, isMainModule, runCli } from './cli.js';

const MAX_ROWS = 200;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** db:query 接受的查詢開頭。 */
export const QUERY_KEYWORDS = ['SELECT', 'WITH', 'TABLE', 'VALUES', 'EXPLAIN', 'SHOW'];

/** 執行查詢用的資料庫帳號：只能讀。 */
export const READONLY_ROLE = 'app_readonly';
const ROLE_LOCK_KEY = 72_010_002; // pg_advisory_xact_lock 的編號（Migration 用 72_010_001）

// ── 第一層：只接受查詢 ──

const IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const DOLLAR_QUOTE_TAG = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;

/** 從開頭的引號找到結束的引號，回傳結束引號的下一個位置；沒有結束就到最後（交給資料庫回報錯誤）。 */
function skipQuoted(sql: string, start: number, quote: string, backslashEscapes: boolean): number {
  let i = start + 1;
  while (i < sql.length) {
    const char = sql[i];
    if (backslashEscapes && char === '\\') i += 2;
    else if (char === quote && sql[i + 1] === quote) i += 2;
    else if (char === quote) return i + 1;
    else i += 1;
  }
  return sql.length;
}

// 把註解換成空白、字串與加了引號的名稱換成空的（'' 與 ""），剩下的就是資料庫真正會執行的指令。
// 規則和 PostgreSQL 一樣：-- 到換行（\n 或 \r）是註解；/* … */ 可以一層包一層，要全部關上才結束
// （所以「/* /* */ SELECT 1 */ COPY …」真正執行的是 COPY）；E'…' 裡的反斜線會跳脫引號；
// $$…$$、$標籤$…$標籤$ 也是字串。
export function maskSql(sql: string): string {
  let masked = '';
  let i = 0;
  while (i < sql.length) {
    const char = sql[i]!;
    const pair = sql.slice(i, i + 2);
    if (pair === '--') {
      // 換行（\n 或 \r）就結束，和資料庫的判斷一樣
      const end = sql.slice(i).search(/[\n\r]/);
      i = end === -1 ? sql.length : i + end;
      masked += ' ';
    } else if (pair === '/*') {
      let depth = 0;
      do {
        const two = sql.slice(i, i + 2);
        if (two === '/*') {
          depth += 1;
          i += 2;
        } else if (two === '*/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      } while (depth > 0 && i < sql.length);
      masked += ' ';
    } else if (char === "'") {
      const prefix = sql[i - 1] ?? '';
      const backslashEscapes = (prefix === 'E' || prefix === 'e') && !IDENTIFIER_CHAR.test(sql[i - 2] ?? '');
      i = skipQuoted(sql, i, "'", backslashEscapes);
      masked += "''";
    } else if (char === '"') {
      i = skipQuoted(sql, i, '"', false);
      masked += '""';
    } else if (char === '$' && !IDENTIFIER_CHAR.test(sql[i - 1] ?? '') && DOLLAR_QUOTE_TAG.test(sql.slice(i))) {
      const tag = DOLLAR_QUOTE_TAG.exec(sql.slice(i))![0];
      const end = sql.indexOf(tag, i + tag.length);
      i = end === -1 ? sql.length : end + tag.length;
      masked += "''";
    } else {
      masked += char;
      i += 1;
    }
  }
  return masked;
}

/** 檢查是不是 db:query 接受的查詢：接受就回 undefined，不接受就回原因。 */
export function checkQuery(sql: string): string | undefined {
  const statements = maskSql(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
  if (statements.length === 0) return '沒有要執行的查詢（只有註解或空白）';
  if (statements.length > 1) return '一次只能執行一個查詢（分號後面還有別的指令）';
  const keyword = /^[\s(]*([A-Za-z_][A-Za-z0-9_$]*)/.exec(statements[0]!)?.[1]?.toUpperCase();
  if (keyword && QUERY_KEYWORDS.includes(keyword)) return undefined;
  const found = keyword ? `這個指令的開頭是 ${keyword}` : '看不出這個指令的開頭';
  return `db:query 只能查、不能改，只接受 ${QUERY_KEYWORDS.join('、')} 開頭的查詢（${found}）`;
}

// ── 第二、三層：只能讀的帳號、唯讀的交易 ──

/** 連線的帳號設定被別的連線同時改到時，資料庫回的錯誤代碼：等一下再試一次就好。 */
const RETRYABLE_ROLE_ERRORS = new Set([
  'XX000', // tuple concurrently updated：兩個資料庫（例如 app 與 app_test）同時改同一個帳號
  '23505', // 同時建立同一個帳號（unique violation）
  '42710', // 同時建立同一個帳號（role already exists）
  '40001',
  '40P01',
]);
const ROLE_SETUP_ATTEMPTS = 6;

function errorCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
}

/** 帳號已經是該有的樣子：可以登入、不是管理員、預設唯讀、只有讀取資料的權限。只讀系統表，不改任何東西。 */
async function readOnlyRoleIsReady(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ ready: boolean }>(
    `SELECT r.rolcanlogin
            AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
            AND NOT r.rolreplication AND NOT r.rolbypassrls
            AND EXISTS (
              SELECT 1 FROM pg_db_role_setting s
               WHERE s.setrole = r.oid AND s.setdatabase = 0
                 AND 'default_transaction_read_only=on' = ANY (s.setconfig))
            AND ARRAY(
              SELECT g.rolname::text FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
               WHERE m.member = r.oid ORDER BY 1) = ARRAY['pg_read_all_data'] AS ready
       FROM pg_roles r
      WHERE r.rolname = $1`,
    [READONLY_ROLE],
  );
  return rows[0]?.ready === true;
}

/** 用這個網址登入得了嗎（密碼對不對）。 */
async function canLogIn(readOnlyUrl: string): Promise<boolean> {
  const db = createDb(readOnlyUrl);
  try {
    await db.query('SELECT 1');
    return true;
  } catch (err) {
    if (errorCode(err) === '28P01' || errorCode(err) === '28000') return false;
    throw err;
  } finally {
    await db.close();
  }
}

/** 建立或修正 app_readonly 的設定。 */
async function configureReadOnlyRole(db: Db, password: string): Promise<void> {
  const role = pg.escapeIdentifier(READONLY_ROLE);
  await db.tx(async (client) => {
    // 同一個資料庫同時執行好幾次 db:query 時排隊。這個鎖只管同一個資料庫，
    // 不同資料庫同時改到這個帳號（tuple concurrently updated），由 prepareReadOnlyRole 重試。
    await client.query('SELECT pg_advisory_xact_lock($1)', [ROLE_LOCK_KEY]);
    const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [READONLY_ROLE]);
    if (existing.rowCount === 0) await client.query(`CREATE ROLE ${role}`);
    await client.query(
      `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(password)}`,
    );
    await client.query(`ALTER ROLE ${role} SET default_transaction_read_only = on`);
    await client.query(`GRANT pg_read_all_data TO ${role}`);
  });
}

/**
 * 準備只能讀的帳號 app_readonly，回傳用它連線的網址。
 * - 只有讀取資料的權限（pg_read_all_data）：不是管理員，不能建立帳號或資料庫，也不能執行主機上的程式。
 * - 預設就是唯讀模式（default_transaction_read_only）。
 * - 密碼和 DATABASE_URL 的帳號相同：不用多保管一組密碼，拿到它的人也不會比原本的帳號多任何權限。
 * 已經準備好（設定正確、密碼登入得了）就不改任何東西，所以同時執行好幾次也不會互相干擾；
 * 第一次建立或設定不對時才修正。帳號是整台資料庫主機共用的，npm test（app_test）與
 * npm run db:query（app）同時修正時，資料庫可能回 tuple concurrently updated，稍等重試。
 */
export async function prepareReadOnlyRole(db: Db, databaseUrl: string): Promise<string> {
  const password = passwordOf(databaseUrl);
  const readOnlyUrl = withUser(databaseUrl, READONLY_ROLE);

  if ((await readOnlyRoleIsReady(db)) && (await canLogIn(readOnlyUrl))) return readOnlyUrl;

  for (let attempt = 1; ; attempt += 1) {
    try {
      await configureReadOnlyRole(db, password);
      return readOnlyUrl;
    } catch (err) {
      if (attempt >= ROLE_SETUP_ATTEMPTS || !RETRYABLE_ROLE_ERRORS.has(String(errorCode(err)))) throw err;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 75));
    }
  }
}

/** 用只能讀的帳號連線，在唯讀的交易裡執行一個查詢，最後一律 ROLLBACK。資料庫的錯誤照原樣往外丟。 */
export async function runReadOnly(readOnlyUrl: string, sql: string): Promise<pg.QueryResult> {
  const db = createDb(readOnlyUrl);
  try {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      // queryMode: extended 一次只接受一個查詢，擋掉「COMMIT; DELETE …」這種跳出唯讀交易的寫法
      // （pg 支援這個選項，但型別定義還沒有，所以另外宣告）
      const singleStatement: pg.QueryConfig & { queryMode: 'extended' } = { text: sql, queryMode: 'extended' };
      return await client.query(singleStatement);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  } finally {
    await db.close();
  }
}

/** 資料庫擋下來的原因，用中文補在原文後面。 */
function explainRefusal(err: unknown): unknown {
  const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
  const message = errorMessage(err);
  if (code === '25006') return new CliError(`錯誤：${message}（db:query 只能查、不能改）`);
  if (code === '42501') {
    return new CliError(`錯誤：${message}（db:query 用只能讀的帳號 ${READONLY_ROLE} 執行，沒有這個權限）`);
  }
  if (message.includes('cannot insert multiple commands')) {
    return new CliError(`錯誤：${message}（一次只能執行一個查詢）`);
  }
  return err;
}

// ── 印成表格 ──

function isWide(codePoint: number): boolean {
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

/** 終端機上佔幾格：中文、全形符號佔 2 格，表格才對得齊。 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
  return width;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) {
    return new Date(value.getTime() + TAIPEI_OFFSET_MS).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+08');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/\r?\n/g, '↵');
}

export function formatTable(columns: string[], rows: Record<string, unknown>[]): string[] {
  const cells = rows.map((row) => columns.map((column) => formatCell(row[column])));
  const widths = columns.map((column, i) => Math.max(displayWidth(column), ...cells.map((line) => displayWidth(line[i]!))));
  const render = (values: string[]) => ` ${values.map((value, i) => pad(value, widths[i]!)).join(' | ')}`.trimEnd();
  return [render(columns), `-${widths.map((width) => '-'.repeat(width)).join('-+-')}-`, ...cells.map(render)];
}

function printResult(result: pg.QueryResult): void {
  if (result.fields.length === 0) {
    console.log(`${result.command} 完成`);
    return;
  }
  const columns = result.fields.map((field) => field.name);
  for (const line of formatTable(columns, result.rows.slice(0, MAX_ROWS))) console.log(line);
  console.log(
    result.rows.length > MAX_ROWS
      ? `（共 ${result.rows.length} 列，只顯示前 ${MAX_ROWS} 列）`
      : `（${result.rows.length} 列）`,
  );
}

if (isMainModule(import.meta.url)) {
  const sql = process.argv.slice(2).join(' ').trim();
  const refusal = sql ? checkQuery(sql) : undefined;
  if (!sql) {
    console.log('用法：npm run db:query -- "SELECT * FROM users;"');
    process.exitCode = 1;
  } else if (refusal) {
    console.log(`[query] 已拒絕：${refusal}`);
    process.exitCode = 1;
  } else {
    await runCli('[query]', async (db, databaseUrl) => {
      const readOnlyUrl = await prepareReadOnlyRole(db, databaseUrl);
      let result: pg.QueryResult;
      try {
        result = await runReadOnly(readOnlyUrl, sql);
      } catch (err) {
        throw explainRefusal(err);
      }
      printResult(result);
    });
  }
}
