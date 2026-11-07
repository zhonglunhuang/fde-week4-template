// 模板內建的 Migration：模板自己的測試只用它們建資料庫（app_test_template，以及測試裡暫時的資料庫），
// 所以你們之後加的 Migration（新的欄位、限制、資料表）不會讓模板的測試變紅。
// 你們自己的測試照常用 app_test（從 000 起跑過 backend/db/migrations/ 的全部 Migration，見 helpers.ts）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MIGRATIONS_DIR } from '../db/migrate.js';

/** 模板內建的 Migration 檔：不改名、不修改、不刪除（要改結構就新增一個 Migration）。 */
export const TEMPLATE_MIGRATIONS = ['000_create_users_and_sessions.sql'];

/** 建一個暫時的資料夾，只放模板內建的 Migration，回傳它的路徑。用完由呼叫的人刪掉。 */
export function templateMigrationsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-template-migrations-'));
  for (const file of TEMPLATE_MIGRATIONS) {
    const source = path.join(MIGRATIONS_DIR, file);
    if (!fs.existsSync(source)) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error(`找不到模板內建的 Migration：backend/db/migrations/${file}（這個檔不能改名或刪除）`);
    }
    fs.copyFileSync(source, path.join(dir, file));
  }
  return dir;
}
