// 技術導師匯出 Log 的腳本（backend/scripts/render-logs.mjs）：用一個本機的假 Render API 測分頁、重試與輸出格式。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatLogLine, taipeiTimestamp, timeRange } from '../scripts/render-logs.mjs';
import { REPO_ROOT } from '../src/config.js';

const SCRIPT = path.join(REPO_ROOT, 'backend', 'scripts', 'render-logs.mjs');
const API_KEY = `rnd_${crypto.randomBytes(12).toString('hex')}`;
const WRONG_KEY = `rnd_${'0'.repeat(12)}`;

/** 三頁的 Log（第二頁開頭重複了第一頁的最後一則，要去掉）。 */
const PAGES = [
  {
    logs: [
      { id: 'l1', timestamp: '2026-11-18T01:00:00.100Z', message: 'INFO  req=a1b2 GET /api/orders user_id=3' },
      { id: 'l2', timestamp: '2026-11-18T01:00:01.200Z', message: 'INFO  req=a1b2 responded status=200' },
    ],
    hasMore: true,
    nextStartTime: '2026-11-18T01:00:01.200Z',
    nextEndTime: '2026-11-20T16:00:00.000Z',
  },
  {
    logs: [
      { id: 'l2', timestamp: '2026-11-18T01:00:01.200Z', message: 'INFO  req=a1b2 responded status=200' },
      { id: 'l3', timestamp: '2026-11-19T06:52:31.104Z', message: 'ERROR req=c3d4 Error: boom\n    at handler (orders.ts:10)' },
    ],
    hasMore: true,
    nextStartTime: '2026-11-19T06:52:31.104Z',
    nextEndTime: '2026-11-20T16:00:00.000Z',
  },
  {
    logs: [{ id: 'l4', timestamp: '2026-11-20T15:59:59.000Z', message: 'INFO  server started version=9e3b6d0' }],
    hasMore: false,
    nextStartTime: '2026-11-20T15:59:59.000Z',
    nextEndTime: '2026-11-20T16:00:00.000Z',
  },
];

let server: http.Server;
let apiBase: string;
const seen: { path: string; query: Record<string, string>; authorization?: string }[] = [];
let rateLimitOnce = true;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ message: 'unauthorized' }));
      return;
    }
    if (url.pathname === '/v1/services/srv-test123') {
      res.end(JSON.stringify({ id: 'srv-test123', name: 'heri-2026a-g2', ownerId: 'tea-owner1' }));
      return;
    }
    if (url.pathname === '/v1/logs') {
      if (rateLimitOnce) {
        rateLimitOnce = false;
        res.statusCode = 429;
        res.setHeader('Retry-After', '0');
        res.end(JSON.stringify({ message: 'rate limited' }));
        return;
      }
      const startTime = url.searchParams.get('startTime');
      const page = PAGES.find((_page, i) => (i === 0 ? '2026-11-17T16:00:00.000Z' : PAGES[i - 1]!.nextStartTime) === startTime);
      res.end(JSON.stringify(page ?? { logs: [], hasMore: false }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function exportLogs(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', RENDER_API_BASE: apiBase, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('日期與格式', () => {
  it('台灣的日期 → 查詢範圍（含結束日期那一整天）', () => {
    expect(timeRange('2026-11-18', '2026-11-20')).toEqual({
      startTime: '2026-11-17T16:00:00.000Z',
      endTime: '2026-11-20T16:00:00.000Z',
    });
    expect(timeRange('2026-11-18')).toEqual({ startTime: '2026-11-17T16:00:00.000Z', endTime: '2026-11-18T16:00:00.000Z' });
    expect(() => timeRange('2026/11/18')).toThrow('日期要寫成 YYYY-MM-DD');
    expect(() => timeRange('2026-11-20', '2026-11-18')).toThrow('結束日期不能比開始日期早');
  });

  it('每一行：台灣時間（到毫秒）＋ Log 的內容；多行的訊息後面幾行縮排', () => {
    expect(taipeiTimestamp('2026-11-19T06:52:31.104Z')).toBe('2026-11-19 14:52:31.104');
    expect(formatLogLine({ timestamp: '2026-11-19T06:52:31.104Z', message: 'ERROR boom\n    at x' })).toBe(
      '2026-11-19 14:52:31.104 ERROR boom\n        at x',
    );
  });
});

describe('node backend/scripts/render-logs.mjs <服務 ID> <開始日期> [結束日期]', () => {
  it('照 hasMore／nextStartTime／nextEndTime 翻頁、去掉重複、遇到 429 等一下再試；檔案只有 Log，進度在畫面上', async () => {
    const { code, stdout, stderr } = await exportLogs(['srv-test123', '2026-11-18', '2026-11-20'], { RENDER_API_KEY: API_KEY });
    expect(code, stderr).toBe(0);
    expect(stdout.split('\n')).toEqual([
      '2026-11-18 09:00:00.100 INFO  req=a1b2 GET /api/orders user_id=3',
      '2026-11-18 09:00:01.200 INFO  req=a1b2 responded status=200',
      '2026-11-19 14:52:31.104 ERROR req=c3d4 Error: boom',
      '        at handler (orders.ts:10)',
      '2026-11-20 23:59:59.000 INFO  server started version=9e3b6d0',
      '',
    ]);
    expect(stderr).toContain('[render-logs] Render 的 API 回 429，0 秒後再試');
    expect(stderr).toContain('[render-logs] 完成：共 4 則');
    expect(stderr).toContain('不再匯出就到 Render 的 Account Settings → API Keys 刪掉');

    const logRequests = seen.filter((entry) => entry.path === '/v1/logs' && entry.authorization === `Bearer ${API_KEY}`);
    expect(logRequests[0]!.query).toEqual({
      ownerId: 'tea-owner1',
      resource: 'srv-test123',
      direction: 'forward',
      limit: '100',
      startTime: '2026-11-17T16:00:00.000Z',
      endTime: '2026-11-20T16:00:00.000Z',
    });
    expect(logRequests.map((entry) => entry.query.startTime)).toEqual([
      '2026-11-17T16:00:00.000Z',
      '2026-11-17T16:00:00.000Z',
      '2026-11-18T01:00:01.200Z',
      '2026-11-19T06:52:31.104Z',
    ]);
    expect(`${stdout}${stderr}`).not.toContain(API_KEY);
  });

  it('API Key 不對：說明原因，結束代碼 1', async () => {
    const { code, stderr } = await exportLogs(['srv-test123', '2026-11-18'], { RENDER_API_KEY: WRONG_KEY });
    expect(code).toBe(1);
    expect(stderr).toContain('Render 不接受這個 API Key');
  });

  it('服務 ID 找不到、參數不對：說明用法', async () => {
    const missing = await exportLogs(['srv-nope', '2026-11-18'], { RENDER_API_KEY: API_KEY });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('找不到這個服務');
    const usage = await exportLogs(['heri-g2', '2026-11-18'], { RENDER_API_KEY: API_KEY });
    expect(usage.code).toBe(1);
    expect(usage.stderr).toContain('服務 ID 要是 srv- 開頭');
    expect(usage.stderr).toContain('用法：node backend/scripts/render-logs.mjs <服務 ID> <開始日期> [結束日期] > staging.log');
  });

  it('沒有 RENDER_API_KEY、也不是可以輸入的視窗：說明怎麼設定', async () => {
    const { code, stderr } = await exportLogs(['srv-test123', '2026-11-18']);
    expect(code).toBe(1);
    expect(stderr).toContain('沒有 RENDER_API_KEY');
  });
});
