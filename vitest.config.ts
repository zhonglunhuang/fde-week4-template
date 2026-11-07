// 自動化測試（npm test，含在 make check）：只跑後端的 API 測試。
// 測試連本機資料庫裡的 app_test（globalSetup 自動建立、每次從 000 起重跑全部的 Migration），不動練習用的 app；
// 模板自己的測試改用 app_test_template（只跑模板內建的 000），你們加的 Migration 不會讓它們變紅（backend/test/helpers.ts）。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['backend/test/**/*.test.ts'],
    globalSetup: ['backend/test/setup.ts'],
    environment: 'node',
    // 測試共用同一個資料庫，一次只跑一個檔案，彼此不會互相清掉資料。
    fileParallelism: false,
    // 每個測試檔各自載入程式（Vitest 的預設，這裡寫明）。不要改成 false，也不要加 --no-isolate：
    // Vitest 會說關掉比較快，但關掉之後，測試檔共用同一份 helpers.ts（資料庫連線、用哪一個測試資料庫），
    // 前一個檔案留下的設定會帶到下一個檔案。寫明之後，Vitest 跑完也不會再建議改成 false。
    isolate: true,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
