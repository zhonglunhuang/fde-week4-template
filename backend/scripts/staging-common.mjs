// Staging 的 GitHub Actions 腳本（staging-deploy、staging-backup、staging-select）共用的小工具。
// 不用任何套件，只用 Node.js 內建的功能。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipeiIso(date) {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString();
}

/** 台灣時間，例如 2026-11-20 11:18:30（主機用 UTC 也一樣）。 */
export function taipeiTime(date = new Date()) {
  return taipeiIso(date).slice(0, 19).replace('T', ' ');
}

/** 檔名用的台灣時間，例如 20261120-111830。 */
export function taipeiStamp(date = new Date()) {
  const iso = taipeiIso(date);
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`;
}

/** 檔案大小，例如 48.2 KB。 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 寫進這一次執行的摘要（GitHub Actions 的 GITHUB_STEP_SUMMARY）；本機執行時印在畫面上。 */
export function writeSummary(markdown, env = process.env) {
  const text = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  else process.stdout.write(`\n${text}`);
}

/** 寫一個 step 的輸出（GITHUB_OUTPUT），後面的步驟用 steps.<id>.outputs.<name> 讀。 */
export function writeOutput(name, value, env = process.env) {
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

/** 不讓 GitHub Actions 的 Log 顯示這個值（只在 GitHub Actions 裡有作用）。 */
export function maskInLog(value, env = process.env) {
  if (env.GITHUB_ACTIONS === 'true' && value) process.stdout.write(`::add-mask::${value}\n`);
}

/** 摘要表格的一格：拿掉換行與 |，避免表格跑掉。 */
export function cell(text) {
  return String(text).replace(/\r?\n/g, ' ').replaceAll('|', '｜');
}

/**
 * 資料庫工具（pg_dump、pg_restore）錯誤輸出裡，PostgreSQL 自己的那一句（ERROR: 或 FATAL: 後面），
 * 不含主機、帳號這類連線資訊；找不到就回 undefined。
 */
export function postgresMessage(output) {
  const match = /(?:ERROR|FATAL):\s+(.+)$/m.exec(String(output));
  return match ? match[1].replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '（連線網址）').trim() : undefined;
}

/** fetch 加上逾時；連不上、逾時都回 undefined，不丟錯。 */
export async function fetchJson(url, { timeoutMs = 60_000, headers } = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: res.status, body };
  } catch {
    return undefined;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 這個檔案是不是被直接執行（node backend/scripts/xxx.mjs），而不是被測試 import。 */
export function isMain(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = path.resolve(fileURLToPath(moduleUrl));
  const target = path.resolve(entry);
  return process.platform === 'win32' ? self.toLowerCase() === target.toLowerCase() : self === target;
}
