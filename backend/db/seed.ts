// npm run db:seed：依序執行 backend/db/seeds/NN_名稱.sql，放入種子資料（虛構的測試資料）。
//
// - 測試帳號的密碼不寫進任何檔案：讀環境變數 SEED_USER_PASSWORD（至少 10 個字），算出雜湊值，
//   在種子檔裡用 current_setting('app.seed_password_hash') 取用。每個測試帳號都是這一個密碼。
//   本機寫在 .env（自己取）；Staging 由技術導師設定在 Render。
// - 全部檔案放在同一個交易：任何一個失敗，全部還原，不會只放一半。
// - 種子檔要能重複執行（例如 INSERT … ON CONFLICT DO NOTHING），重跑不會多出重複的資料。
// - 加 --if-empty：users 已經有資料就略過（部署時用，只有第一次會放）。部署時沒有設定 SEED_USER_PASSWORD
//   只印警告、照常啟動（不會建立測試帳號）。
// - 加 --deploy（部署時用）會改印 [deploy] 開頭的訊息。
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/auth/password.js';
import { loadEnvFile, REPO_ROOT } from '../src/config.js';
import type { Db } from '../src/db.js';
import { errorMessage } from '../src/logger.js';
import { CliError, isMainModule, runCli } from './cli.js';

export const SEEDS_DIR = path.join(REPO_ROOT, 'backend', 'db', 'seeds');
const FILE_PATTERN = /^\d{2}_[a-z0-9_]+\.sql$/;

/** 種子檔裡取得密碼雜湊值的設定名稱：current_setting('app.seed_password_hash') */
export const SEED_PASSWORD_SETTING = 'app.seed_password_hash';

export interface SeedOptions {
  dir?: string;
  ifEmpty?: boolean;
  deploy?: boolean;
  /** 測試帳號的密碼（SEED_USER_PASSWORD） */
  password?: string;
  print?: (line: string) => void;
}

export interface SeedResult {
  /** 這次執行的種子檔（不含 .sql） */
  files: string[];
  /** 沒有執行的原因 */
  skipped?: 'no_files' | 'has_users' | 'no_password';
}

export function readSeedFiles(dir: string = SEEDS_DIR): { name: string; sql: string }[] {
  if (!fs.existsSync(dir)) return [];
  const sqlFiles = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const invalid = sqlFiles.filter((file) => !FILE_PATTERN.test(file));
  if (invalid.length > 0) {
    throw new CliError(
      `檔名不符合規則：${invalid.join('、')}（要像 01_users.sql：兩位數字、底線，後面只用小寫英文、數字與底線）`,
    );
  }
  return sqlFiles.map((file) => ({
    name: file.replace(/\.sql$/, ''),
    sql: fs.readFileSync(path.join(dir, file), 'utf8'),
  }));
}

/** SEED_USER_PASSWORD 的值（空白當成沒有設定）。 */
export function readSeedPassword(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.SEED_USER_PASSWORD?.trim();
  return value ? value : undefined;
}

/** 密碼不能用的原因；可以用就回 undefined。 */
export function seedPasswordProblem(password: string | undefined): string | undefined {
  if (password === undefined) {
    return `缺少 SEED_USER_PASSWORD：種子資料的測試帳號用它當密碼。請在 .env 加上 SEED_USER_PASSWORD=（自己取，至少 ${MIN_PASSWORD_LENGTH} 個字，不要用平常用的密碼），再執行一次`;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `SEED_USER_PASSWORD 至少要 ${MIN_PASSWORD_LENGTH} 個字（現在是 ${password.length} 個字），請在 .env 改長一點，再執行一次`;
  }
  return undefined;
}

export async function seed(db: Db, options: SeedOptions = {}): Promise<SeedResult> {
  const print = options.print ?? ((line: string) => console.log(line));
  const tag = options.deploy ? '[deploy] 種子資料：' : '[seed] ';
  const files = readSeedFiles(options.dir ?? SEEDS_DIR);

  if (files.length === 0) {
    print(options.deploy ? `${tag}沒有種子資料檔，略過` : `${tag}沒有種子資料檔（backend/db/seeds/*.sql，T1 會建立）`);
    return { files: [], skipped: 'no_files' };
  }

  if (options.ifEmpty) {
    const { rows } = await db.query<{ has_users: boolean }>('SELECT EXISTS (SELECT 1 FROM users) AS has_users');
    if (rows[0]?.has_users) {
      print(`${tag}已經有帳號，略過`);
      return { files: [], skipped: 'has_users' };
    }
  }

  const problem = seedPasswordProblem(options.password);
  if (problem) {
    if (options.ifEmpty) {
      // 部署時不擋啟動：只是還沒有測試帳號。設好 SEED_USER_PASSWORD 再部署一次，資料庫還沒有帳號就會放入
      const reason = options.password === undefined ? '沒有設定 SEED_USER_PASSWORD' : `SEED_USER_PASSWORD 少於 ${MIN_PASSWORD_LENGTH} 個字`;
      print(`${tag}警告：${reason}，略過，沒有建立測試帳號（設定之後再部署一次就會放入）`);
      return { files: [], skipped: 'no_password' };
    }
    throw new CliError(problem);
  }

  const passwordHash = await hashPassword(options.password!);
  await db.tx(async (client) => {
    // 只在這個交易裡有效（第三個參數 true），交易結束就不見了
    await client.query('SELECT set_config($1, $2, true)', [SEED_PASSWORD_SETTING, passwordHash]);
    for (const file of files) {
      try {
        await client.query(file.sql);
      } catch (err) {
        throw new CliError(`${file.name} 失敗，全部還原，沒有放入任何資料：${errorMessage(err)}`);
      }
    }
  });

  if (options.deploy) {
    print(`${tag}放入……完成`);
  } else {
    for (const file of files) print(`${tag}${file.name}……完成`);
  }
  return { files: files.map((file) => file.name) };
}

if (isMainModule(import.meta.url)) {
  const deploy = process.argv.includes('--deploy');
  const ifEmpty = process.argv.includes('--if-empty');
  loadEnvFile();
  await runCli(deploy ? '[deploy]' : '[seed]', async (db) => {
    await seed(db, { deploy, ifEmpty, password: readSeedPassword() });
  });
}
