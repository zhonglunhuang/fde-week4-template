// Staging（APP_ENV 不是 development）：同一個服務提供打包好的前端（frontend/dist）與 /config.js。
// 這裡用一個暫時的資料夾當打包結果，不用先 npm run build。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestDb, createTestApp, useTemplateDatabase } from './helpers.js';

// 模板內建的測試，用只跑過模板 Migration（000）的資料庫：你們加的 Migration 不會讓它變紅。你們自己的測試不要照抄這一行
useTemplateDatabase(import.meta.url);
let distDir: string;

beforeAll(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-dist-'));
  fs.mkdirSync(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>練習專案骨架</title><div id="root"></div>');
  fs.writeFileSync(path.join(distDir, 'assets', 'index-abc123.js'), 'console.log("app");');
});

afterAll(async () => {
  fs.rmSync(distDir, { recursive: true, force: true });
  await closeTestDb();
});

describe('Staging 提供打包好的前端', () => {
  it('首頁與畫面上的網址（例如 /login、/password）都回 index.html，重新整理也打得開', async () => {
    const app = createTestApp({ appEnv: 'staging', frontendDir: distDir });
    for (const url of ['/', '/login', '/password', '/orders/12']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.headers['content-type'], url).toContain('text/html');
      expect(res.text, url).toContain('<div id="root"></div>');
      expect(res.headers['x-robots-tag']).toBe('noindex');
    }
  });

  it('打包的檔案照樣提供；/config.js 帶 API 位址、環境與版本', async () => {
    const app = createTestApp({ appEnv: 'staging', frontendDir: distDir });
    const asset = await request(app).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.text).toContain('console.log("app")');
    const config = await request(app).get('/config.js');
    expect(config.status).toBe(200);
    expect(config.headers['cache-control']).toBe('no-store');
    expect(config.text).toMatch(/^window\.APP_CONFIG=\{"apiBaseUrl":"http:\/\/localhost:4000","appEnv":"staging","version":"[^"]+"\};\n$/);
  });

  it('/api 底下找不到的網址回 JSON 的 404，不會回 index.html', async () => {
    const res = await request(createTestApp({ appEnv: 'staging', frontendDir: distDir })).get('/api/no-such-thing');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found', message: '找不到這個網址' });
  });

  it('本機（development）不提供前端：前端由 npm run dev:web 提供', async () => {
    const res = await request(createTestApp({ frontendDir: distDir })).get('/');
    expect(res.status).toBe(404);
  });
});
