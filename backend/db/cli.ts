// 資料庫指令（npm run db:migrate／db:seed／db:reset／db:query）共用的小工具。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/config.js';
import { createDb, type Db } from '../src/db.js';
import { errorMessage } from '../src/logger.js';

/** 指令自己知道要怎麼說明的錯誤（例如檔名不對、Migration 失敗）。 */
export class CliError extends Error {}

/** 這個檔案是不是被直接執行（npm run 呼叫），而不是被別的檔案 import。 */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = path.resolve(fileURLToPath(moduleUrl));
  const target = path.resolve(entry);
  return process.platform === 'win32' ? self.toLowerCase() === target.toLowerCase() : self === target;
}

/** 讀 .env 的 DATABASE_URL；沒有就印出提示，回 undefined。 */
export function readDatabaseUrl(tag: string): string | undefined {
  loadEnvFile();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.log(`${tag} 缺少環境變數 DATABASE_URL，請參考 .env.example`);
    process.exitCode = 1;
    return undefined;
  }
  return databaseUrl;
}

function describe(err: unknown): string {
  if (err instanceof CliError) return err.message;
  const message = errorMessage(err);
  const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
  if (code === '42P01') return `錯誤：${message}（找不到這個資料表：確認表名，或先執行 npm run db:migrate）`;
  return `錯誤：${message}`;
}

/** 連上資料庫、執行 task、最後一定關掉連線；失敗時印出原因，結束代碼 1。 */
export async function runCli(tag: string, task: (db: Db, databaseUrl: string) => Promise<void>): Promise<void> {
  const databaseUrl = readDatabaseUrl(tag);
  if (!databaseUrl) return;
  const db = createDb(databaseUrl);
  try {
    await task(db, databaseUrl);
  } catch (err) {
    console.log(`${tag} ${describe(err)}`);
    process.exitCode = 1;
  } finally {
    await db.close().catch(() => {});
  }
}
