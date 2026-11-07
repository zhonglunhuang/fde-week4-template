// Render 的 Build Command：npm run staging:build（設定方式見 docs/staging-mentor.md）。
//
//   [deploy] 部署 9e3b6d0 到 Staging
//   [deploy] 安裝套件……完成
//   [deploy] 打包……完成
//
// 1. 安裝套件：npm ci，連 devDependencies 一起裝（打包要用 TypeScript 與 Vite）。
// 2. 打包：npm run build，後端編譯到 backend/dist，前端打包到 frontend/dist。
// 任何一步失敗：印「[deploy] 打包失敗：線上還是上一版」，結束代碼 1。Render 會判定這次部署失敗，舊版繼續服務。
// 版本是 Render 給的 RENDER_GIT_COMMIT 前 7 碼；本機執行時沒有，顯示 local。
import { spawnSync } from 'node:child_process';

const version = process.env.RENDER_GIT_COMMIT?.trim().slice(0, 7) || 'local';
const windows = process.platform === 'win32';

function step(label, args) {
  const result = spawnSync(windows ? 'npm.cmd' : 'npm', args, { stdio: 'inherit', shell: windows });
  if (result.status !== 0) {
    console.log('[deploy] 打包失敗：線上還是上一版');
    process.exit(1);
  }
  console.log(`[deploy] ${label}……完成`);
}

console.log(`[deploy] 部署 ${version} 到 Staging`);
step('安裝套件', ['ci', '--include=dev', '--no-audit', '--no-fund', '--loglevel=error']);
step('打包', ['run', 'build']);
