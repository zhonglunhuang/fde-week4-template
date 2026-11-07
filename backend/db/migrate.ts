// npm run db:migrate：照編號從 000 起，依序執行 backend/db/migrations/ 裡還沒跑過的 Migration。
//
// - 檔名：NNN_動作_對象.sql（三位數字、底線、小寫英文、數字或底線），例如 001_create_departments.sql。
// - 每個環境（你的電腦、Staging）各自用 schema_migrations 表記得跑到哪；每個檔案一個交易，失敗就整個還原。
// - 已經執行過的檔案不會重跑；內容被改過只會警告。要改結構，一律新增一個 Migration。
// - 資料庫有、這一版程式沒有的 Migration（回滾到舊版時會這樣）：只警告、照常結束，回滾不會被擋下。
// - 用 pg_advisory_lock 排隊，換版時新舊兩個實例同時啟動也不會重複執行。
// - 加 --deploy（部署時用）會改印 [deploy] 開頭的訊息。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../src/config.js';
import type { Db } from '../src/db.js';
import { errorMessage } from '../src/logger.js';
import { CliError, isMainModule, runCli } from './cli.js';

export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'backend', 'db', 'migrations');
const FILE_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 72_010_001; // pg_advisory_lock 的編號，任何固定的數字都可以

export interface MigrationFile {
  /** 不含 .sql 的檔名，例如 000_create_users_and_sessions */
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrateOptions {
  dir?: string;
  deploy?: boolean;
  print?: (line: string) => void;
}

export interface MigrateResult {
  /** 這次執行的 Migration（依序） */
  applied: string[];
  /** 資料庫有、程式沒有的 */
  unknown: string[];
  /** 已經執行過、內容卻被改過的 */
  modified: string[];
}

/** 換行統一成 LF 再算，Windows 與 Mac 取出同一個檔案會得到同一個值。 */
export function checksumOf(sql: string): string {
  return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function readMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const sqlFiles = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const invalid = sqlFiles.filter((file) => !FILE_PATTERN.test(file));
  if (invalid.length > 0) {
    throw new CliError(
      `檔名不符合規則：${invalid.join('、')}（要像 001_create_examples.sql：三位數字、底線，後面只用小寫英文、數字與底線）`,
    );
  }
  const byNumber = new Map<string, string[]>();
  for (const file of sqlFiles) {
    const number = FILE_PATTERN.exec(file)![1]!;
    byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
  }
  const duplicated = [...byNumber.values()].filter((files) => files.length > 1);
  if (duplicated.length > 0) {
    throw new CliError(
      `編號重複：${duplicated.map((files) => files.join('、')).join('；')}（還沒在任何環境執行過的那個，改成下一個沒用過的編號）`,
    );
  }
  return sqlFiles.map((file) => {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    return { name: file.replace(/\.sql$/, ''), sql, checksum: checksumOf(sql) };
  });
}

export async function migrate(db: Db, options: MigrateOptions = {}): Promise<MigrateResult> {
  const print = options.print ?? ((line: string) => console.log(line));
  const tag = options.deploy ? '[deploy]' : '[migrate]';
  const files = readMigrationFiles(options.dir);
  const result: MigrateResult = { applied: [], unknown: [], modified: [] };

  const client = await db.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
      const { rows } = await client.query<{ name: string; checksum: string }>(
        'SELECT name, checksum FROM schema_migrations ORDER BY name',
      );
      const done = new Map(rows.map((row) => [row.name, row.checksum]));
      const known = new Set(files.map((file) => file.name));

      for (const name of done.keys()) {
        if (known.has(name)) continue;
        result.unknown.push(name);
        print(`${tag} 資料庫已經執行過 ${name}，這一版的程式沒有這個檔（可能是回滾到舊版），略過`);
      }

      for (const file of files) {
        const checksum = done.get(file.name);
        if (checksum !== undefined) {
          if (checksum !== file.checksum) {
            result.modified.push(file.name);
            print(`${tag} 警告：已經執行過的 ${file.name} 被修改過，不會重跑；要改結構請新增一個 Migration`);
          }
          continue;
        }
        try {
          await client.query('BEGIN');
          await client.query(file.sql);
          await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
            file.name,
            file.checksum,
          ]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw new CliError(
            options.deploy
              ? `執行 Migration：${file.name}……失敗：${errorMessage(err)}`
              : `${file.name} 失敗，已還原這個檔案的變更：${errorMessage(err)}`,
          );
        }
        result.applied.push(file.name);
        print(options.deploy ? `[deploy] 執行 Migration：${file.name}……完成` : `[migrate] ${file.name}……完成`);
      }

      if (result.applied.length === 0) {
        print(options.deploy ? '[deploy] 沒有新的 Migration' : '[migrate] 已是最新，沒有要執行的 Migration');
      }
      if (!options.deploy) print('[migrate] 完成');
      return result;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

if (isMainModule(import.meta.url)) {
  const deploy = process.argv.includes('--deploy');
  await runCli(deploy ? '[deploy]' : '[migrate]', async (db) => {
    await migrate(db, { deploy });
  });
}
