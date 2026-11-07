// 後端的進入點：npm run dev:api。
// 啟動順序：讀 .env → 檢查必填設定 → 先連一次資料庫 → 開始接收請求（development 只接受這台電腦自己的連線，見 listen.ts）。
// 任何一步失敗都印出原因並停止（結束代碼 1），不會帶著壞掉的設定繼續跑。
import { createApp } from './app.js';
import { ConfigError, loadConfig, loadEnvFile, type Config } from './config.js';
import { createDb, describeDatabase } from './db.js';
import { listen, type Listener } from './listen.js';
import { errorMessage, logger } from './logger.js';
import { getVersion } from './version.js';

function startupFailed(message: string, hint?: string): void {
  logger.error(`startup failed: ${message}`);
  if (hint) console.log(hint);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  loadEnvFile();
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      startupFailed(err.message, err.hint);
      return;
    }
    throw err;
  }

  const db = createDb(config.databaseUrl);
  try {
    await db.query('SELECT 1');
  } catch (err) {
    // 原始的連線錯誤照印，例如 connect ECONNREFUSED 127.0.0.1:5432
    startupFailed(errorMessage(err));
    await db.close().catch(() => {});
    return;
  }

  const app = createApp({ config, db });
  let listener: Listener;
  try {
    listener = await listen(app, config);
  } catch (err) {
    // 例如 listen EADDRINUSE: address already in use 127.0.0.1:4000（這個埠已經有別的程式在用）
    startupFailed(errorMessage(err));
    await db.close().catch(() => {});
    return;
  }
  logger.info('server started', {
    version: getVersion(),
    port: listener.port,
    // Staging 用這一行核對連的是哪一個資料庫（只印主機與資料庫名稱，不印帳號密碼）
    database: config.appEnv === 'development' ? undefined : describeDatabase(config.databaseUrl),
  });
  console.log(`API 已啟動：http://localhost:${listener.port}`);

  // Render 換版時會送 SIGTERM：先停止接新請求、關掉資料庫連線再結束。
  process.once('SIGTERM', () => {
    void listener
      .close()
      .then(() => db.close())
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

await main();
