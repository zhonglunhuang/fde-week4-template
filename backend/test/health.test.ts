import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { captureLogs, closeTestDb, createTestApp, useTemplateDatabase } from './helpers.js';

// 模板內建的測試，用只跑過模板 Migration（000）的資料庫：你們加的 Migration 不會讓它變紅。你們自己的測試不要照抄這一行
useTemplateDatabase(import.meta.url);
afterAll(closeTestDb);

const originalCommit = process.env.RENDER_GIT_COMMIT;
afterEach(() => {
  if (originalCommit === undefined) delete process.env.RENDER_GIT_COMMIT;
  else process.env.RENDER_GIT_COMMIT = originalCommit;
});

const COMMIT = '9e3b6d0a1c2f4e5d6b7a8c9d0e1f2a3b4c5d6e7f';

describe('GET /api/health', () => {
  it('資料庫正常：200，status 與 database 都是 ok（本機不帶 version）', async () => {
    const res = await request(createTestApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('資料庫連不上：503，後端照常回應', async () => {
    const unreachable = createDb('postgres://127.0.0.1:1/app');
    try {
      const app = createTestApp({ db: unreachable });
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'error', database: 'error' });
      // 同一個後端還能繼續回應下一個請求
      const again = await request(app).get('/api/health');
      expect(again.status).toBe(503);
      const version = await request(app).get('/api/version');
      expect(version.status).toBe(200);
    } finally {
      await unreachable.close();
    }
  });

  it('Staging：多一個 version，是 RENDER_GIT_COMMIT 的前 7 碼', async () => {
    process.env.RENDER_GIT_COMMIT = COMMIT;
    const res = await request(createTestApp({ appEnv: 'staging' })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok', version: '9e3b6d0' });
    expect(res.headers['x-robots-tag']).toBe('noindex');
  });

  it('健康檢查不寫進 Log', async () => {
    const logs = captureLogs();
    await request(createTestApp()).get('/api/health');
    expect(logs).toEqual([]);
  });
});

describe('GET /api/version（不用登入）', () => {
  it('本機沒有 RENDER_GIT_COMMIT：commit 與 short 都是 local，startedAt 是台灣時間', async () => {
    delete process.env.RENDER_GIT_COMMIT;
    const res = await request(createTestApp()).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      commit: 'local',
      short: 'local',
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/),
    });
  });

  it('Render 給的 RENDER_GIT_COMMIT：完整的 commit 與前 7 碼的 short', async () => {
    process.env.RENDER_GIT_COMMIT = COMMIT;
    const res = await request(createTestApp({ appEnv: 'staging' })).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ commit: COMMIT, short: '9e3b6d0' });
  });

  it('資料庫連不上也回得出版本（不查資料庫、不需要登入）', async () => {
    process.env.RENDER_GIT_COMMIT = COMMIT;
    const unreachable = createDb('postgres://127.0.0.1:1/app');
    try {
      const res = await request(createTestApp({ db: unreachable }))
        .get('/api/version')
        .set('Authorization', 'Bearer token-that-would-need-a-database-lookup');
      expect(res.status).toBe(200);
      expect(res.body.short).toBe('9e3b6d0');
    } finally {
      await unreachable.close();
    }
  });
});
