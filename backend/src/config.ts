// 設定：讀 repo 根目錄的 .env（已經存在的環境變數優先，不會被 .env 蓋掉）。
// 程式只在啟動時讀一次，改了 .env 要重新啟動後端。
//
// 必填：DATABASE_URL、SESSION_SECRET（APP_ENV 不是 development 時，API_BASE_URL 也必填）。
// 缺少或空值都算缺少，啟動時印出缺哪一個並停止。
// 選填（有預設值，不寫進 .env.example）：
//   APP_ENV   development（預設）、staging 或 production
//   WEB_PORT  前端的埠，預設 3000；只在 3000 被佔用時才設，前端與後端的 CORS 都讀它
//   PORT      Render 會自動給；development 以外的環境監聽這個埠
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export type AppEnv = 'development' | 'staging' | 'production';
const APP_ENVS: readonly string[] = ['development', 'staging', 'production'];

export interface Config {
  appEnv: AppEnv;
  databaseUrl: string;
  sessionSecret: string;
  /** 前端呼叫後端的位址；Staging 由後端提供給前端（/config.js）。 */
  apiBaseUrl: string;
  /** 後端監聽的埠：development 用 API_PORT（預設 4000），其他環境用 PORT。 */
  port: number;
  /** 前端開發伺服器的埠（CORS 只允許這個埠的前端）。 */
  webPort: number;
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** repo 根目錄（原始碼與 npm run build 打包後的 backend/dist 都適用）。 */
export const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

let envFileLoaded = false;

/** 讀 repo 根目錄的 .env；沒有這個檔案也不會出錯（後面檢查必填時才報缺少）。 */
export function loadEnvFile(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
}

/** 設定有問題：message 寫進 Log（英文，方便搜尋），hint 是給人看的中文說明。 */
export class ConfigError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function missingVariables(names: string[]): ConfigError {
  const noun = names.length > 1 ? 'variables' : 'variable';
  return new ConfigError(
    `missing required environment ${noun} ${names.join(', ')}`,
    `缺少環境變數 ${names.join('、')}，請參考 .env.example`,
  );
}

function readPort(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`invalid ${name} ${raw}`, `${name} 要是 1 到 65535 之間的數字（現在是 ${raw}）`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const appEnvRaw = read(env, 'APP_ENV') ?? 'development';
  if (!APP_ENVS.includes(appEnvRaw)) {
    throw new ConfigError(
      `invalid APP_ENV ${appEnvRaw}`,
      `APP_ENV 只能是 development、staging 或 production（現在是 ${appEnvRaw}）`,
    );
  }
  const appEnv = appEnvRaw as AppEnv;

  const required = ['DATABASE_URL', 'SESSION_SECRET'];
  if (appEnv !== 'development') required.push('API_BASE_URL');
  const missing = required.filter((name) => read(env, name) === undefined);
  if (missing.length > 0) throw missingVariables(missing);

  // development 用 API_PORT；其他環境用 Render 給的 PORT（沒有 PORT 才退回 API_PORT）
  const portVariable = appEnv === 'development' || read(env, 'PORT') === undefined ? 'API_PORT' : 'PORT';
  const port = readPort(env, portVariable, 4000);

  return {
    appEnv,
    databaseUrl: read(env, 'DATABASE_URL')!,
    sessionSecret: read(env, 'SESSION_SECRET')!,
    apiBaseUrl: (read(env, 'API_BASE_URL') ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    port,
    webPort: readPort(env, 'WEB_PORT', 3000),
  };
}
