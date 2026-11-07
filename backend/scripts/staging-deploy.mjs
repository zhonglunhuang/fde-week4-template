// 「部署 Staging」（.github/workflows/staging-deploy.yml）：把指定的版本部署到這一組的 Staging。
//
// Staging 由帶組的技術導師代管：Render 的網站連著技術導師名下的「部署用 Repo」的 stage 分支，
// 那個分支一有新的 Commit，Render 就重新打包、部署（Auto-Deploy：On Commit）。這支腳本做的事：
//
// 1. 找出要部署的版本（DEPLOY_REF：stage、標籤 v1.0.0-rc1 或 Commit 編號）的完整 Commit；
//    這個 Commit 一定要已經合併進 stage（回滾到 stage 以前的版本也可以），沒合併的不部署。
// 2. 有設定唯讀連線（STAGING_READONLY_DATABASE_URL）就先備份資料庫：pre-deploy-<短碼>-<台灣時間>.dump。
// 3. 把這個 Commit 強制推到部署用 Repo（STAGING_MIRROR_REPO）的 refs/heads/stage，Render 收到就開始部署。
// 4. 每 10 秒讀一次 STAGING_URL/api/version，等 short 變成這個版本（最多 20 分鐘：免費方案會休眠，
//    叫醒要約 1 分鐘，打包要幾分鐘）。
// 5. 再確認 STAGING_URL/api/health 回 200。
// 6. 寫摘要（台灣時間）：部署完成／版本／開始與完成時間／部署前備份的檔名／怎麼回滾；
//    沒有完成就寫原因與接下來怎麼做。
//
// 合併進 stage 不會部署：部署一定是有人執行這個 workflow。回滾也用它：版本填上一個正常的版本。
// 回滾只換程式，不會還原資料庫。
//
// 環境變數（workflow 帶進來）：DEPLOY_REF、STAGING_URL、STAGING_MIRROR_REPO、STAGING_MIRROR_TOKEN、
// STAGING_READONLY_DATABASE_URL（選填）、RUN_URL（這一次執行的網址）。
// 測試用：STAGING_MIRROR_URL（直接給 git 的網址或資料夾）、DEPLOY_TIMEOUT_SECONDS、DEPLOY_POLL_SECONDS、
// DEPLOY_FETCH_TIMEOUT_SECONDS、DEPLOY_BASE_BRANCH。
import { spawn } from 'node:child_process';
import { BackupError, backupFileName, runBackup } from './staging-backup.mjs';
import { cell, fetchJson, isMain, maskInLog, sleep, taipeiTime, writeOutput, writeSummary } from './staging-common.mjs';

export class DeployError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
  }
}

const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const MIRROR_REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** 執行 git，回傳 { code, stdout, stderr }（不經過 shell，參數不會被當成指令）。 */
export function git(args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function revParse(candidate, cwd) {
  const result = await git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { cwd });
  return result.code === 0 && /^[0-9a-f]{40}$/.test(result.stdout) ? result.stdout : undefined;
}

/**
 * 要部署的版本 → 完整的 Commit。依序找：標籤、遠端分支（origin/…）、本機分支、Commit 編號。
 * 回傳 { sha, short, label }；找不到丟出 DeployError。
 */
export async function resolveRef(ref, { cwd } = {}) {
  const value = String(ref ?? '').trim();
  if (!REF_PATTERN.test(value) || value.includes('..')) {
    throw new DeployError(`「${value || '（空白）'}」不是版本的寫法：填分支（stage）、標籤（例如 v1.0.0-rc1）或 Commit 編號`);
  }
  const candidates = [`refs/tags/${value}`, `refs/remotes/origin/${value}`, `refs/heads/${value}`, value];
  for (const candidate of candidates) {
    const sha = await revParse(candidate, cwd);
    if (sha) return { sha, short: sha.slice(0, 7), label: value };
  }
  throw new DeployError(
    `找不到要部署的版本「${value}」：確認標籤或 Commit 編號有沒有打錯；標籤要先在 GitHub 建好（Releases 或 git push 標籤）`,
  );
}

/** 這個 Commit 是不是已經在 stage 上（合併進 stage，或是 stage 以前的版本）。 */
export async function isOnBaseBranch(sha, { cwd, baseBranch = 'stage' } = {}) {
  for (const ref of [`refs/remotes/origin/${baseBranch}`, `refs/heads/${baseBranch}`]) {
    if (!(await revParse(ref, cwd))) continue;
    const result = await git(['merge-base', '--is-ancestor', sha, ref], { cwd });
    return result.code === 0;
  }
  return false;
}

/** 部署用 Repo 的網址：STAGING_MIRROR_URL（測試用）優先，否則 https://github.com/<STAGING_MIRROR_REPO>.git。 */
export function mirrorUrlFrom(env) {
  if (env.STAGING_MIRROR_URL?.trim()) return env.STAGING_MIRROR_URL.trim();
  const repo = env.STAGING_MIRROR_REPO?.trim();
  if (!repo || !MIRROR_REPO_PATTERN.test(repo)) return undefined;
  return `https://github.com/${repo}.git`;
}

/** 只留 git 錯誤訊息裡 remote:、error:、fatal: 開頭的幾行（不含 Token）。 */
function gitErrorLines(stderr) {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(remote:|error:|fatal:|!)/.test(line))
    .slice(0, 4)
    .join(' ');
}

/** 把 Commit 強制推到部署用 Repo 的 stage。Token 用 git 的 http.extraheader 帶，不放進網址或指令。 */
export async function pushToMirror({ sha, mirrorUrl, token, cwd, env = process.env }) {
  const pushEnv = { ...env, GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    maskInLog(basic, env);
    Object.assign(pushEnv, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    });
  }
  const result = await git(['push', '--force', mirrorUrl, `${sha}:refs/heads/stage`], { cwd, env: pushEnv });
  if (result.code !== 0) {
    const detail = gitErrorLines(result.stderr);
    throw new DeployError(
      `推到部署用 Repo 失敗${detail ? `（${detail}）` : ''}：可能是 STAGING_MIRROR_TOKEN 過期、權限不夠（要 Contents 與 Workflows 的 Read and write），或 STAGING_MIRROR_REPO 寫錯`,
    );
  }
  // 部署用 Repo 本來就是這個 Commit：Render 不會收到新的 Commit，也就不會重新部署
  return { upToDate: /Everything up-to-date/i.test(result.stderr) };
}

/** 經過多久，例如 20 分鐘、30 秒。 */
function duration(ms) {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} 分鐘` : `${Math.max(1, Math.round(ms / 1000))} 秒`;
}

/**
 * 等 Staging 的 /api/version 變成這個版本。回傳 { previous }：第一次看到、還沒換版時的版本（短碼）。
 * 逾時丟出 DeployError（details.last 是最後看到的版本）。
 */
export async function waitForVersion({ stagingUrl, sha, timeoutMs, pollMs, fetchTimeoutMs, log = () => {} }) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let previous;
  let last;
  let lastReport = Date.now();
  for (;;) {
    const response = await fetchJson(`${stagingUrl}/api/version`, {
      timeoutMs: Math.max(1000, Math.min(fetchTimeoutMs, deadline - Date.now())),
    });
    const body = response?.status === 200 ? response.body : undefined;
    const commit = typeof body?.commit === 'string' ? body.commit : undefined;
    const short = typeof body?.short === 'string' ? body.short : undefined;
    if (short) {
      const matches = commit && /^[0-9a-f]{40}$/.test(commit) ? commit === sha : short === sha.slice(0, 7);
      if (matches) return { previous: previous ?? short };
      previous ??= short;
      last = short;
    }
    if (Date.now() >= deadline) {
      throw new DeployError(
        last
          ? `${duration(timeoutMs)}內，Staging 的版本沒有變成 ${sha.slice(0, 7)}（線上還是 ${last}）`
          : `${duration(timeoutMs)}內，Staging 都沒有回應（${stagingUrl}/api/version）`,
        { last },
      );
    }
    if (Date.now() - lastReport >= 60_000) {
      const minutes = Math.round((Date.now() - startedAt) / 60000);
      log(`[deploy] 還在等（已經 ${minutes} 分鐘）：線上${last ? `是 ${last}` : '還沒有回應（可能在休眠中醒來）'}`);
      lastReport = Date.now();
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

/** /api/health 要回 200；最多試 3 次。 */
export async function checkHealth({ stagingUrl, fetchTimeoutMs, pollMs }) {
  let status;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetchJson(`${stagingUrl}/api/health`, { timeoutMs: fetchTimeoutMs });
    status = response?.status;
    if (status === 200) return;
    if (attempt < 3) await sleep(pollMs);
  }
  throw new DeployError(
    `新的版本已經上線，但健康檢查沒有通過（/api/health ${status ? `回 ${status}` : '沒有回應'}）：多半是連不上資料庫`,
  );
}

const ROLLBACK_HOW =
  'Actions →「部署 Staging」→ Run workflow，「要部署的版本」填上一個正常的版本（標籤，例如 v1.0.0-rc1，或 Commit 編號），再按 Run workflow。';

export function successSummary({ target, stagingUrl, startedAt, finishedAt, backupFile, previous, runUrl }) {
  const rollbackTarget =
    previous && previous !== target.short ? `要回到部署前的版本，版本填 \`${previous}\`。` : '';
  return [
    '## 部署完成',
    '',
    '| 項目 | 內容 |',
    '|---|---|',
    `| 版本 | \`${target.short}\`（${cell(target.label)}） |`,
    `| 完整的 Commit | \`${target.sha}\` |`,
    `| 部署前線上的版本 | ${previous ? `\`${previous}\`` : '（沒有回應）'} |`,
    `| Staging | ${stagingUrl} |`,
    `| 開始時間 | ${taipeiTime(startedAt)}（台灣時間） |`,
    `| 完成時間 | ${taipeiTime(finishedAt)}（台灣時間） |`,
    '| 健康檢查 | 正常（/api/health 回 200） |',
    `| 部署前備份 | ${backupFile ? `\`${backupFile}\`（本頁最下面的 Artifacts）` : '沒有做（還沒設定唯讀連線）'} |`,
    '',
    `確認：打開 ${stagingUrl}/api/version，\`short\` 是 \`${target.short}\`；頁面最下面的版本也是 ${target.short}。`,
    '',
    '### 要回到上一個版本（回滾）',
    '',
    `${ROLLBACK_HOW}${rollbackTarget}`,
    '回滾只換程式，不會還原資料庫；要還原資料，請找帶組的技術導師。',
    runUrl ? `\n這一次執行：${runUrl}` : '',
    '',
  ].join('\n');
}

export function failureSummary({ reason, target, startedAt, finishedAt, backupFile, runUrl }) {
  return [
    '## 部署沒有完成',
    '',
    `原因：${cell(reason)}`,
    '',
    '| 項目 | 內容 |',
    '|---|---|',
    `| 要部署的版本 | ${target ? `\`${target.short}\`（${cell(target.label)}）` : '（沒有找到）'} |`,
    `| 開始時間 | ${taipeiTime(startedAt)}（台灣時間） |`,
    `| 結束時間 | ${taipeiTime(finishedAt)}（台灣時間） |`,
    `| 部署前備份 | ${backupFile ? `\`${backupFile}\`（本頁最下面的 Artifacts）` : '沒有'} |`,
    '',
    '### 接下來',
    '',
    `1. 把這一頁的網址傳給帶組的技術導師${runUrl ? `（${runUrl}）` : ''}，他可以在 Render 看打包與啟動的紀錄。`,
    `2. 要回到上一個正常的版本：再執行一次「部署 Staging」。${ROLLBACK_HOW}`,
    '',
  ].join('\n');
}

function seconds(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value * 1000 : fallback;
}

export async function main(env = process.env, { cwd = process.cwd(), log = console.log } = {}) {
  const startedAt = new Date();
  const runUrl = env.RUN_URL?.trim() || undefined;
  let target;
  let backupFile;
  try {
    const stagingUrl = env.STAGING_URL?.trim().replace(/\/+$/, '');
    const mirrorUrl = mirrorUrlFrom(env);
    const token = env.STAGING_MIRROR_TOKEN?.trim();
    const missing = [
      !stagingUrl && 'STAGING_URL（Variables）',
      !mirrorUrl && 'STAGING_MIRROR_REPO（Variables，寫成 帳號/Repo 名稱）',
      !token && !env.STAGING_MIRROR_URL && 'STAGING_MIRROR_TOKEN（Secrets）',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new DeployError(
        `Staging 還沒設定好：缺少 ${missing.join('、')}。設定在 Repo 的 Settings → Secrets and variables → Actions，只有 Repo 擁有者能設定，請找帶組的技術導師`,
      );
    }

    target = await resolveRef(env.DEPLOY_REF || 'stage', { cwd });
    writeOutput('sha', target.sha, env);
    writeOutput('short', target.short, env);
    log(`[deploy] 要部署的版本：${target.label} → ${target.short}（${target.sha}）`);
    const baseBranch = env.DEPLOY_BASE_BRANCH?.trim() || 'stage';
    if (!(await isOnBaseBranch(target.sha, { cwd, baseBranch }))) {
      throw new DeployError(
        `${target.short} 還沒有合併進 ${baseBranch}：Staging 只部署已經合併進 ${baseBranch} 的版本（或 ${baseBranch} 以前的版本）。先開 PR、審查、合併，再部署`,
      );
    }

    const readOnlyUrl = env.STAGING_READONLY_DATABASE_URL?.trim();
    if (readOnlyUrl) {
      log('[deploy] 部署前先備份資料庫……');
      try {
        const backup = await runBackup({
          databaseUrl: readOnlyUrl,
          fileName: backupFileName(`pre-deploy-${target.short}`, startedAt),
        });
        backupFile = backup.file;
        writeOutput('backup-file', backupFile, env);
        log(`[deploy] 部署前備份……完成：${backupFile}`);
      } catch (err) {
        const detail = err instanceof BackupError ? err.message : '發生沒有預期的錯誤';
        throw new DeployError(`部署前的備份沒有完成，所以沒有部署：${detail}`);
      }
    } else {
      log('[deploy] 還沒設定唯讀連線（STAGING_READONLY_DATABASE_URL），沒有做部署前備份');
    }

    const { upToDate } = await pushToMirror({ sha: target.sha, mirrorUrl, token, cwd, env });
    log(
      upToDate
        ? '[deploy] 部署用 Repo 本來就是這個版本（Render 不會重新部署），確認線上的版本……'
        : '[deploy] 推到部署用 Repo……完成，Render 收到後會開始打包與部署',
    );

    const timeoutMs = seconds(env, 'DEPLOY_TIMEOUT_SECONDS', 20 * 60 * 1000);
    const pollMs = seconds(env, 'DEPLOY_POLL_SECONDS', 10_000);
    const fetchTimeoutMs = seconds(env, 'DEPLOY_FETCH_TIMEOUT_SECONDS', 90_000);
    log(`[deploy] 等 Staging 換成 ${target.short}（最多 ${duration(timeoutMs)}）……`);
    let previous;
    try {
      ({ previous } = await waitForVersion({ stagingUrl, sha: target.sha, timeoutMs, pollMs, fetchTimeoutMs, log }));
    } catch (err) {
      if (upToDate && err instanceof DeployError) {
        throw new DeployError(
          `${err.message}。部署用 Repo 本來就是這個版本，Render 沒有收到新的 Commit：請技術導師在 Render 按 Manual Deploy → Deploy latest commit`,
        );
      }
      throw err;
    }
    log(`[deploy] 線上已經是 ${target.short}`);
    await checkHealth({ stagingUrl, fetchTimeoutMs, pollMs });
    log('[deploy] 健康檢查正常');

    writeSummary(
      successSummary({ target, stagingUrl, startedAt, finishedAt: new Date(), backupFile, previous, runUrl }),
      env,
    );
    log(`[deploy] 部署完成：${target.short}`);
    return 0;
  } catch (err) {
    const reason = err instanceof DeployError ? err.message : `發生沒有預期的錯誤（${err?.message ?? err}）`;
    writeSummary(failureSummary({ reason, target, startedAt, finishedAt: new Date(), backupFile, runUrl }), env);
    log(`[deploy] 部署沒有完成：${reason}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main();
