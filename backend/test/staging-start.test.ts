// Staging 的啟動腳本（npm run staging:start，Render 的 Start Command）：設定不齊就不能啟動。
// 這裡只測「缺少環境變數」：還沒執行 Migration 就停止，結束代碼 1，Render 才會判定部署失敗、留在舊版。
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config.js';

const START_SCRIPT = path.join(REPO_ROOT, 'backend', 'scripts', 'staging-start.mjs');

function startWith(env: Record<string, string>) {
  // 不繼承這台電腦的環境變數（.env 也不會被讀：腳本只看 Render 給的環境變數）
  return spawnSync(process.execPath, [START_SCRIPT], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('staging:start 的設定檢查', () => {
  it('三個必填的環境變數都缺：印 ERROR 與中文說明，結束代碼 1，不執行 Migration', () => {
    const result = startWith({});
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00 ERROR startup failed: missing required environment variables DATABASE_URL, SESSION_SECRET, API_BASE_URL$/m,
    );
    expect(result.stdout).toContain('缺少環境變數 DATABASE_URL、SESSION_SECRET、API_BASE_URL');
    expect(result.stdout).not.toContain('[deploy]');
  });

  it('只缺 API_BASE_URL（空值也算缺）：一樣不啟動', () => {
    const result = startWith({
      DATABASE_URL: 'postgres://127.0.0.1:1/app',
      SESSION_SECRET: crypto.randomBytes(16).toString('hex'),
      API_BASE_URL: '  ',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ERROR startup failed: missing required environment variable API_BASE_URL');
    expect(result.stdout).not.toContain('[deploy]');
  });
});
