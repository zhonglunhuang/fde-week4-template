// 「Staging 只讀查詢」的腳本（backend/scripts/staging-select.mjs）：Issue 表單 → SQL → 唯讀執行 → 留言。
// 用本機的測試資料庫代替 Staging：唯讀帳號用 db:query 的 app_readonly（權限和技術導師建的 staging_reader 一樣只能讀）。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareReadOnlyRole } from '../db/query.js';
import {
  buildComment,
  checkSelect,
  commentFor,
  CONFIRM_LINE,
  extractPurpose,
  extractSql,
  formatTable,
  runSelect,
} from '../scripts/staging-select.mjs';
import { REPO_ROOT } from '../src/config.js';
import { closeTestDb, createUser, resetTestDb, testDatabaseUrl, testDb, useTemplateDatabase } from './helpers.js';

// 模板內建的測試，用只跑過模板 Migration（000）的資料庫：你們加的 Migration 不會讓它變紅。你們自己的測試不要照抄這一行
useTemplateDatabase(import.meta.url);
beforeEach(resetTestDb);
afterAll(closeTestDb);

const SCRIPT = path.join(REPO_ROOT, 'backend', 'scripts', 'staging-select.mjs');

/** GitHub 的 Issue 表單送出後的內文（render: sql 的欄位會包在 ```sql 區塊裡）。 */
function issueBody(sql: string, purpose = '確認某一天有幾筆資料', newline = '\n'): string {
  return [
    '### SQL（只能查詢，可以多行，可以有 -- 註解）',
    '',
    '```sql',
    sql,
    '```',
    '',
    '### 為什麼要查',
    '',
    purpose,
  ].join(newline);
}

const DAY_CHECK = `SELECT id, name, created_at::date AS day
FROM users
WHERE created_at >= '2000-01-01'   -- 換成要查的日期
ORDER BY id;`;

let readOnlyUrl: string;
beforeAll(async () => {
  readOnlyUrl = await prepareReadOnlyRole(testDb(), testDatabaseUrl());
});

async function userCount(): Promise<number> {
  const { rows } = await testDb().query<{ count: string }>('SELECT count(*) FROM users');
  return Number(rows[0]!.count);
}

/** 照 workflow 的方式執行腳本（環境變數帶 Issue 內文與連線），回傳印出的留言。 */
function runScript(env: Record<string, string | undefined>): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, code }));
  });
}

describe('讀 Issue 表單', () => {
  it('取出第一個 sql 區塊（多行、有 -- 註解）與「為什麼要查」；Windows 的換行也可以', () => {
    for (const newline of ['\n', '\r\n']) {
      const body = issueBody(DAY_CHECK.replaceAll('\n', newline), '確認某一天有幾筆資料', newline);
      expect(extractSql(body)?.replaceAll('\r\n', '\n')).toBe(DAY_CHECK);
      expect(extractPurpose(body)).toBe('確認某一天有幾筆資料');
    }
  });

  it('SQL 欄是空的（_No response_）或沒有 sql 區塊：當成沒有 SQL', () => {
    expect(extractSql(issueBody('_No response_'))).toBeUndefined();
    expect(extractSql('隨便寫的 Issue')).toBeUndefined();
    expect(extractPurpose('隨便寫的 Issue')).toBeUndefined();
  });
});

describe('第一層：只接受 SELECT、WITH、EXPLAIN 開頭（還沒連資料庫就先檢查）', () => {
  it.each([
    'SELECT 1',
    'select * from users',
    '-- 先寫一行說明\nSELECT 1',
    '/* 說明 /* 包一層 */ */ WITH t AS (SELECT 1) SELECT * FROM t',
    '(SELECT 1) UNION (SELECT 2)',
    'EXPLAIN SELECT * FROM users',
  ])('接受：%s', (sql) => {
    expect(checkSelect(sql)).toBeUndefined();
  });

  it.each([
    ['DELETE FROM users', 'DELETE'],
    ['UPDATE users SET name = 1', 'UPDATE'],
    ['-- SELECT\nDROP TABLE users', 'DROP'],
    ['/* SELECT */ TRUNCATE users', 'TRUNCATE'],
    ["COPY (SELECT 1) TO PROGRAM 'id'", 'COPY'],
    ['SET ROLE app', 'SET'],
  ])('拒絕：%s', (sql, keyword) => {
    expect(checkSelect(sql)).toBe(
      `這裡只能查詢：SQL 要以 SELECT、WITH 或 EXPLAIN 開頭（這次的開頭是 ${keyword}）。要修改資料，請找帶組的技術導師`,
    );
  });

  it('只有註解：沒有要執行的查詢', () => {
    expect(checkSelect('-- 只有註解\n/* 還有這個 */')).toBe('沒有要執行的查詢（只有註解或空白）');
  });
});

describe('第二、三層：唯讀帳號、唯讀交易（就算繞過第一層也改不了）', () => {
  async function refusedCode(url: string, sql: string): Promise<string | undefined> {
    try {
      await runSelect(url, sql);
    } catch (err) {
      return (err as { code?: string }).code;
    }
    throw new Error(`資料庫沒有擋下：${sql}`);
  }

  it('查得到資料：欄位、列數；時間是台灣時間的文字', async () => {
    await createUser({ name: '測試管理者', email: 'manager@test.example' });
    const result = await runSelect(readOnlyUrl, "SELECT id, name, '2026-11-20 03:18:30+00'::timestamptz AS at, current_user AS who FROM users");
    expect(result.columns).toEqual(['id', 'name', 'at', 'who']);
    expect(result.rows).toEqual([[1, '測試管理者', '2026-11-20 11:18:30+08', 'app_readonly']]);
    expect(result.rowCount).toBe(1);
  });

  it('查詢裡夾帶修改、一次送兩個指令：被擋下，資料不變', async () => {
    await createUser({ email: 'manager@test.example' });
    expect(await refusedCode(readOnlyUrl, 'WITH gone AS (DELETE FROM users RETURNING 1) SELECT count(*) FROM gone')).toBe('25006');
    expect(await refusedCode(readOnlyUrl, 'SELECT 1; DELETE FROM users')).toBe('42601');
    expect(await refusedCode(readOnlyUrl, 'EXPLAIN ANALYZE DELETE FROM users')).toBe('25006');
    expect(await userCount()).toBe(1);
  });

  it('就算用有寫入權限的帳號，唯讀交易一樣擋下修改', async () => {
    await createUser({ email: 'manager@test.example' });
    expect(await refusedCode(testDatabaseUrl(), 'WITH gone AS (DELETE FROM users RETURNING 1) SELECT count(*) FROM gone')).toBe('25006');
    expect(await userCount()).toBe(1);
  });

  it('查太久：超過 statement_timeout 就停止（57014）', async () => {
    await expect(runSelect(readOnlyUrl, 'SELECT pg_sleep(2)', { statementTimeout: '200ms' })).rejects.toMatchObject({
      code: '57014',
    });
  });

  it('最多只留 200 列，總列數照實回報', async () => {
    const result = await runSelect(readOnlyUrl, 'SELECT n FROM generate_series(1, 250) AS n');
    expect(result.rows).toHaveLength(200);
    expect(result.rowCount).toBe(250);
  });
});

describe('留言的內容', () => {
  it('文字表格：中文佔兩格，欄位對得齊；NULL 與換行看得出來', () => {
    expect(formatTable(['id', 'name', 'note'], [[1, '測試客人甲', null], [12, 'ab', '第一行\n第二行']]).split('\n')).toEqual([
      ' id | name       | note',
      '----+------------+---------------',
      ' 1  | 測試客人甲 | NULL',
      ' 12 | ab         | 第一行↵第二行',
    ]);
  });

  it('有結果：SQL、表格、列數、請第二位組員確認', () => {
    const comment = buildComment({
      sql: 'SELECT 1 AS n',
      purpose: '確認範圍',
      result: { columns: ['n'], rows: [[1]], rowCount: 1, command: 'SELECT' },
      at: new Date('2026-11-20T03:18:30Z'),
    });
    expect(comment).toContain('- 執行時間：2026-11-20 11:18:30（台灣時間）');
    expect(comment).toContain('- 為什麼要查：確認範圍');
    expect(comment).toContain('```sql\nSELECT 1 AS n\n```');
    expect(comment).toContain('```text\n n\n---\n 1\n```');
    expect(comment).toContain('共 1 列。');
    expect(comment).toContain(CONFIRM_LINE);
  });

  it('連不上資料庫：只說連不上，不露出主機、帳號或密碼', async () => {
    const comment = await commentFor({
      issueBody: issueBody('SELECT 1'),
      databaseUrl: 'postgres://127.0.0.1:1/neondb?user=staging_reader&password=never-shown-1234',
    });
    expect(comment).toContain('連不上 Staging 的資料庫');
    expect(comment).not.toMatch(/127\.0\.0\.1|staging_reader|never-shown|ECONNREFUSED/);
  });
});

describe('照 workflow 的方式執行（node backend/scripts/staging-select.mjs）', () => {
  it('Issue 內文的查詢：留言有表格與列數', async () => {
    await createUser({ name: '測試管理者', email: 'manager@test.example' });
    const { stdout, code } = await runScript({ ISSUE_BODY: issueBody(DAY_CHECK), STAGING_READONLY_DATABASE_URL: readOnlyUrl });
    expect(code).toBe(0);
    expect(stdout).toContain('### Staging 只讀查詢的結果');
    expect(stdout).toMatch(/ id \| name\s+\| day/);
    expect(stdout).toContain('測試管理者');
    expect(stdout).toContain('共 1 列。');
    expect(stdout).toContain(CONFIRM_LINE);
  });

  it('不是查詢：留言說明只能查詢，資料不變', async () => {
    await createUser({ email: 'manager@test.example' });
    const { stdout, code } = await runScript({ ISSUE_BODY: issueBody('DELETE FROM users'), STAGING_READONLY_DATABASE_URL: readOnlyUrl });
    expect(code).toBe(0);
    expect(stdout).toContain('**沒有執行成功**：這裡只能查詢');
    expect(await userCount()).toBe(1);
  });

  it('資料表不存在：只留 PostgreSQL 的那一句', async () => {
    const { stdout } = await runScript({
      ISSUE_BODY: issueBody('SELECT * FROM no_such_table'),
      STAGING_READONLY_DATABASE_URL: readOnlyUrl,
    });
    expect(stdout).toContain('資料庫回應：relation "no_such_table" does not exist（找不到這個資料表：確認表名）');
    expect(stdout).not.toContain('app_readonly');
  });

  it('還沒設定唯讀連線：留言請他找技術導師', async () => {
    const { stdout, code } = await runScript({ ISSUE_BODY: issueBody('SELECT 1') });
    expect(code).toBe(0);
    expect(stdout).toContain('還沒設定 Staging 的唯讀連線（STAGING_READONLY_DATABASE_URL），請找帶組的技術導師');
  });
});
