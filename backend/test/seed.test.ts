import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSeedPassword, seed } from '../db/seed.js';
import { closeTestDb, createTestApp, createUser, resetTestDb, testDb, TEST_PASSWORD, useTemplateDatabase } from './helpers.js';

// 模板內建的測試，用只跑過模板 Migration（000）的資料庫：你們加的 Migration 不會讓它變紅。你們自己的測試不要照抄這一行
useTemplateDatabase(import.meta.url);
beforeEach(resetTestDb);
// 種子檔範例會建一個暫時的資料表，每個測試結束就刪掉
afterEach(async () => {
  await testDb().query('DROP TABLE IF EXISTS seed_pickups');
});
afterAll(closeTestDb);

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function seedDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-seeds-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

// 和 backend/db/seeds/README.md 的寫法一樣：密碼用 current_setting('app.seed_password_hash')，日期用台灣的今天加幾天
const users = {
  '01_users.sql': `INSERT INTO users (email, name, role, password_hash) VALUES
    ('manager@test.example', '測試管理者', 'manager', current_setting('app.seed_password_hash')),
    ('clerk@test.example', '測試門市甲', 'clerk', current_setting('app.seed_password_hash'))
    ON CONFLICT (email) DO NOTHING;`,
  '02_pickups.sql': `CREATE TABLE IF NOT EXISTS seed_pickups (label TEXT PRIMARY KEY, pickup_date DATE NOT NULL);
    INSERT INTO seed_pickups VALUES ('明天', (now() AT TIME ZONE 'Asia/Taipei')::date + 1)
    ON CONFLICT (label) DO NOTHING;`,
};

async function userCount(): Promise<number> {
  const { rows } = await testDb().query<{ count: string }>('SELECT count(*) FROM users');
  return Number(rows[0]!.count);
}

describe('npm run db:seed', () => {
  it('沒有種子檔：印出提示，不改資料，也不需要 SEED_USER_PASSWORD', async () => {
    const lines: string[] = [];
    const result = await seed(testDb(), { dir: seedDir({}), print: (line) => lines.push(line) });
    expect(result.skipped).toBe('no_files');
    expect(lines).toEqual(['[seed] 沒有種子資料檔（backend/db/seeds/*.sql，T1 會建立）']);
  });

  it('有種子檔、沒有設定 SEED_USER_PASSWORD：拒絕執行，說明要怎麼設定，什麼都沒放', async () => {
    await expect(seed(testDb(), { dir: seedDir(users), print: () => {} })).rejects.toThrow(
      '缺少 SEED_USER_PASSWORD：種子資料的測試帳號用它當密碼。請在 .env 加上 SEED_USER_PASSWORD=',
    );
    await expect(seed(testDb(), { dir: seedDir(users), password: 'short', print: () => {} })).rejects.toThrow(
      'SEED_USER_PASSWORD 至少要 10 個字（現在是 5 個字）',
    );
    expect(await userCount()).toBe(0);
  });

  it('SEED_USER_PASSWORD 從環境變數讀，空白當成沒有設定', () => {
    expect(readSeedPassword({ SEED_USER_PASSWORD: '  ' })).toBeUndefined();
    expect(readSeedPassword({})).toBeUndefined();
    expect(readSeedPassword({ SEED_USER_PASSWORD: ` ${TEST_PASSWORD} ` })).toBe(TEST_PASSWORD);
  });

  it('種子資料的帳號用 SEED_USER_PASSWORD 登入得了；檔案與資料庫都沒有密碼本身', async () => {
    const lines: string[] = [];
    await seed(testDb(), { dir: seedDir(users), password: TEST_PASSWORD, print: (line) => lines.push(line) });
    expect(lines).toEqual(['[seed] 01_users……完成', '[seed] 02_pickups……完成']);

    const app = createTestApp();
    for (const email of ['manager@test.example', 'clerk@test.example']) {
      const res = await request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
      expect(res.status, email).toBe(200);
    }
    const { rows } = await testDb().query<{ password_hash: string }>('SELECT password_hash FROM users');
    for (const row of rows) {
      expect(row.password_hash).toMatch(/^scrypt\$/);
      expect(row.password_hash).not.toContain(TEST_PASSWORD);
    }
    expect(JSON.stringify(users)).not.toContain(TEST_PASSWORD);
  });

  it('日期用台灣的今天加幾天算', async () => {
    await seed(testDb(), { dir: seedDir(users), password: TEST_PASSWORD, print: () => {} });
    const { rows } = await testDb().query(
      `SELECT pickup_date = (now() AT TIME ZONE 'Asia/Taipei')::date + 1 AS tomorrow FROM seed_pickups`,
    );
    expect(rows).toEqual([{ tomorrow: true }]);
  });

  it('重跑不會多出重複的資料，也不會把改過的密碼改回去', async () => {
    const dir = seedDir(users);
    await seed(testDb(), { dir, password: TEST_PASSWORD, print: () => {} });
    await testDb().query("UPDATE users SET password_hash = 'changed' WHERE email = 'clerk@test.example'");
    await seed(testDb(), { dir, password: TEST_PASSWORD, print: () => {} });
    expect(await userCount()).toBe(2);
    const { rows } = await testDb().query("SELECT password_hash FROM users WHERE email = 'clerk@test.example'");
    expect(rows[0].password_hash).toBe('changed');
  });

  it('--if-empty：還沒有任何帳號才放入；已經有帳號就略過', async () => {
    const lines: string[] = [];
    const first = await seed(testDb(), { dir: seedDir(users), ifEmpty: true, password: TEST_PASSWORD, print: () => {} });
    expect(first.files).toEqual(['01_users', '02_pickups']);
    const second = await seed(testDb(), { dir: seedDir(users), ifEmpty: true, password: TEST_PASSWORD, print: (line) => lines.push(line) });
    expect(second.skipped).toBe('has_users');
    expect(lines).toEqual(['[seed] 已經有帳號，略過']);
  });

  it('--if-empty：已經有帳號時，沒有密碼也照常略過，不會擋下', async () => {
    await createUser({ email: 'someone@test.example' });
    const result = await seed(testDb(), { dir: seedDir(users), ifEmpty: true, deploy: true, print: () => {} });
    expect(result.skipped).toBe('has_users');
    expect(await userCount()).toBe(1);
  });

  it('部署時（--if-empty --deploy）沒有設定 SEED_USER_PASSWORD：只印警告、照常結束，不建立帳號', async () => {
    const lines: string[] = [];
    const result = await seed(testDb(), { dir: seedDir(users), ifEmpty: true, deploy: true, print: (line) => lines.push(line) });
    expect(result.skipped).toBe('no_password');
    expect(lines).toEqual([
      '[deploy] 種子資料：警告：沒有設定 SEED_USER_PASSWORD，略過，沒有建立測試帳號（設定之後再部署一次就會放入）',
    ]);
    expect(await userCount()).toBe(0);
  });

  it('部署時（--if-empty --deploy）印 [deploy] 開頭的訊息', async () => {
    const lines: string[] = [];
    const dir = seedDir(users);
    await seed(testDb(), { dir, ifEmpty: true, deploy: true, password: TEST_PASSWORD, print: (line) => lines.push(line) });
    await seed(testDb(), { dir, ifEmpty: true, deploy: true, password: TEST_PASSWORD, print: (line) => lines.push(line) });
    expect(lines).toEqual(['[deploy] 種子資料：放入……完成', '[deploy] 種子資料：已經有帳號，略過']);
  });

  it('任何一個檔案失敗：全部還原，不會只放一半', async () => {
    const dir = seedDir({ ...users, '03_broken.sql': 'INSERT INTO no_such_table VALUES (1);' });
    await expect(seed(testDb(), { dir, password: TEST_PASSWORD, print: () => {} })).rejects.toThrow('03_broken 失敗，全部還原');
    expect(await userCount()).toBe(0);
    const { rows } = await testDb().query("SELECT to_regclass('seed_pickups') AS table_name");
    expect(rows[0].table_name).toBeNull();
  });

  it('密碼的雜湊值只在種子資料的交易裡看得到，交易結束就不見了', async () => {
    await seed(testDb(), { dir: seedDir(users), password: TEST_PASSWORD, print: () => {} });
    const { rows } = await testDb().query("SELECT current_setting('app.seed_password_hash', true) AS value");
    expect(rows[0].value ?? '').toBe('');
  });
});
