import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS_DIR } from '../db/migrate.js';
import { createApp } from '../src/app.js';
import { requireRole } from '../src/auth/require-user.js';
import { createAuthRouter, createFailureCounter, failureKey, type FailureCounter } from '../src/auth/routes.js';
import { loadSession } from '../src/auth/session.js';
import { createDb, withDatabaseName, type Db } from '../src/db.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { requestContext } from '../src/middleware/request-log.js';
import {
  captureLogs,
  closeTestDb,
  createTestApp,
  createUser,
  loginAs,
  MISSING_API_PATH,
  resetTestDb,
  testConfig,
  testDatabaseUrl,
  testDb,
  TEST_PASSWORD,
  useTemplateDatabase,
} from './helpers.js';

// 模板內建的測試，用只跑過模板 Migration（000）的資料庫：你們加的 Migration 不會讓它變紅。你們自己的測試不要照抄這一行
useTemplateDatabase(import.meta.url);
beforeEach(resetTestDb);
afterAll(closeTestDb);

const INVALID = { error: 'invalid_credentials', message: '帳號或密碼不正確' };
const NEW_PASSWORD = `${TEST_PASSWORD}-new`;
const WRONG_PW = 'wrong-password';

function setCookies(res: request.Response): string[] {
  return ([] as string[]).concat(res.headers['set-cookie'] ?? []);
}

function sessionCookieFrom(res: request.Response): string {
  const cookie = setCookies(res).find((value) => value.startsWith('app_session='));
  if (!cookie) throw new Error('回應沒有設定 app_session Cookie');
  return cookie.split(';')[0]!;
}

function login(app: express.Express, email: string, pw: string = TEST_PASSWORD) {
  return request(app).post('/api/auth/login').send({ email, password: pw });
}

function token(app: express.Express, email: string, pw: string = TEST_PASSWORD) {
  return request(app).post('/api/auth/token').send({ email, password: pw });
}

describe('沒有登入', () => {
  it('需要登入的 API 回 401，格式是 {error, message}', async () => {
    const res = await request(createTestApp()).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', message: '請先登入' });
  });

  it('不存在的 API 回 404「找不到這個網址」', async () => {
    const res = await request(createTestApp()).get(MISSING_API_PATH);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found', message: '找不到這個網址' });
  });
});

describe('POST /api/auth/login（瀏覽器）', () => {
  it('帳號密碼正確：200，回傳使用者（不含 password_hash、不含 Token），設定 HttpOnly 的 Cookie（12 小時）', async () => {
    await createUser({ name: '測試管理者', email: 'manager@test.example', role: 'manager', password: TEST_PASSWORD });
    const app = createTestApp();
    const res = await login(app, 'manager@test.example');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: expect.objectContaining({ id: 1, name: '測試管理者', role: 'manager' }) });
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(JSON.stringify(res.body)).not.toContain('scrypt$');

    const cookie = setCookies(res).join('\n');
    expect(cookie).toMatch(/^app_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=43200');
    expect(cookie).not.toContain('Secure');

    const me = await request(app).get('/api/auth/me').set('Cookie', sessionCookieFrom(res));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: 1, email: 'manager@test.example', name: '測試管理者', role: 'manager', is_active: true });

    const { rows } = await testDb().query(
      "SELECT kind, extract(epoch FROM expires_at - created_at)::int AS seconds FROM sessions",
    );
    expect(rows).toEqual([{ kind: 'cookie', seconds: 43200 }]);
  });

  it('Staging 的 Cookie 加 Secure', async () => {
    await createUser({ email: 'manager@test.example', password: TEST_PASSWORD });
    const res = await login(createTestApp({ appEnv: 'staging' }), 'manager@test.example');
    expect(res.status).toBe(200);
    expect(setCookies(res).join('\n')).toContain('Secure');
  });

  it('Email 不分大小寫、前後的空白不算', async () => {
    await createUser({ email: 'clerk@test.example', password: TEST_PASSWORD });
    const res = await login(createTestApp(), '  Clerk@Test.Example ');
    expect(res.status).toBe(200);
  });

  it('密碼錯、帳號不存在、帳號已停用、沒有設定密碼：都是同一個 401「帳號或密碼不正確」', async () => {
    await createUser({ email: 'active@test.example', password: TEST_PASSWORD });
    await createUser({ email: 'gone@test.example', password: TEST_PASSWORD, is_active: false });
    await createUser({ email: 'nopassword@test.example' });
    const app = createTestApp();
    const attempts: [string, string][] = [
      ['active@test.example', `${TEST_PASSWORD}x`],
      ['nobody@test.example', TEST_PASSWORD],
      ['gone@test.example', TEST_PASSWORD],
      ['nopassword@test.example', TEST_PASSWORD],
    ];
    for (const [email, pw] of attempts) {
      for (const send of [login, token]) {
        const res = await send(app, email, pw);
        expect(res.status, email).toBe(401);
        expect(res.body, email).toEqual(INVALID);
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    }
    const { rows } = await testDb().query('SELECT count(*)::int AS n FROM sessions');
    expect(rows[0].n).toBe(0);
  });

  it('沒填 Email 或密碼：400「請輸入 Email 與密碼」', async () => {
    const app = createTestApp();
    for (const body of [{}, { email: 'a@test.example' }, { password: TEST_PASSWORD }, { email: '', password: '' }]) {
      const res = await request(app).post('/api/auth/login').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_input', message: '請輸入 Email 與密碼' });
    }
  });

  it('同一個帳號連續錯 10 次：之後 15 分鐘內，連正確的密碼也回 429；其他帳號不受影響', async () => {
    await createUser({ email: 'target@test.example', password: TEST_PASSWORD });
    await createUser({ email: 'other@test.example', password: TEST_PASSWORD });
    const app = createTestApp();
    for (let i = 0; i < 10; i += 1) {
      expect((await login(app, 'target@test.example', WRONG_PW)).status).toBe(401);
    }
    const blocked = await login(app, 'target@test.example');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'too_many_attempts', message: '登入失敗太多次，請 15 分鐘後再試' });
    expect((await login(app, 'other@test.example')).status).toBe(200);
  });

  it('同時送出 60 次錯的密碼：只有 10 次去查密碼（401），其他 50 次直接 429；之後正確的密碼也是 429', async () => {
    await createUser({ email: 'target@test.example', password: TEST_PASSWORD });
    const app = createTestApp();
    const results = await Promise.all(Array.from({ length: 60 }, () => login(app, 'target@test.example', WRONG_PW)));
    const statuses = results.map((res) => res.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(50);
    expect((await login(app, 'target@test.example')).status).toBe(429);
  });

  it('錯了幾次之後登入成功：次數清掉，之後又可以錯 10 次', async () => {
    await createUser({ email: 'target@test.example', password: TEST_PASSWORD });
    const app = createTestApp();
    for (let i = 0; i < 9; i += 1) expect((await login(app, 'target@test.example', WRONG_PW)).status).toBe(401);
    expect((await login(app, 'target@test.example')).status).toBe(200);
    for (let i = 0; i < 10; i += 1) expect((await login(app, 'target@test.example', WRONG_PW)).status, `第 ${i + 1} 次`).toBe(401);
    expect((await login(app, 'target@test.example')).status).toBe(429);
  });
});

describe('登入失敗的計數（記在後端的記憶體，佔的大小有上限）', () => {
  /** 剛好 length 個字的 Email。 */
  function emailOfLength(length: number): string {
    const domain = '@test.example';
    return `${'a'.repeat(length - domain.length)}${domain}`;
  }

  // 組裝方式和 createApp 一樣，只是換成測試自己建的計數器，才看得到裡面記了幾組
  function appWithCounter(failures: FailureCounter, db: Db = testDb()) {
    const app = express();
    app.use((req, _res, next) => {
      req.config = testConfig();
      req.db = db;
      next();
    });
    app.use(requestContext);
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', createAuthRouter({ failures }));
    app.use(errorHandler);
    return app;
  }

  it('Email 超過 254 個字：一樣回 401「帳號或密碼不正確」，不查資料庫、不記次數，送再多次計數器也不會變大', async () => {
    const failures = createFailureCounter();
    // 連不上的資料庫：有去查帳號的話，會變成 500
    const broken = createDb('postgres://127.0.0.1:1/app');
    try {
      const app = appWithCounter(failures, broken);
      const tooLong = emailOfLength(255);
      for (let i = 0; i < 11; i += 1) {
        const res = await login(app, tooLong, WRONG_PW);
        expect(res.status, `第 ${i + 1} 次`).toBe(401); // 沒有記次數：第 11 次也不會變成 429
        expect(res.body).toEqual(INVALID);
      }
      for (const length of [256, 5_000, 900_000]) {
        for (const send of [login, token]) {
          const res = await send(app, emailOfLength(length), WRONG_PW);
          expect(res.status, `${length} 個字`).toBe(401);
          expect(res.body).toEqual(INVALID);
        }
      }
      expect(failures.size).toBe(0);
    } finally {
      await broken.close();
    }
  });

  it('沒查完就出錯（資料庫連不上）：不算失敗的次數，資料庫恢復後照常可以登入', async () => {
    const failures = createFailureCounter();
    const broken = createDb('postgres://127.0.0.1:1/app');
    try {
      const app = appWithCounter(failures, broken);
      for (let i = 0; i < 12; i += 1) {
        expect((await login(app, 'target@test.example', WRONG_PW)).status, `第 ${i + 1} 次`).toBe(500);
      }
      expect(failures.size).toBe(0);
    } finally {
      await broken.close();
    }
    await createUser({ email: 'target@test.example', password: TEST_PASSWORD });
    expect((await login(appWithCounter(failures), 'target@test.example')).status).toBe(200);
  });

  it('先佔名額：錯滿 10 次之後不再佔（回 false）；還回一個就能再試一次；登入成功清掉', () => {
    const now = Date.now();
    const counter = createFailureCounter();
    for (let i = 0; i < 10; i += 1) expect(counter.reserve('key', now)).toBe(true);
    expect(counter.reserve('key', now)).toBe(false);
    expect(counter.blocked('key', now)).toBe(true);
    counter.release('key');
    expect(counter.blocked('key', now)).toBe(false);
    expect(counter.reserve('key', now)).toBe(true);
    expect(counter.reserve('key', now)).toBe(false);
    counter.reset('key');
    expect(counter.size).toBe(0);
    counter.release('key'); // 已經清掉的不會變成負的
    expect(counter.reserve('key', now)).toBe(true);
  });

  it('254 個字以內照常查帳號、記次數；記下的鍵長度固定，不跟著 IP 或 Email 變長', async () => {
    const failures = createFailureCounter();
    const res = await login(appWithCounter(failures), emailOfLength(254), WRONG_PW);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID);
    expect(failures.size).toBe(1);

    const key = failureKey('127.0.0.1', 'clerk@test.example');
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(failureKey('9'.repeat(8_000), emailOfLength(254))).toHaveLength(43); // 很長的 X-Forwarded-For 也一樣
    // 和登入找帳號的規則一樣：不分大小寫、前後的空白不算；IP 或 Email 不同就是不同組
    expect(failureKey('127.0.0.1', '  Clerk@Test.Example ')).toBe(key);
    expect(failureKey('127.0.0.2', 'clerk@test.example')).not.toBe(key);
    expect(failureKey('127.0.0.1', 'other@test.example')).not.toBe(key);
  });

  it('最多記 10,000 組；滿了只刪最早記下的一筆，不整個清空，其他已經擋下的照樣擋著', () => {
    const now = Date.now();
    const small = createFailureCounter({ maxKeys: 3 });
    for (const key of ['first', 'second', 'third']) {
      for (let i = 0; i < 10; i += 1) small.reserve(key, now);
    }
    small.reserve('fourth', now);
    expect(small.size).toBe(3);
    expect(small.blocked('first', now)).toBe(false); // 最早記下的被刪掉
    expect(small.blocked('second', now)).toBe(true);
    expect(small.blocked('third', now)).toBe(true);
    expect(small.blocked('third', now + 16 * 60 * 1000)).toBe(false); // 15 分鐘後自動解除

    const full = createFailureCounter();
    for (let i = 0; i <= 10_000; i += 1) full.reserve(`key${i}`, now);
    expect(full.size).toBe(10_000);
  });
});

describe('POST /api/auth/token（Postman）', () => {
  it('回 Token 與到期時間（12 小時後），不設 Cookie；之後帶 Authorization: Bearer 就是這個人', async () => {
    await createUser({ name: '測試門市甲', email: 'clerk@test.example', role: 'clerk', password: TEST_PASSWORD });
    const app = createTestApp();
    const before = Date.now();
    const res = await token(app, 'clerk@test.example');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.user).toMatchObject({ name: '測試門市甲', role: 'clerk' });
    expect(res.body.user).not.toHaveProperty('password_hash');
    const expiresIn = new Date(res.body.expiresAt).getTime() - before;
    expect(expiresIn).toBeGreaterThan(12 * 3600_000 - 60_000);
    expect(expiresIn).toBeLessThan(12 * 3600_000 + 60_000);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.name).toBe('測試門市甲');
    const { rows } = await testDb().query('SELECT kind FROM sessions');
    expect(rows).toEqual([{ kind: 'api' }]);
  });

  it('Bearer 優先於 Cookie：兩個不同的人，以 Bearer 為準；Bearer 無效時也不會改用 Cookie', async () => {
    await createUser({ name: '測試管理者', email: 'manager@test.example', password: TEST_PASSWORD });
    await createUser({ name: '測試師傅', email: 'baker@test.example', password: TEST_PASSWORD });
    const app = createTestApp();
    const managerCookie = sessionCookieFrom(await login(app, 'manager@test.example'));
    const bakerToken = (await token(app, 'baker@test.example')).body.token as string;

    const withCookieOnly = await request(app).get('/api/auth/me').set('Cookie', managerCookie);
    expect(withCookieOnly.body.name).toBe('測試管理者');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', managerCookie)
      .set('Authorization', `Bearer ${bakerToken}`);
    expect(me.status).toBe(200);
    expect(me.body.name).toBe('測試師傅');

    const invalidBearer = await request(app)
      .get('/api/auth/me')
      .set('Cookie', managerCookie)
      .set('Authorization', 'Bearer not-a-real-token');
    expect(invalidBearer.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('每個請求都重新讀 users：改了姓名馬上看得到；帳號停用之後，原本的登入當成沒登入', async () => {
    const user = await createUser({ name: '舊名字', email: 'clerk@test.example' });
    const bearer = await loginAs(user.email);
    const app = createTestApp();
    await testDb().query("UPDATE users SET name = '新名字' WHERE id = $1", [user.id]);
    const renamed = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bearer}`);
    expect(renamed.body.name).toBe('新名字');

    await testDb().query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);
    const disabled = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bearer}`);
    expect(disabled.status).toBe(401);
  });

  describe('之後的 Migration 在 users 加的欄位，自動帶出來', () => {
    // 模擬 T1：從模板的 000 開始，再加一個 Migration 在 users 加 employee_no。用另一個暫時的資料庫，不影響 app_test
    const SCRATCH_DATABASE = 'app_test_auth';
    let scratch: Db;
    let migrationDir: string;

    beforeAll(async () => {
      await testDb().query(`DROP DATABASE IF EXISTS ${SCRATCH_DATABASE} WITH (FORCE)`);
      await testDb().query(`CREATE DATABASE ${SCRATCH_DATABASE}`);
      scratch = createDb(withDatabaseName(testDatabaseUrl(), SCRATCH_DATABASE));
      migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-migrations-'));
      fs.copyFileSync(
        path.join(MIGRATIONS_DIR, '000_create_users_and_sessions.sql'),
        path.join(migrationDir, '000_create_users_and_sessions.sql'),
      );
      fs.writeFileSync(
        path.join(migrationDir, '001_add_employee_no_to_users.sql'),
        'ALTER TABLE users ADD COLUMN employee_no TEXT;',
      );
      await migrate(scratch, { dir: migrationDir, print: () => {} });
    });

    afterAll(async () => {
      await scratch?.close();
      fs.rmSync(migrationDir, { recursive: true, force: true });
      await testDb().query(`DROP DATABASE IF EXISTS ${SCRATCH_DATABASE} WITH (FORCE)`);
    });

    it('me 有 employee_no，沒有 password_hash', async () => {
      await createUser({ email: 'staff@test.example', role: 'clerk', employee_no: 'E002', password: TEST_PASSWORD }, scratch);
      const app = createApp({ config: testConfig(), db: scratch });
      const res = await token(app, 'staff@test.example');
      expect(res.status).toBe(200);
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ email: 'staff@test.example', role: 'clerk', employee_no: 'E002' });
      expect(me.body).not.toHaveProperty('password_hash');
      expect(Object.keys(me.body).sort()).toEqual(['created_at', 'email', 'employee_no', 'id', 'is_active', 'name', 'role']);
    });
  });
});

describe('requireRole', () => {
  // 一個只給管理者與門市人員用的 API（組裝方式和 createApp 一樣：先解析登入資訊，再檢查身分）
  function appWithProtectedRoute() {
    const app = express();
    app.use((req, _res, next) => {
      req.config = testConfig();
      req.db = testDb();
      next();
    });
    app.use(requestContext);
    app.use(loadSession);
    app.post('/api/orders', requireRole('manager', 'clerk'), (req, res) => {
      res.status(201).json({ created_by: req.user!.id });
    });
    app.use(errorHandler);
    return app;
  }

  it('身分符合才放行；身分不符或沒有身分回 403「沒有權限」；沒登入回 401', async () => {
    const manager = await createUser({ email: 'manager@test.example', role: 'manager' });
    const clerk = await createUser({ email: 'clerk@test.example', role: 'clerk' });
    const baker = await createUser({ email: 'baker@test.example', role: 'baker' });
    const nobody = await createUser({ email: 'nobody@test.example' });
    const app = appWithProtectedRoute();

    for (const user of [manager, clerk]) {
      const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${await loginAs(user.email)}`);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ created_by: user.id });
    }
    for (const user of [baker, nobody]) {
      const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${await loginAs(user.email)}`);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden', message: '沒有權限' });
    }
    const anonymous = await request(app).post('/api/orders');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ error: 'unauthorized', message: '請先登入' });
  });

  it('沒有給任何身分是寫錯了：一掛上去就丟出錯誤', () => {
    expect(() => requireRole()).toThrow('requireRole 至少要給一個身分');
  });
});

describe('POST /api/auth/password（修改密碼）', () => {
  it('改好之後：舊密碼不能登入、新密碼可以；這一個與其他已經登入的 Token 都還能用', async () => {
    await createUser({ email: 'owner@test.example', password: TEST_PASSWORD });
    const app = createTestApp();
    const first = (await token(app, 'owner@test.example')).body.token as string;
    const other = (await token(app, 'owner@test.example')).body.token as string;

    const res = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${first}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    expect((await login(app, 'owner@test.example', TEST_PASSWORD)).status).toBe(401);
    expect((await login(app, 'owner@test.example', NEW_PASSWORD)).status).toBe(200);
    for (const bearer of [first, other]) {
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bearer}`)).status).toBe(200);
    }
    const { rows } = await testDb().query("SELECT password_hash FROM users WHERE email = 'owner@test.example'");
    expect(rows[0].password_hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(rows[0].password_hash).not.toContain(NEW_PASSWORD);
  });

  it('目前的密碼錯、新密碼太短、新舊一樣、沒填：400，密碼不變', async () => {
    await createUser({ email: 'owner@test.example', password: TEST_PASSWORD });
    const app = createTestApp();
    const bearer = (await token(app, 'owner@test.example')).body.token as string;
    const cases: [Record<string, unknown>, string, string][] = [
      [{ currentPassword: WRONG_PW, newPassword: NEW_PASSWORD }, 'wrong_password', '目前的密碼不正確'],
      [{ currentPassword: TEST_PASSWORD, newPassword: '9'.repeat(9) }, 'password_too_short', '新密碼至少要 10 個字'],
      [{ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }, 'same_password', '新密碼要和目前的密碼不同'],
      [{ newPassword: NEW_PASSWORD }, 'invalid_input', '請輸入目前的密碼與新密碼'],
    ];
    for (const [body, error, message] of cases) {
      const res = await request(app).post('/api/auth/password').set('Authorization', `Bearer ${bearer}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error, message });
    }
    expect((await login(app, 'owner@test.example', TEST_PASSWORD)).status).toBe(200);
  });

  it('目前的密碼錯 10 次：15 分鐘內連正確的也回 429，密碼不變；同時送出也只有 10 次去查；改成功會清掉次數', async () => {
    await createUser({ email: 'owner@test.example', password: TEST_PASSWORD });
    await createUser({ email: 'burst@test.example', password: TEST_PASSWORD });
    await createUser({ email: 'fixed@test.example', password: TEST_PASSWORD });
    const app = createTestApp();
    const bearerOf = async (email: string) => (await token(app, email)).body.token as string;
    const change = (bearer: string, currentPassword: string) =>
      request(app).post('/api/auth/password').set('Authorization', `Bearer ${bearer}`).send({ currentPassword, newPassword: NEW_PASSWORD });

    const owner = await bearerOf('owner@test.example');
    for (let i = 0; i < 10; i += 1) expect((await change(owner, WRONG_PW)).status, `第 ${i + 1} 次`).toBe(400);
    const blocked = await change(owner, TEST_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'too_many_attempts', message: '目前的密碼錯太多次，請 15 分鐘後再試' });
    expect((await login(app, 'owner@test.example', TEST_PASSWORD)).status).toBe(200);

    const burst = await bearerOf('burst@test.example');
    const results = await Promise.all(Array.from({ length: 30 }, () => change(burst, WRONG_PW)));
    expect(results.filter((res) => res.status === 400)).toHaveLength(10);
    expect(results.filter((res) => res.status === 429)).toHaveLength(20);

    const fixed = await bearerOf('fixed@test.example');
    for (let i = 0; i < 9; i += 1) expect((await change(fixed, WRONG_PW)).status).toBe(400);
    expect((await change(fixed, TEST_PASSWORD)).status).toBe(204);
    // 次數清掉了：沒清掉的話，這一次就是第 11 次（429）
    expect((await change(fixed, WRONG_PW)).status).toBe(400);
  });

  it('沒登入：401', async () => {
    const res = await request(createTestApp())
      .post('/api/auth/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('瀏覽器登出：204、清掉 Cookie，原本的 Cookie 立刻失效', async () => {
    await createUser({ email: 'clerk@test.example', password: TEST_PASSWORD });
    const app = createTestApp();
    const cookie = sessionCookieFrom(await login(app, 'clerk@test.example'));
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect(setCookies(res).join('\n')).toMatch(/app_session=;.*Expires=Thu, 01 Jan 1970/);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('Token 登出：同一個 Token（包括複製出去的）就失效，其他 Token 不受影響', async () => {
    const user = await createUser({ email: 'clerk@test.example' });
    const app = createTestApp();
    const loggedOut = await loginAs(user.email);
    const stillIn = await loginAs(user.email);
    expect((await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${loggedOut}`)).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${loggedOut}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${stillIn}`)).status).toBe(200);
  });
});

describe('Request log', () => {
  it('每個請求帶請求編號與 user_id；不記查詢字串、Email、密碼與 Token', async () => {
    const user = await createUser({ email: 'clerk@test.example', password: TEST_PASSWORD });
    const app = createTestApp();
    const logs = captureLogs();
    const issued = await token(app, 'clerk@test.example');
    const res = await request(app)
      .get('/api/auth/me?phone=0912345678')
      .set('Authorization', `Bearer ${issued.body.token}`);

    const requestId = res.headers['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f]{4}$/);
    const line = logs.find((entry) => entry.includes(`req=${requestId} GET`));
    expect(line).toMatch(
      new RegExp(
        `^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\+08:00 INFO  req=${requestId} GET /api/auth/me user_id=${user.id}$`,
      ),
    );
    expect(logs).toContainEqual(expect.stringMatching(new RegExp(`INFO  req=${requestId} responded status=200$`)));
    const all = logs.join('\n');
    for (const secret of ['clerk@test.example', TEST_PASSWORD, issued.body.token, '0912345678', 'phone=']) {
      expect(all).not.toContain(secret);
    }
  });
});

describe('錯誤回應', () => {
  it('沒預期到的錯誤：500 只有 {error, message}，沒有 Stack Trace；Stack Trace 只進 Log', async () => {
    const broken = createDb('postgres://127.0.0.1:1/app');
    try {
      const logs = captureLogs();
      const res = await request(createTestApp({ db: broken }))
        .post('/api/auth/login')
        .send({ email: 'someone@test.example', password: TEST_PASSWORD });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'internal', message: '系統忙碌，請稍後再試' });
      expect(res.text).not.toMatch(/ECONNREFUSED|\bat\s|stack|node_modules|\.ts\b/);
      const errorLine = logs.find((line) => line.includes(' ERROR '));
      expect(errorLine).toMatch(/ERROR req=[0-9a-f]{4} Error: connect ECONNREFUSED 127\.0\.0\.1:1/);
      expect(errorLine).toContain('\n    at ');
    } finally {
      await broken.close();
    }
  });

  it('送出的資料不是 JSON、找不到的網址：看得懂的訊息，沒有 Stack Trace', async () => {
    const app = createTestApp();
    const badJson = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(badJson.status).toBe(400);
    expect(badJson.body).toEqual({ error: 'invalid_json', message: '送出的資料格式不正確（不是 JSON）' });
    const missing = await request(app).get(MISSING_API_PATH);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'not_found', message: '找不到這個網址' });
    for (const res of [badJson, missing]) expect(res.text).not.toMatch(/\bat\s|stack|SyntaxError/);
  });
});
