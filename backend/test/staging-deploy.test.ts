// 「部署 Staging」的腳本（backend/scripts/staging-deploy.mjs）：用本機的 git 代替 GitHub，
// 一個 bare repo 當「部署用 Repo」，一個本機的 HTTP 伺服器當 Staging（看到部署用 Repo 的 stage 變了，
// 等幾次再換成新版本，模擬 Render 的打包與部署）。不需要資料庫，也不連外。
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mirrorUrlFrom, pushToMirror, resolveRef } from '../scripts/staging-deploy.mjs';
import { REPO_ROOT } from '../src/config.js';

const SCRIPT = path.join(REPO_ROOT, 'backend', 'scripts', 'staging-deploy.mjs');
const GIT_IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@test.example', '-c', 'commit.gpgsign=false'];

let root: string;
let work: string;
let mirror: string;
const commits: Record<string, string> = {};

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8' }).trim();
}

function mirrorStage(): string | undefined {
  try {
    return execFileSync('git', ['--git-dir', mirror, 'rev-parse', '--verify', '--quiet', 'refs/heads/stage'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-deploy-'));
  work = path.join(root, 'work');
  mirror = path.join(root, 'mirror.git');
  fs.mkdirSync(work);
  gitIn(work, 'init', '-q', '-b', 'stage');
  for (const name of ['first', 'second']) {
    fs.writeFileSync(path.join(work, `${name}.txt`), name);
    gitIn(work, 'add', '.');
    gitIn(work, 'commit', '-q', '-m', name);
    commits[name] = gitIn(work, 'rev-parse', 'HEAD');
  }
  gitIn(work, 'tag', 'v1.0.0-rc1', commits.first!);
  gitIn(work, 'switch', '-q', '-c', 'feature/not-merged');
  fs.writeFileSync(path.join(work, 'feature.txt'), 'feature');
  gitIn(work, 'add', '.');
  gitIn(work, 'commit', '-q', '-m', 'feature');
  commits.feature = gitIn(work, 'rev-parse', 'HEAD');
  gitIn(work, 'switch', '-q', 'stage');
  execFileSync('git', ['init', '-q', '--bare', mirror]);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 假的 Staging：/api/version 回目前「上線」的 Commit；部署用 Repo 換了之後，等 deployAfter 次才換版。 */
interface FakeStaging {
  url: string;
  online: string;
  health: number;
  deployAfter: number;
  /** true：部署用 Repo 怎麼換都不換版（模擬 Render 打包失敗） */
  stuck: boolean;
  requests: string[];
  close(): Promise<void>;
}

async function fakeStaging(online: string): Promise<FakeStaging> {
  let pending = 0;
  const state = { online, health: 200, deployAfter: 2, stuck: false, requests: [] as string[] };
  const server = http.createServer((req, res) => {
    state.requests.push(req.url ?? '');
    const target = mirrorStage();
    if (!state.stuck && target && target !== state.online) {
      pending += 1;
      if (pending > state.deployAfter) {
        state.online = target;
        pending = 0;
      }
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/version') {
      res.end(JSON.stringify({ commit: state.online, short: state.online.slice(0, 7), startedAt: '2026-11-20T11:18:30.000+08:00' }));
    } else if (req.url === '/api/health') {
      res.statusCode = state.health;
      res.end(JSON.stringify(state.health === 200 ? { status: 'ok', database: 'ok' } : { status: 'error', database: 'error' }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(state, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

interface Run {
  code: number | null;
  stdout: string;
  summary: string;
  outputs: Record<string, string>;
}

/** 照 workflow 的方式執行腳本（非同步：假的 Staging 在同一個程式裡回應）。 */
function deploy(env: Record<string, string>): Promise<Run> {
  const summaryFile = path.join(root, `summary-${crypto.randomUUID()}.md`);
  const outputFile = path.join(root, `output-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(summaryFile, '');
  fs.writeFileSync(outputFile, '');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: work,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? root,
        USERPROFILE: process.env.USERPROFILE ?? root,
        SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        STAGING_MIRROR_URL: mirror,
        DEPLOY_POLL_SECONDS: '0.05',
        DEPLOY_TIMEOUT_SECONDS: '3',
        DEPLOY_FETCH_TIMEOUT_SECONDS: '2',
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_OUTPUT: outputFile,
        RUN_URL: 'https://github.example/runs/1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const outputs = Object.fromEntries(
        fs
          .readFileSync(outputFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('=') as [string, string]),
      );
      resolve({ code, stdout, summary: fs.readFileSync(summaryFile, 'utf8'), outputs });
    });
  });
}

let staging: FakeStaging;
beforeEach(async () => {
  await staging?.close();
  staging = await fakeStaging('0'.repeat(40));
});
afterAll(async () => {
  await staging?.close();
});

describe('找出要部署的版本', () => {
  it('分支、標籤、完整或縮短的 Commit 編號都可以', async () => {
    expect((await resolveRef('stage', { cwd: work })).sha).toBe(commits.second);
    expect((await resolveRef('v1.0.0-rc1', { cwd: work })).sha).toBe(commits.first);
    expect((await resolveRef(commits.first!.slice(0, 7), { cwd: work })).sha).toBe(commits.first);
    expect(await resolveRef(commits.second!, { cwd: work })).toEqual({
      sha: commits.second,
      short: commits.second!.slice(0, 7),
      label: commits.second,
    });
  });

  it('不是版本寫法的輸入（例如 git 的選項）直接拒絕', async () => {
    for (const ref of ['--upload-pack=touch x', 'stage..main', '', 'a b']) {
      await expect(resolveRef(ref, { cwd: work })).rejects.toThrow('不是版本的寫法');
    }
  });

  it('部署用 Repo：STAGING_MIRROR_REPO 寫成 帳號/Repo 名稱', () => {
    expect(mirrorUrlFrom({ STAGING_MIRROR_REPO: 'mentor-a/heri-2026a-g2-staging' })).toBe(
      'https://github.com/mentor-a/heri-2026a-g2-staging.git',
    );
    expect(mirrorUrlFrom({ STAGING_MIRROR_REPO: 'https://github.com/x/y' })).toBeUndefined();
    expect(mirrorUrlFrom({})).toBeUndefined();
  });
});

describe('部署（node backend/scripts/staging-deploy.mjs）', () => {
  it('部署標籤 v1.0.0-rc1：推到部署用 Repo 的 stage、等到線上換版、健康檢查 200，摘要寫部署完成', async () => {
    const fakeToken = `github_pat_${crypto.randomBytes(12).toString('hex')}`;
    const run = await deploy({ DEPLOY_REF: 'v1.0.0-rc1', STAGING_URL: staging.url, STAGING_MIRROR_TOKEN: fakeToken });
    expect(run.code, run.stdout).toBe(0);
    for (const text of [run.stdout, run.summary]) {
      expect(text).not.toContain(fakeToken);
      expect(text).not.toContain(Buffer.from(`x-access-token:${fakeToken}`).toString('base64'));
    }
    expect(mirrorStage()).toBe(commits.first);
    expect(staging.online).toBe(commits.first);
    expect(staging.requests).toContain('/api/health');
    expect(run.outputs).toEqual({ sha: commits.first, short: commits.first!.slice(0, 7) });
    expect(run.summary).toContain('## 部署完成');
    expect(run.summary).toContain(`| 版本 | \`${commits.first!.slice(0, 7)}\`（v1.0.0-rc1） |`);
    expect(run.summary).toContain(`| 完整的 Commit | \`${commits.first}\` |`);
    expect(run.summary).toMatch(/\| 開始時間 \| \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（台灣時間） \|/);
    expect(run.summary).toMatch(/\| 完成時間 \| \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（台灣時間） \|/);
    expect(run.summary).toContain('| 部署前備份 | 沒有做（還沒設定唯讀連線） |');
    expect(run.summary).toContain('### 要回到上一個版本（回滾）');
    expect(run.stdout).toContain('[deploy] 部署完成');
  });

  it('接著部署 stage，再用 Commit 編號回滾到上一個版本：摘要寫出部署前線上的版本', async () => {
    staging.online = commits.first!;
    execFileSync('git', ['--git-dir', mirror, 'update-ref', 'refs/heads/stage', commits.first!]);
    const forward = await deploy({ DEPLOY_REF: 'stage', STAGING_URL: staging.url });
    expect(forward.code, forward.stdout).toBe(0);
    expect(staging.online).toBe(commits.second);
    expect(forward.summary).toContain(`| 部署前線上的版本 | \`${commits.first!.slice(0, 7)}\` |`);
    expect(forward.summary).toContain(`要回到部署前的版本，版本填 \`${commits.first!.slice(0, 7)}\`。`);

    const rollback = await deploy({ DEPLOY_REF: commits.first!.slice(0, 7), STAGING_URL: staging.url });
    expect(rollback.code, rollback.stdout).toBe(0);
    expect(mirrorStage()).toBe(commits.first);
    expect(staging.online).toBe(commits.first);
  });

  it('還沒合併進 stage 的分支：不部署', async () => {
    const before = mirrorStage();
    const run = await deploy({ DEPLOY_REF: 'feature/not-merged', STAGING_URL: staging.url });
    expect(run.code).toBe(1);
    expect(run.summary).toContain('## 部署沒有完成');
    expect(run.summary).toContain(`原因：${commits.feature!.slice(0, 7)} 還沒有合併進 stage`);
    expect(mirrorStage()).toBe(before);
  });

  it('找不到的版本：不部署，摘要寫原因與接下來怎麼做', async () => {
    const run = await deploy({ DEPLOY_REF: 'v9.9.9', STAGING_URL: staging.url });
    expect(run.code).toBe(1);
    expect(run.summary).toContain('## 部署沒有完成');
    expect(run.summary).toContain('原因：找不到要部署的版本「v9.9.9」');
    expect(run.summary).toContain('1. 把這一頁的網址傳給帶組的技術導師（https://github.example/runs/1）');
    expect(run.summary).toContain('2. 要回到上一個正常的版本：再執行一次「部署 Staging」。');
  });

  it('時間內線上一直沒換版（例如 Render 打包失敗）：部署沒有完成，寫出線上還是哪一版', async () => {
    staging.stuck = true;
    const online = staging.online.slice(0, 7);
    const run = await deploy({ DEPLOY_REF: 'stage', STAGING_URL: staging.url, DEPLOY_TIMEOUT_SECONDS: '0.5' });
    expect(run.code).toBe(1);
    expect(run.summary).toContain(`Staging 的版本沒有變成 ${commits.second!.slice(0, 7)}（線上還是 ${online}）`);
  });

  it('新版上線但健康檢查沒過（例如連不上資料庫）：部署沒有完成', async () => {
    staging.health = 503;
    const run = await deploy({ DEPLOY_REF: 'stage', STAGING_URL: staging.url });
    expect(run.code).toBe(1);
    expect(run.summary).toContain('新的版本已經上線，但健康檢查沒有通過（/api/health 回 503）');
  });

  it('Staging 還沒設定好：說明缺什麼、去哪裡設定', async () => {
    const run = await deploy({ DEPLOY_REF: 'stage', STAGING_URL: '', STAGING_MIRROR_URL: '' });
    expect(run.code).toBe(1);
    expect(run.summary).toContain('Staging 還沒設定好：缺少 STAGING_URL（Variables）、STAGING_MIRROR_REPO（Variables，寫成 帳號/Repo 名稱）、STAGING_MIRROR_TOKEN（Secrets）');
  });
});

describe('推到部署用 Repo', () => {
  it('帶著 Token（用 http.extraheader，不放進網址）也推得上去；同一個版本再推一次是 up-to-date', async () => {
    const fakeToken = `github_pat_${crypto.randomBytes(12).toString('hex')}`;
    const result = await pushToMirror({ sha: commits.second!, mirrorUrl: mirror, token: fakeToken, cwd: work });
    expect(result).toEqual({ upToDate: expect.any(Boolean) });
    expect(mirrorStage()).toBe(commits.second);
    const again = await pushToMirror({ sha: commits.second!, mirrorUrl: mirror, token: fakeToken, cwd: work });
    expect(again.upToDate).toBe(true);
  });
});
