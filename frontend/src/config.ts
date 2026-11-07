// 執行環境的設定：從 /config.js（window.APP_CONFIG）讀，開發時由 Vite 提供，Staging 由後端提供。

/** 專案名稱：頁首與首頁標題（初始化時換成專案名稱，frontend/index.html 的 <title> 也要一起換）。 */
export const PROJECT_NAME = '練習專案骨架';

interface AppConfig {
  /** 後端 API 的位址，例如 http://localhost:4000 */
  apiBaseUrl: string;
  /** development、staging 或 production */
  appEnv: string;
  /** 線上的版本（Commit 前 7 碼）；本機是 local */
  version: string;
}

declare global {
  interface Window {
    APP_CONFIG?: Partial<AppConfig>;
  }
}

const loaded = window.APP_CONFIG ?? {};

export const appConfig: AppConfig = {
  apiBaseUrl: (loaded.apiBaseUrl ?? 'http://localhost:4000').replace(/\/+$/, ''),
  appEnv: loaded.appEnv ?? 'development',
  version: loaded.version ?? 'local',
};
