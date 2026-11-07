// 資料庫連線（node-postgres 的連線池）。API 裡用 req.db.query() 與 req.db.tx()。
//
//   const { rows } = await req.db.query('SELECT * FROM users WHERE id = $1', [id]);
//   await req.db.tx(async (client) => { ...多個要一起成功或一起失敗的 SQL... });
//
// SQL 的值一律用 $1、$2 帶入，不要把使用者輸入直接接進 SQL 字串。
import pg from 'pg';
import { logger, type Logger } from './logger.js';

export interface Db {
  pool: pg.Pool;
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
  /** 交易：fn 裡的 SQL 全部成功才寫入；任何一個出錯就全部還原，錯誤照樣往外丟。 */
  tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * 連線池的設定。網址裡有 sslmode 或 channel_binding（Neon 給的連線字串會有）時，
 * 拿掉這兩個參數，改用驗證憑證的 SSL；本機的網址沒有這兩個參數，不用 SSL。
 */
export function poolConfig(databaseUrl: string): pg.PoolConfig {
  let connectionString = databaseUrl;
  let ssl: pg.PoolConfig['ssl'];
  try {
    const url = new URL(databaseUrl);
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode !== null || url.searchParams.has('channel_binding')) {
      url.searchParams.delete('sslmode');
      url.searchParams.delete('channel_binding');
      connectionString = url.toString();
      ssl = sslmode === 'disable' ? false : { rejectUnauthorized: true };
    }
  } catch {
    // 網址格式不對：交給 pg 回報原始錯誤。
  }
  return { connectionString, ssl, connectionTimeoutMillis: 2000, idleTimeoutMillis: 10000 };
}

/** 只留主機與資料庫名稱，不含帳號密碼，例如 ep-xxxx.ap-southeast-1.aws.neon.tech/neondb。 */
export function describeDatabase(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return 'unknown';
  }
}

/** 把連線網址的資料庫名稱換掉（測試用 app_test）。 */
export function withDatabaseName(databaseUrl: string, name: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

// 連線網址的帳號密碼有兩種寫法，pg 都看得懂（兩種都有時，以 ?user=…&password=… 為準）：
//   本機（.env.example）：postgres://127.0.0.1:5432/app?user=app&password=local_only
//   Neon 給的：            postgresql://帳號、冒號、密碼、@、主機/資料庫（帳號密碼寫在主機前面）
// 模板的檔案一律用第一種，Day 16 搜尋 Secrets 的指令才不會把練習用的值當成密碼。

/** 連線網址裡的密碼。 */
export function passwordOf(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return url.searchParams.get('password') ?? decodeURIComponent(url.password);
}

/** 把連線網址的帳號換掉（密碼不變），寫法和原本的網址一樣。 */
export function withUser(databaseUrl: string, user: string): string {
  const url = new URL(databaseUrl);
  if (url.searchParams.has('user')) url.searchParams.set('user', user);
  else url.username = encodeURIComponent(user);
  return url.toString();
}

export function createDb(databaseUrl: string, log: Logger = logger): Db {
  const pool = new pg.Pool(poolConfig(databaseUrl));
  // 資料庫停止或重新啟動時，閒置的連線會被切斷，pg 會發出 error 事件。
  // 一定要接住：沒接住的話整個後端會跟著停止。這裡只記 WARN，下一次查詢會重新連線。
  pool.on('error', (err) => log.warn(`database connection lost: ${err.message}`));

  return {
    pool,
    query: (text, params = []) => pool.query({ text, values: params }),
    async tx(fn) {
      const client = await pool.connect();
      const onError = (err: Error) => log.warn(`database connection lost: ${err.message}`);
      client.on('error', onError);
      let broken = false;
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {
          broken = true;
        });
        throw err;
      } finally {
        client.off('error', onError);
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
