// 測試開始前跑一次（vitest 的 globalSetup）：準備兩個測試專用的資料庫（不會動到練習用的 app）。
// 1. 把 DATABASE_URL 的資料庫名稱換成 app_test 與 app_test_template，沒有就建立。
// 2. 兩個都清空重建，確保每次測試都從同一個結構開始：
//    - app_test：從 000 起重跑 backend/db/migrations/ 的全部 Migration。你們自己的測試用它（helpers.ts 的預設）。
//    - app_test_template：只跑模板內建的 000。模板自己的測試（檔案開頭呼叫 useTemplateDatabase()）用它，
//      所以你們加了欄位、限制、資料表之後，模板的測試照樣通過。
import fs from 'node:fs';
import type { TestProject } from 'vitest/node';
import { migrate } from '../db/migrate.js';
import { loadEnvFile } from '../src/config.js';
import { createDb, withDatabaseName } from '../src/db.js';
import { errorMessage } from '../src/logger.js';
import { templateMigrationsDir } from './template-migrations.js';

export const TEST_DATABASE_NAME = 'app_test';
export const TEMPLATE_TEST_DATABASE_NAME = 'app_test_template';

declare module 'vitest' {
  export interface ProvidedContext {
    /** app_test：跑過全部的 Migration */
    testDatabaseUrl: string;
    /** app_test_template：只跑過模板內建的 Migration（000） */
    templateTestDatabaseUrl: string;
  }
}

/** 清空這個資料庫，再從 000 起執行 dir 裡的 Migration（沒給 dir 就是 backend/db/migrations/）。 */
async function rebuild(url: string, name: string, dir?: string): Promise<void> {
  const db = createDb(url);
  try {
    await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await migrate(db, { dir, print: () => {} });
  } catch (err) {
    throw new Error(`準備測試資料庫 ${name} 時，執行 Migration 失敗：${errorMessage(err)}`, { cause: err });
  } finally {
    await db.close();
  }
}

async function prepareTestDatabases(): Promise<{ testUrl: string; templateUrl: string }> {
  loadEnvFile();
  const baseUrl = process.env.DATABASE_URL?.trim();
  if (!baseUrl) throw new Error('測試需要 DATABASE_URL（寫在 .env 或環境變數），請參考 .env.example');

  const admin = createDb(baseUrl);
  try {
    for (const name of [TEST_DATABASE_NAME, TEMPLATE_TEST_DATABASE_NAME]) {
      const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (rows.length === 0) await admin.query(`CREATE DATABASE ${name}`);
    }
  } catch (err) {
    throw new Error(
      `連不上資料庫：${errorMessage(err)}（先執行 docker compose up -d db，等 docker compose ps 顯示 healthy）`,
      { cause: err },
    );
  } finally {
    await admin.close();
  }

  const testUrl = withDatabaseName(baseUrl, TEST_DATABASE_NAME);
  await rebuild(testUrl, TEST_DATABASE_NAME);

  const templateUrl = withDatabaseName(baseUrl, TEMPLATE_TEST_DATABASE_NAME);
  const dir = templateMigrationsDir();
  try {
    await rebuild(templateUrl, TEMPLATE_TEST_DATABASE_NAME, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { testUrl, templateUrl };
}

export default async function setup(project: TestProject): Promise<void> {
  try {
    const { testUrl, templateUrl } = await prepareTestDatabases();
    project.provide('testDatabaseUrl', testUrl);
    project.provide('templateTestDatabaseUrl', templateUrl);
  } catch (err) {
    // 這裡丟出的錯誤，vitest 顯示前會先整理 Stack Trace，目前的版本會在整理時自己出錯
    // （畫面只剩 code.charCodeAt is not a function），蓋掉真正的原因。
    // 所以先把 stack 設成訊息本身，畫面一定看得到原因。
    const error = new Error(`測試沒辦法開始。${errorMessage(err)}`);
    error.stack = error.message;
    throw error;
  }
}
