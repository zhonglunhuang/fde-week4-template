// npm run db:reset：重建「本機」的資料庫。清空所有資料表，從 000 起照順序重跑全部 Migration，再放入種子資料。
// 會刪掉本機資料庫裡的所有資料，所以只在 APP_ENV=development、而且 DATABASE_URL 的主機是
// 127.0.0.1 或 localhost 時才執行；其他情況（例如連到 Staging）一律拒絕。
// 有種子檔、卻還沒設定 SEED_USER_PASSWORD 時，清空之前就先停下來，資料庫不會被清成空的。
import { isMainModule, readDatabaseUrl, runCli } from './cli.js';
import { migrate } from './migrate.js';
import { readSeedFiles, readSeedPassword, seed, seedPasswordProblem } from './seed.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function numberRange(names: string[]): string {
  const numbers = names.map((name) => name.slice(0, 3));
  if (numbers.length === 0) return '（沒有 Migration）';
  return numbers.length === 1 ? numbers[0]! : `${numbers[0]}–${numbers[numbers.length - 1]}`;
}

if (isMainModule(import.meta.url)) {
  const databaseUrl = readDatabaseUrl('[reset]');
  const appEnv = process.env.APP_ENV?.trim() || 'development';
  let host: string;
  try {
    host = databaseUrl ? new URL(databaseUrl).hostname : '';
  } catch {
    host = '（網址格式不對）';
  }
  const password = readSeedPassword();
  let passwordProblem: string | undefined;
  try {
    passwordProblem = readSeedFiles().length > 0 ? seedPasswordProblem(password) : undefined;
  } catch (err) {
    passwordProblem = err instanceof Error ? err.message : String(err); // 例如種子檔的檔名不對
  }

  if (databaseUrl && (appEnv !== 'development' || !LOCAL_HOSTS.has(host))) {
    console.log(
      `[reset] 已拒絕：只能重建本機的資料庫（APP_ENV 要是 development，DATABASE_URL 的主機要是 127.0.0.1 或 localhost）；現在 APP_ENV=${appEnv}、主機是 ${host}`,
    );
    process.exitCode = 1;
  } else if (databaseUrl && passwordProblem) {
    console.log(`[reset] 沒有清空任何資料：${passwordProblem}`);
    process.exitCode = 1;
  } else if (databaseUrl) {
    await runCli('[reset]', async (db) => {
      await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const migrated = await migrate(db);
      const seeded = await seed(db, { password });
      console.log(
        `[reset] 本機資料庫已重建：Migration ${numberRange(migrated.applied)}、種子資料 ${seeded.files.length} 個檔`,
      );
    });
  }
}
