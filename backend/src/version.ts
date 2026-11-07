// 線上的版本：Render 部署時會給 RENDER_GIT_COMMIT（這次部署的 Commit）；本機沒有，顯示 local。
//
//   GET /api/version（不用登入）
//   {"commit":"9e3b6d0a1c…（40 碼）","short":"9e3b6d0","startedAt":"2026-11-20T11:18:30.123+08:00"}
//
// - 「部署 Staging」用它確認線上已經換成要部署的版本（short 一樣才算部署完成）。
// - 頁尾的「版本 9e3b6d0」、啟動的 Log、健康檢查（development 以外）的 version 也是這個值。
// - startedAt 是這一次啟動的時間（台灣時間）：重新部署或重新啟動就會變。
import { Router } from 'express';
import { formatTimestamp } from './logger.js';

const STARTED_AT = formatTimestamp();

export interface VersionInfo {
  /** 完整的 Commit 編號；本機是 local */
  commit: string;
  /** 前 7 碼；本機是 local */
  short: string;
  /** 這一次啟動的時間（台灣時間） */
  startedAt: string;
}

export function versionInfo(env: NodeJS.ProcessEnv = process.env): VersionInfo {
  const commit = env.RENDER_GIT_COMMIT?.trim() || 'local';
  return { commit, short: commit === 'local' ? 'local' : commit.slice(0, 7), startedAt: STARTED_AT };
}

/** 版本的短碼，例如 9e3b6d0；本機是 local。 */
export function getVersion(env: NodeJS.ProcessEnv = process.env): string {
  return versionInfo(env).short;
}

export const versionRouter = Router();

versionRouter.get('/api/version', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(versionInfo());
});
