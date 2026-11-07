// 「備份 Staging 資料庫」（.github/workflows/staging-backup.yml），也是「部署 Staging」的部署前備份。
//
// 1. 用唯讀帳號（STAGING_READONLY_DATABASE_URL，技術導師建的 staging_reader）執行 pg_dump，
//    存成 backups/staging-20261120-111830.dump（custom 格式，檔名是台灣時間）。
// 2. 用 pg_restore --list 確認備份檔讀得出來，數一數裡面有幾個項目。
// 3. 寫摘要：檔名、時間、大小、原因、執行的人；檔名寫進 GITHUB_OUTPUT 的 file，下一步上傳成 Artifact。
//
// - pg_dump 與 pg_restore 在 docker 的 postgres:17-alpine 裡執行（和 Staging 一樣是 PostgreSQL 17）。
//   連線字串用環境變數傳進 Container（docker run -e PGURL），不會出現在指令或 Log 裡。
// - 錯誤只顯示 PostgreSQL 的那一句（例如 permission denied for table orders），不顯示連線資訊。
// - 還原只由技術導師做（docs/staging-mentor.md）。
//
//   STAGING_READONLY_DATABASE_URL=… BACKUP_REASON=… node backend/scripts/staging-backup.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cell,
  formatBytes,
  isMain,
  postgresMessage,
  taipeiStamp,
  taipeiTime,
  writeOutput,
  writeSummary,
} from './staging-common.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BACKUP_DIR = path.join(REPO_ROOT, 'backups');
export const POSTGRES_IMAGE = 'postgres:17-alpine';
export const RETENTION_DAYS = 30;

export class BackupError extends Error {}

/** 備份檔名：<前綴>-<台灣時間>.dump，例如 staging-20261120-111830.dump。 */
export function backupFileName(prefix = 'staging', date = new Date()) {
  return `${prefix}-${taipeiStamp(date)}.dump`;
}

/** 執行一個指令；stdout 寫進 output（檔案描述子）或收集成文字。 */
function run(command, args, { env, input, output } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: [input === undefined ? 'ignore' : input, output === undefined ? 'pipe' : output, 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * 執行備份，回傳 { file, filePath, bytes, entries }；失敗丟出 BackupError（訊息不含連線資訊）。
 * docker：執行 docker 的指令（測試時換成假的）。
 * @param {{ databaseUrl?: string, fileName?: string, dir?: string, image?: string, docker?: string[] }} options
 * @returns {Promise<{ file: string, filePath: string, bytes: number, entries: number }>}
 */
export async function runBackup({
  databaseUrl,
  fileName = backupFileName(),
  dir = BACKUP_DIR,
  image = POSTGRES_IMAGE,
  docker = ['docker'],
}) {
  if (!databaseUrl) {
    throw new BackupError('還沒設定 Staging 的唯讀連線（STAGING_READONLY_DATABASE_URL），請找帶組的技術導師');
  }
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  const [command, ...prefix] = docker;
  const env = { ...process.env, PGURL: databaseUrl };

  const dumpFd = fs.openSync(filePath, 'w');
  let dump;
  let spawnError;
  try {
    dump = await run(
      command,
      [
        ...prefix,
        'run', '--rm', '-e', 'PGURL', image,
        'sh', '-c', 'exec pg_dump --format=custom --no-owner --no-privileges --dbname="$PGURL"',
      ],
      { env, output: dumpFd },
    );
  } catch (err) {
    spawnError = err;
  } finally {
    fs.closeSync(dumpFd);
  }
  if (spawnError) {
    fs.rmSync(filePath, { force: true });
    throw new BackupError(`沒辦法執行 docker（${spawnError.code ?? spawnError.message}）`);
  }
  if (dump.code !== 0) {
    fs.rmSync(filePath, { force: true });
    const message = postgresMessage(dump.stderr);
    throw new BackupError(
      message ? `資料庫回應：${message}` : '連不上 Staging 的資料庫，或唯讀帳號沒有權限（請找帶組的技術導師）',
    );
  }

  const inputFd = fs.openSync(filePath, 'r');
  let list;
  try {
    list = await run(command, [...prefix, 'run', '--rm', '-i', image, 'pg_restore', '--list'], {
      env: process.env,
      input: inputFd,
    });
  } finally {
    fs.closeSync(inputFd);
  }
  const entries = list.stdout.split('\n').filter((line) => line.trim() !== '' && !line.startsWith(';')).length;
  if (list.code !== 0 || entries === 0) {
    throw new BackupError('備份檔讀不出來（pg_restore --list 失敗），請重新執行一次；再失敗請找帶組的技術導師');
  }
  return { file: fileName, filePath, bytes: fs.statSync(filePath).size, entries };
}

export function backupSummary({ result, reason, actor, startedAt }) {
  return [
    '## 備份完成',
    '',
    '| 項目 | 內容 |',
    '|---|---|',
    `| 檔名 | \`${result.file}\` |`,
    `| 時間 | ${taipeiTime(startedAt)}（台灣時間） |`,
    `| 大小 | ${formatBytes(result.bytes)}（${result.entries} 個項目，pg_restore 讀得出來） |`,
    `| 原因 | ${cell(reason || '（沒有填）')} |`,
    `| 執行的人 | ${cell(actor || '（不明）')} |`,
    '',
    `- 下載：本頁最下面的 Artifacts（保留 ${RETENTION_DAYS} 天）。`,
    '- 把檔名記進變更紀錄。',
    '- 還原只由技術導師做：要還原時，把檔名與這一頁的網址給帶組的技術導師。',
    '',
  ].join('\n');
}

export function backupFailureSummary({ reason, error }) {
  return [
    '## 備份沒有完成',
    '',
    `原因：${cell(error)}`,
    '',
    `- 這次的原因（你填的）：${cell(reason || '（沒有填）')}`,
    '- 備份沒有完成時，不要繼續修改 Staging 的資料；把這一頁的網址傳給帶組的技術導師。',
    '',
  ].join('\n');
}

async function main() {
  const startedAt = new Date();
  const reason = process.env.BACKUP_REASON?.trim() ?? '';
  const actor = process.env.GITHUB_ACTOR ?? '';
  console.log(`[backup] 開始備份 Staging 資料庫（${taipeiTime(startedAt)}，台灣時間）`);
  try {
    const result = await runBackup({
      databaseUrl: process.env.STAGING_READONLY_DATABASE_URL?.trim(),
      fileName: backupFileName('staging', startedAt),
    });
    writeOutput('file', result.file);
    writeSummary(backupSummary({ result, reason, actor, startedAt }));
    console.log(`[backup] 完成：${result.file}（${formatBytes(result.bytes)}，${result.entries} 個項目）`);
  } catch (err) {
    const error = err instanceof BackupError ? err.message : '發生沒有預期的錯誤，請找帶組的技術導師';
    writeSummary(backupFailureSummary({ reason, error }));
    console.log(`[backup] 沒有完成：${error}`);
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) await main();
