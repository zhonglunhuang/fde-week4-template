// 「備份 Staging 資料庫」的腳本（backend/scripts/staging-backup.mjs）。
// 真正的備份要 docker（GitHub Actions 上有），這裡換成一個假的 docker，只檢查流程：
// 檔名、連線字串只用環境變數傳、pg_restore --list 確認讀得出來、錯誤訊息不露出連線資訊、摘要的內容。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  backupFailureSummary,
  BackupError,
  backupFileName,
  backupSummary,
  runBackup,
} from '../scripts/staging-backup.mjs';
import { postgresMessage, taipeiStamp, taipeiTime } from '../scripts/staging-common.mjs';

let dir: string;
let fakeDocker: string;

// 假的 docker：pg_dump 寫出 PGDMP 開頭的內容；pg_restore --list 讀標準輸入，印出目錄。
// 收到的參數寫進 args.json，測試用來確認連線字串沒有出現在指令裡。
const FAKE_DOCKER = `
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const log = path.join(process.env.FAKE_DOCKER_DIR, 'args.json');
const seen = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
seen.push({ args, pgurl: process.env.PGURL ?? null });
fs.writeFileSync(log, JSON.stringify(seen));
if (args.includes('pg_restore')) {
  const input = fs.readFileSync(0);
  if (!input.subarray(0, 5).equals(Buffer.from('PGDMP'))) { process.stderr.write('pg_restore: error: input file does not appear to be a valid archive'); process.exit(1); }
  process.stdout.write(';\\n; Archive created at 2026-11-20 11:18:30\\n;\\n215; 1259 16390 TABLE public users app\\n216; 1259 16400 TABLE public sessions app\\n3350; 0 16390 TABLE DATA public users app\\n');
} else if (process.env.FAKE_DOCKER_FAIL === 'dump') {
  process.stderr.write('pg_dump: error: connection to server at "ep-quiet-river-123456.ap-southeast-1.aws.neon.tech" (13.228.1.2), port 5432 failed: FATAL:  password authentication failed for user "staging_reader"\\n');
  process.exit(1);
} else {
  process.stdout.write(Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(2048, 1)]));
}
`;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-backup-'));
  fakeDocker = path.join(dir, 'fake-docker.mjs');
  fs.writeFileSync(fakeDocker, FAKE_DOCKER);
  process.env.FAKE_DOCKER_DIR = dir;
});

afterEach(() => {
  delete process.env.FAKE_DOCKER_FAIL;
  fs.rmSync(path.join(dir, 'args.json'), { force: true });
});

afterAll(() => {
  delete process.env.FAKE_DOCKER_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const DATABASE_URL = 'postgresql://ep-quiet-river-123456.ap-southeast-1.aws.neon.tech/neondb?user=staging_reader&password=never-shown-5678&sslmode=require';
const AT = new Date('2026-11-20T03:18:30Z'); // 台灣時間 2026-11-20 11:18:30

function seenCalls(): { args: string[]; pgurl: string | null }[] {
  return JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8'));
}

describe('檔名與時間', () => {
  it('用台灣時間：staging-YYYYMMDD-HHMMSS.dump；部署前的備份是 pre-deploy-<短碼>-…', () => {
    expect(taipeiStamp(AT)).toBe('20261120-111830');
    expect(taipeiTime(AT)).toBe('2026-11-20 11:18:30');
    expect(backupFileName('staging', AT)).toBe('staging-20261120-111830.dump');
    expect(backupFileName('pre-deploy-9e3b6d0', AT)).toBe('pre-deploy-9e3b6d0-20261120-111830.dump');
    // 台灣時間已經是隔天的凌晨（UTC 還是前一天）
    expect(taipeiStamp(new Date('2026-11-19T17:05:00Z'))).toBe('20261120-010500');
  });
});

describe('執行備份', () => {
  it('pg_dump 存成檔案，再用 pg_restore --list 確認讀得出來；連線字串只用環境變數傳進 Container', async () => {
    const result = await runBackup({
      databaseUrl: DATABASE_URL,
      fileName: backupFileName('staging', AT),
      dir,
      docker: [process.execPath, fakeDocker],
    });
    expect(result).toEqual({
      file: 'staging-20261120-111830.dump',
      filePath: path.join(dir, 'staging-20261120-111830.dump'),
      bytes: 2053,
      entries: 3,
    });
    expect(fs.readFileSync(result.filePath).subarray(0, 5).toString()).toBe('PGDMP');

    const [dump, list] = seenCalls();
    expect(dump!.args).toEqual([
      'run', '--rm', '-e', 'PGURL', 'postgres:17-alpine',
      'sh', '-c', 'exec pg_dump --format=custom --no-owner --no-privileges --dbname="$PGURL"',
    ]);
    expect(dump!.pgurl).toBe(DATABASE_URL);
    expect(list!.args).toEqual(['run', '--rm', '-i', 'postgres:17-alpine', 'pg_restore', '--list']);
    expect(list!.pgurl).toBeNull();
    expect(JSON.stringify(seenCalls().map((call) => call.args))).not.toContain('never-shown');
  });

  it('連不上或密碼不對：只留 PostgreSQL 的那一句，不露出主機；不留下壞掉的檔案', async () => {
    process.env.FAKE_DOCKER_FAIL = 'dump';
    const fileName = backupFileName('staging', new Date('2026-11-20T04:00:00Z'));
    const attempt = runBackup({ databaseUrl: DATABASE_URL, fileName, dir, docker: [process.execPath, fakeDocker] });
    await expect(attempt).rejects.toBeInstanceOf(BackupError);
    await expect(attempt).rejects.toThrow('資料庫回應：password authentication failed for user "staging_reader"');
    await attempt.catch((err: Error) => {
      expect(err.message).not.toMatch(/neon\.tech|13\.228|never-shown/);
    });
    expect(fs.existsSync(path.join(dir, fileName))).toBe(false);
  });

  it('還沒設定唯讀連線：請他找技術導師', async () => {
    await expect(runBackup({ databaseUrl: undefined, dir, docker: [process.execPath, fakeDocker] })).rejects.toThrow(
      '還沒設定 Staging 的唯讀連線（STAGING_READONLY_DATABASE_URL），請找帶組的技術導師',
    );
  });

  it('沒有 docker：說明沒辦法執行', async () => {
    await expect(
      runBackup({ databaseUrl: DATABASE_URL, dir, docker: [path.join(dir, 'no-such-docker')] }),
    ).rejects.toThrow('沒辦法執行 docker');
  });
});

describe('摘要', () => {
  it('備份完成：檔名、台灣時間、大小、原因、執行的人、還原只由技術導師做', () => {
    const summary = backupSummary({
      result: { file: 'staging-20261120-111830.dump', bytes: 49_356, entries: 12 },
      reason: '修改 Staging 的資料之前',
      actor: 'student-a',
      startedAt: AT,
    });
    expect(summary).toContain('## 備份完成');
    expect(summary).toContain('| 檔名 | `staging-20261120-111830.dump` |');
    expect(summary).toContain('| 時間 | 2026-11-20 11:18:30（台灣時間） |');
    expect(summary).toContain('| 大小 | 48.2 KB（12 個項目，pg_restore 讀得出來） |');
    expect(summary).toContain('| 原因 | 修改 Staging 的資料之前 |');
    expect(summary).toContain('| 執行的人 | student-a |');
    expect(summary).toContain('- 下載：本頁最下面的 Artifacts（保留 30 天）。');
    expect(summary).toContain('還原只由技術導師做');
  });

  it('原因裡的 | 與換行不會弄壞表格', () => {
    const summary = backupSummary({
      result: { file: 'x.dump', bytes: 10, entries: 1 },
      reason: '第一行|第二行\n第三行',
      actor: 'a',
      startedAt: AT,
    });
    expect(summary).toContain('| 原因 | 第一行｜第二行 第三行 |');
  });

  it('沒有完成：原因與接下來怎麼做', () => {
    const summary = backupFailureSummary({ reason: '修資料之前', error: '資料庫回應：permission denied for table orders' });
    expect(summary).toContain('## 備份沒有完成');
    expect(summary).toContain('原因：資料庫回應：permission denied for table orders');
    expect(summary).toContain('不要繼續修改 Staging 的資料');
  });

  it('PostgreSQL 的錯誤：只取 ERROR／FATAL 後面那一句，連線網址換掉', () => {
    expect(postgresMessage('pg_dump: error: query failed: ERROR:  permission denied for table orders\npg_dump: detail: Query was: LOCK TABLE public.orders')).toBe(
      'permission denied for table orders',
    );
    expect(postgresMessage('FATAL: could not connect to postgresql://somewhere/neondb')).toBe('could not connect to （連線網址）');
    expect(postgresMessage('沒有 PostgreSQL 的訊息')).toBeUndefined();
  });
});
