import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkQuery, prepareReadOnlyRole, READONLY_ROLE, runReadOnly } from '../db/query.js';
import { REPO_ROOT } from '../src/config.js';
import { createDb, withDatabaseName, type Db } from '../src/db.js';
import { closeTestDb, createUser, resetTestDb, testDatabaseUrl, testDb, useTemplateDatabase } from './helpers.js';

// 模板內建的測試，用只跑過模板 Migration（000）的資料庫：你們加的 Migration 不會讓它變紅。你們自己的測試不要照抄這一行
useTemplateDatabase(import.meta.url);
beforeEach(resetTestDb);
afterAll(closeTestDb);

const QUERY_SCRIPT = path.join(REPO_ROOT, 'backend', 'db', 'query.ts');
const UNREACHABLE_DATABASE_URL = 'postgres://127.0.0.1:1/app';

/** 照學員的用法執行 db:query（等於 npm run db:query -- "…"），回傳印出的內容與結束代碼。 */
function dbQuery(sql: string, databaseUrl: string = testDatabaseUrl()): { output: string; status: number | null } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', QUERY_SCRIPT, sql], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

async function userCount(): Promise<number> {
  const { rows } = await testDb().query<{ count: string }>('SELECT count(*) FROM users');
  return Number(rows[0]!.count);
}

const COPY_TO_PROGRAM = "COPY (SELECT 1) TO PROGRAM 'cat > /dev/null'";
const DO_COPY_TO_PROGRAM = "DO $$ BEGIN EXECUTE 'COPY (SELECT 1) TO PROGRAM ''cat > /dev/null'''; END $$";

describe('第一層：db:query 只接受查詢（還沒連資料庫就先檢查）', () => {
  it.each([
    'SELECT * FROM users;',
    "select id, name from users where email = 'a;b@test.example'",
    '-- 先寫一行說明\nSELECT 1',
    '/* 說明 */ WITH t AS (SELECT 1 AS n) SELECT * FROM t',
    '(SELECT 1) UNION (SELECT 2)',
    'TABLE users',
    'VALUES (1), (2)',
    'EXPLAIN SELECT * FROM users',
    'SHOW search_path',
    'SELECT $$字串裡的;分號$$, E\'\\\';\'',
  ])('接受：%s', (sql) => {
    expect(checkQuery(sql)).toBeUndefined();
  });

  it.each([
    [COPY_TO_PROGRAM, 'COPY'],
    [DO_COPY_TO_PROGRAM, 'DO'],
    ['/* SELECT */ DELETE FROM users', 'DELETE'],
    ['-- SELECT\nDELETE FROM users', 'DELETE'],
    // 註解可以一層包一層：資料庫看到的是 COPY，不是 SELECT
    ["/* /* */ SELECT 1 */ COPY (SELECT 1) TO PROGRAM 'cat > /dev/null'", 'COPY'],
    // -- 的註解遇到 \r 就結束：資料庫看到的是 COPY … WITH (FORMAT csv)，不是 WITH 開頭的查詢
    ["-- 說明\rCOPY (SELECT 1) TO PROGRAM 'cat > /dev/null'\nWITH (FORMAT csv)", 'COPY'],
    ['SET ROLE app', 'SET'],
    ['CALL do_something()', 'CALL'],
  ])('拒絕不是查詢的指令：%s', (sql, keyword) => {
    expect(checkQuery(sql)).toBe(
      `db:query 只能查、不能改，只接受 SELECT、WITH、TABLE、VALUES、EXPLAIN、SHOW 開頭的查詢（這個指令的開頭是 ${keyword}）`,
    );
  });

  it('一次只能一個查詢；只有註解也不行', () => {
    expect(checkQuery('SELECT 1; DELETE FROM users')).toBe('一次只能執行一個查詢（分號後面還有別的指令）');
    expect(checkQuery('-- 只有註解')).toBe('沒有要執行的查詢（只有註解或空白）');
  });
});

describe('第二、三層：用只能讀的帳號、在唯讀交易裡執行（就算繞過第一層也改不了）', () => {
  let readOnlyUrl: string;
  beforeAll(async () => {
    readOnlyUrl = await prepareReadOnlyRole(testDb(), testDatabaseUrl());
  });

  /** 直接交給資料庫執行（不經過第一層的檢查），回傳資料庫的錯誤代碼。 */
  async function refusedCode(sql: string): Promise<string | undefined> {
    try {
      await runReadOnly(readOnlyUrl, sql);
    } catch (err) {
      return (err as { code?: string }).code;
    }
    throw new Error(`資料庫沒有擋下：${sql}`);
  }

  it(`連線的帳號是 ${READONLY_ROLE}，不是管理員`, async () => {
    const result = await runReadOnly(
      readOnlyUrl,
      'SELECT current_user AS who, rolsuper FROM pg_roles WHERE rolname = current_user',
    );
    expect(result.rows).toEqual([{ who: READONLY_ROLE, rolsuper: false }]);
  });

  it('COPY … TO PROGRAM：沒有權限（42501），資料庫主機上不會執行任何程式', async () => {
    expect(await refusedCode(COPY_TO_PROGRAM)).toBe('42501');
  });

  it('DO 區塊：裡面的 COPY … TO PROGRAM 一樣沒有權限，改資料被唯讀交易擋下', async () => {
    await createUser({ name: '陳志明', email: 'chen@test.example' });
    expect(await refusedCode(DO_COPY_TO_PROGRAM)).toBe('42501');
    expect(await refusedCode('DO $$ BEGIN DELETE FROM users; END $$')).toBe('25006');
    expect(await userCount()).toBe(1);
  });

  it('查詢裡夾帶修改：被唯讀交易擋下，資料不變', async () => {
    await createUser({ name: '陳志明', email: 'chen@test.example' });
    expect(await refusedCode('WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone')).toBe('25006');
    expect(await userCount()).toBe(1);
  });

  it('就算關掉唯讀模式，這個帳號也沒有寫入的權限', async () => {
    await createUser({ name: '陳志明', email: 'chen@test.example' });
    const readOnlyDb = createDb(readOnlyUrl);
    const client = await readOnlyDb.pool.connect();
    try {
      await client.query('SET default_transaction_read_only = off');
      await expect(client.query('DELETE FROM users')).rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release();
      await readOnlyDb.close();
    }
    expect(await userCount()).toBe(1);
  });

  it('不能切換成管理員帳號，也不能讀資料庫主機上的檔案', async () => {
    const url = new URL(testDatabaseUrl());
    const admin = url.searchParams.get('user') ?? url.username;
    expect(await refusedCode(`SELECT set_config('role', '${admin}', false)`)).toBe('42501');
    expect(await refusedCode("SELECT pg_read_file('/etc/hostname')")).toBe('42501');
  });
});

describe('兩個資料庫同時準備只能讀的帳號（例如 npm test 與 npm run db:query 一起跑）', () => {
  // 帳號是整台資料庫主機共用的；排隊用的鎖只管同一個資料庫，所以另外開一個資料庫來模擬 app 與 app_test
  const OTHER_DATABASE = 'app_test_query';
  let other: Db;

  beforeAll(async () => {
    await testDb().query(`DROP DATABASE IF EXISTS ${OTHER_DATABASE} WITH (FORCE)`);
    await testDb().query(`CREATE DATABASE ${OTHER_DATABASE}`);
    other = createDb(withDatabaseName(testDatabaseUrl(), OTHER_DATABASE));
  });

  afterAll(async () => {
    await other?.close();
    await testDb().query(`DROP DATABASE IF EXISTS ${OTHER_DATABASE} WITH (FORCE)`);
  });

  it('帳號要重新設定時，同時執行也全部成功，最後設定正確', async () => {
    const baseUrl = testDatabaseUrl();
    const otherUrl = withDatabaseName(baseUrl, OTHER_DATABASE);
    // 讓帳號變成「要重新設定」的狀態，每一次呼叫都會去改帳號
    await testDb().query(`ALTER ROLE ${READONLY_ROLE} NOLOGIN`);
    const runs = Array.from({ length: 12 }, (_value, i) =>
      i % 2 === 0 ? prepareReadOnlyRole(testDb(), baseUrl) : prepareReadOnlyRole(other, otherUrl),
    );
    const results = await Promise.allSettled(runs);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);

    const readOnlyUrl = await prepareReadOnlyRole(testDb(), baseUrl);
    const result = await runReadOnly(readOnlyUrl, 'SELECT current_user AS who');
    expect(result.rows).toEqual([{ who: READONLY_ROLE }]);
  });
});

describe('npm run db:query', () => {
  it('查得到資料，印成表格與列數', async () => {
    await createUser({ name: '陳志明', email: 'chen@test.example' });
    const { output, status } = dbQuery('SELECT id, name FROM users ORDER BY id;');
    expect(status).toBe(0);
    expect(output.split('\n')).toEqual([' id | name', '----+--------', ' 1  | 陳志明', '（1 列）', '']);
  });

  it.each([
    ['COPY … TO PROGRAM', COPY_TO_PROGRAM, 'COPY'],
    ['DO 區塊', DO_COPY_TO_PROGRAM, 'DO'],
  ])('%s：還沒連資料庫就拒絕，結束代碼 1', (_name, sql, keyword) => {
    // 故意給連不上的資料庫：有連線的話會印 ECONNREFUSED
    const { output, status } = dbQuery(sql, UNREACHABLE_DATABASE_URL);
    expect(status).toBe(1);
    expect(output).toBe(
      `[query] 已拒絕：db:query 只能查、不能改，只接受 SELECT、WITH、TABLE、VALUES、EXPLAIN、SHOW 開頭的查詢（這個指令的開頭是 ${keyword}）\n`,
    );
  });

  it('夾帶修改的查詢：印出資料庫的原文與說明，資料不變', async () => {
    await createUser({ name: '陳志明', email: 'chen@test.example' });
    const { output, status } = dbQuery('WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone');
    expect(status).toBe(1);
    expect(output).toBe('[query] 錯誤：cannot execute SELECT in a read-only transaction（db:query 只能查、不能改）\n');
    expect(await userCount()).toBe(1);
  });

  it(`用只能讀的帳號 ${READONLY_ROLE} 執行，不是 DATABASE_URL 的帳號`, () => {
    const { output, status } = dbQuery('SELECT current_user;');
    expect(status).toBe(0);
    expect(output.split('\n')).toEqual([' current_user', '-'.repeat(READONLY_ROLE.length + 2), ` ${READONLY_ROLE}`, '（1 列）', '']);
  });

  it('資料表不存在：錯誤原文照印', () => {
    // 用一定不會建立的表名：orders 這類表 T1 會建立，用它的話 T1 一做完這個測試就會變紅
    const { output, status } = dbQuery('SELECT * FROM no_such_table;');
    expect(status).toBe(1);
    expect(output).toContain('relation "no_such_table" does not exist');
  });
});
