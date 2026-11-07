// API 測試共用的工具。之後的 API 測試一律用這幾個，不要各自重寫：
//
//   const app = createTestApp();                                  // 連測試資料庫 app_test 的後端
//   beforeEach(resetTestDb);                                      // 每個測試前清空資料（Migration 紀錄保留）
//   const manager = await createUser({ name: '測試管理者', role: 'manager' });   // 欄位照 users 表（含你們加的欄位）
//   const token = await loginAs(manager.email);                   // 取得登入 Token
//   await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
//   afterAll(closeTestDb);                                        // 每個測試檔最後關掉資料庫連線
//
// 要測「用帳號密碼登入」時，createUser 帶 password（例如 { password: TEST_PASSWORD }）。
// 測試裡不寫固定的密碼或金鑰：TEST_PASSWORD、TEST_SESSION_SECRET 每次執行都隨機產生。
// 測「找不到這個網址」用 MISSING_API_PATH，不要拿 /api/orders/abc 這種之後真的會做的網址。
//
// 兩個測試資料庫（backend/test/setup.ts 每次重建）：
// - app_test：跑過 backend/db/migrations/ 的全部 Migration。你們自己的測試用它（預設，什麼都不用做）。
// - app_test_template：只跑過模板內建的 000。模板自己的測試在檔案最上面呼叫 useTemplateDatabase(import.meta.url) 改用它，
//   所以你們在 users 加欄位、加限制（例如身分只能是哪幾種、某個欄位必填）、加資料表之後，模板的測試照樣通過。
//   你們自己的測試不要呼叫它（照抄過去會直接報錯）。
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { createSession, publicUser, type SessionKind, type UserRow } from '../src/auth/session.js';
import type { AppEnv, Config } from '../src/config.js';
import { createDb, type Db } from '../src/db.js';
import { setLogSink } from '../src/logger.js';

export const TEST_SESSION_SECRET = crypto.randomBytes(16).toString('hex');
/** 測試帳號的密碼（每次執行都不一樣，12 個字以上）。 */
export const TEST_PASSWORD = `pw-${crypto.randomBytes(9).toString('base64url')}`;

// 測試時不把 Log 印到畫面；要檢查 Log 內容就用 captureLogs()。
setLogSink(() => {});

/**
 * 一定不存在的網址（測「找不到這個網址」用）。專案自己的 API 不要用 __ 開頭的路徑；
 * 拿 /api/orders/abc 這種之後真的會做的網址當例子，做了那個 API 之後測試就會變紅。
 */
export const MISSING_API_PATH = '/api/__missing__/abc';

/** 模板內建、用 app_test_template 的測試檔（你們自己的測試檔不要加進來）。 */
const TEMPLATE_TEST_FILES = new Set([
  'auth.test.ts',
  'frontend-serving.test.ts',
  'health.test.ts',
  'listen.test.ts',
  'migrate.test.ts',
  'query.test.ts',
  'seed.test.ts',
  'staging-select.test.ts',
]);

let sharedDb: Db | undefined;
let templateDatabase = false;

/**
 * 模板自己的測試用：這個測試檔改用 app_test_template（只跑過模板內建的 000）。
 * 在測試檔的最上面呼叫一次：useTemplateDatabase(import.meta.url)。
 * 你們自己的測試不要呼叫（照抄過去會直接報錯）：你們的資料表只在 app_test 裡。
 */
export function useTemplateDatabase(testFileUrl: string): void {
  const file = path.basename(fileURLToPath(testFileUrl));
  if (!TEMPLATE_TEST_FILES.has(file)) {
    throw new Error(
      `useTemplateDatabase() 只給模板內建的測試用，${file} 不要呼叫它：拿掉這一行，照常用 app_test（跑過全部的 Migration）`,
    );
  }
  if (sharedDb) throw new Error('useTemplateDatabase() 要在測試檔的最上面呼叫（第一次用到資料庫之前）');
  templateDatabase = true;
}

/** 這個測試檔用的測試資料庫網址：預設是 app_test；呼叫過 useTemplateDatabase() 是 app_test_template。 */
export function testDatabaseUrl(): string {
  return inject(templateDatabase ? 'templateTestDatabaseUrl' : 'testDatabaseUrl');
}

/** 測試資料庫（預設是 app_test）的連線。 */
export function testDb(): Db {
  sharedDb ??= createDb(testDatabaseUrl());
  return sharedDb;
}

/** 每個測試檔最後呼叫（afterAll）：關掉資料庫連線，也把 useTemplateDatabase() 的切換改回預設的 app_test。 */
export async function closeTestDb(): Promise<void> {
  const db = sharedDb;
  sharedDb = undefined;
  // 測試檔共用這份程式時（Vitest 的 isolate 被關掉），下一個測試檔才不會被帶到 app_test_template
  templateDatabase = false;
  await db?.close();
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    appEnv: 'development',
    databaseUrl: testDatabaseUrl(),
    sessionSecret: TEST_SESSION_SECRET,
    apiBaseUrl: 'http://localhost:4000',
    port: 4000,
    webPort: 3000,
    ...overrides,
  };
}

/** 建一個連測試資料庫的後端，交給 supertest 的 request(app) 用。 */
export function createTestApp(options: { appEnv?: AppEnv; db?: Db; frontendDir?: string } = {}) {
  return createApp({
    config: testConfig({ appEnv: options.appEnv ?? 'development' }),
    db: options.db ?? testDb(),
    frontendDir: options.frontendDir,
  });
}

/** 清空 schema_migrations 以外的所有資料表，編號從 1 重新開始。 */
export async function resetTestDb(): Promise<void> {
  const db = testDb();
  const { rows } = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  if (rows.length === 0) return;
  await db.query(`TRUNCATE ${rows.map((row) => `"${row.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let userCount = 0;

/**
 * 建一個帳號，回傳 users 的整列（不含 password_hash）。
 * - 之後的 Migration 在 users 加了欄位，直接把欄位一起傳進來，例如 { role: 'manager', employee_no: 'E001' }。
 * - 帶 password 就存成雜湊值，可以用 POST /api/auth/login 登入；沒帶就不能用密碼登入（loginAs 照樣可以）。
 * - db：要建在別的資料庫時才給（預設 app_test）。
 */
export async function createUser(
  fields: Record<string, unknown> & { password?: string } = {},
  db: Db = testDb(),
): Promise<UserRow> {
  userCount += 1;
  const { password, ...rest } = fields;
  const row: Record<string, unknown> = {
    name: `測試帳號${userCount}`,
    email: `user${userCount}@test.example`,
    ...rest,
  };
  if (password !== undefined) row.password_hash = await hashPassword(password);
  const columns = Object.keys(row);
  const { rows } = await db.query(
    `INSERT INTO users (${columns.map((column) => `"${column}"`).join(', ')})
     VALUES (${columns.map((_column, i) => `$${i + 1}`).join(', ')})
     RETURNING *`,
    Object.values(row),
  );
  return publicUser(rows[0]!);
}

/** 用這個 Email 的身分登入（不用密碼），回傳 Token（請求帶 Authorization: Bearer <Token>）。 */
export async function loginAs(email: string, kind: SessionKind = 'api', db: Db = testDb()): Promise<string> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) throw new Error(`loginAs：找不到這個 Email 的帳號：${email}`);
  const { token } = await createSession(db, TEST_SESSION_SECRET, user.id, kind);
  return token;
}

/** 收集接下來印出的 Log，用來檢查 Log 的內容。 */
export function captureLogs(): string[] {
  const lines: string[] = [];
  setLogSink((line) => lines.push(line));
  return lines;
}
