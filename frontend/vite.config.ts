// 前端開發伺服器（npm run dev:web）與正式版打包（npm run build）。
//
// - 只在「啟動時」讀一次 repo 根目錄 .env 的 API_BASE_URL：改了 .env，要重新啟動前端才會生效。
// - 埠用 WEB_PORT（預設 3000）；被佔用就直接停止，不會自己換埠。
// - 提供 /config.js（window.APP_CONFIG）：畫面從這裡拿 API 位址、環境與版本。
//   Staging 的 /config.js 由後端提供（backend/src/app.ts），內容格式相同。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(frontendDir, '..');

interface AppConfig {
  apiBaseUrl: string;
  appEnv: string;
  version: string;
}

function appConfigScript(config: AppConfig): Plugin {
  const body = `window.APP_CONFIG=${JSON.stringify(config)};\n`;
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split('?')[0] !== '/config.js') {
      next();
      return;
    }
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  };
  return {
    name: 'app-config-script',
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const webPort = Number(env.WEB_PORT || 3000);
  const config: AppConfig = {
    apiBaseUrl: (env.API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, ''),
    appEnv: env.APP_ENV || 'development',
    version: 'local',
  };

  return {
    root: frontendDir,
    plugins: [react(), appConfigScript(config)],
    server: { port: webPort, strictPort: true },
    preview: { port: webPort, strictPort: true },
    build: { outDir: path.join(frontendDir, 'dist'), emptyOutDir: true },
  };
});
