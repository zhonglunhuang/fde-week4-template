// Render 的 Start Command：npm run staging:start（設定方式見 docs/staging-mentor.md）。
// 每次部署、重新啟動，以及回滾到舊版時，都會執行一次。
//
//   [deploy] 執行 Migration：004_add_note_to_examples……完成    （沒有新的就印「沒有新的 Migration」）
//   [deploy] 種子資料：已經有帳號，略過                        （資料庫還沒有任何帳號時才放入，密碼是 SEED_USER_PASSWORD）
//   [deploy] 啟動新版 9e3b6d0，Render 健康檢查通過後才會切換
//   2026-11-19T14:41:07.882+08:00 INFO  server started version=9e3b6d0 port=10000 database=ep-xxxx.ap-southeast-1.aws.neon.tech/neondb
//
// 1. 檢查 DATABASE_URL、SESSION_SECRET、API_BASE_URL：缺少或空值就印 ERROR，結束代碼 1。
//    新版起不來，Render 判定這次部署失敗，舊版繼續服務。
// 2. API_BASE_URL 指到 localhost：只印 WARN，照常啟動（畫面會連不到後端，Log 要看得到這個狀況）。
// 3. 執行 Migration，再放種子資料（資料庫還沒有帳號才放；沒有設定 SEED_USER_PASSWORD 只印警告，照常啟動）。
//    回滾到舊版時，資料庫有、舊版沒有的 Migration 只印「略過」，不會擋下啟動。
// 4. 啟動後端（backend/dist/src/server.js），之後的 Log 都是後端印的。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(repoRoot, 'backend', 'dist');
const version = process.env.RENDER_GIT_COMMIT?.trim().slice(0, 7) || 'local';

/** 和後端的 Log 同一個格式：台灣時間（Render 的主機用 UTC 也一樣）、等級佔 5 格。 */
function log(level, message) {
  const time = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
  console.log(`${time} ${level.padEnd(5)} ${message}`);
}

const missing = ['DATABASE_URL', 'SESSION_SECRET', 'API_BASE_URL'].filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  log('ERROR', `startup failed: missing required environment ${missing.length > 1 ? 'variables' : 'variable'} ${missing.join(', ')}`);
  console.log(`缺少環境變數 ${missing.join('、')}，請參考 .env.example，到 Render 的 Environment 補上`);
  process.exit(1);
}

const apiBaseUrl = process.env.API_BASE_URL.trim();
if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(apiBaseUrl)) {
  log('WARN', `API_BASE_URL points to this machine (${apiBaseUrl}); browsers will not reach this server`);
}

// Render 上忘了設 APP_ENV 時當成 staging：Cookie 加 Secure、前端由後端提供
process.env.APP_ENV ||= 'staging';

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(dist, script), ...args], { stdio: 'inherit', cwd: repoRoot });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(path.join('db', 'migrate.js'), ['--deploy']);
run(path.join('db', 'seed.js'), ['--if-empty', '--deploy']);

console.log(`[deploy] 啟動新版 ${version}，Render 健康檢查通過後才會切換`);
await import(pathToFileURL(path.join(dist, 'src', 'server.js')).href);
