// 密碼的雜湊（模板內建；沒有票寫明，不要修改 backend/src/auth/）。
//
// - 用 Node.js 內建的 scrypt，每個密碼各自加一段隨機的 salt，資料庫只存雜湊值，不存密碼本身。
// - 存的格式：scrypt$N$r$p$salt$hash（salt 與 hash 是 base64url），之後調整參數，舊的雜湊照樣驗得過。
// - 比對用 timingSafeEqual；帳號不存在時也算一次雜湊，回應時間不會透露帳號存不存在。
import crypto from 'node:crypto';

/** 新密碼至少幾個字（修改密碼與 SEED_USER_PASSWORD 都用這個規則）。 */
export const MIN_PASSWORD_LENGTH = 10;
/** 密碼最多幾個字（擋掉超長的輸入）。 */
export const MAX_PASSWORD_LENGTH = 200;

const COST = 16384; // N：越大越慢、越難暴力破解；16384 約 50 毫秒
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p
const KEY_LENGTH = 32;
const SALT_BYTES = 16;

function scrypt(password: string, salt: Buffer, keyLength: number, options: crypto.ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFC'), salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM });
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64url'), key.toString('base64url')].join('$');
}

interface ParsedHash {
  options: crypto.ScryptOptions;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | undefined {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return undefined;
  const [N = 0, r = 0, p = 0] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return undefined;
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const key = Buffer.from(parts[5] ?? '', 'base64url');
  if (salt.length === 0 || key.length === 0) return undefined;
  return { options: { N, r, p, maxmem: 256 * N * r }, salt, key };
}

let dummyHash: Promise<string> | undefined;

/** 密碼對不對。stored 是 users.password_hash；沒有設定密碼（null）或格式不對，一律當成不對。 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parsed = typeof stored === 'string' ? parseHash(stored) : undefined;
  if (!parsed) {
    // 一樣算一次雜湊，讓「帳號不存在」和「密碼錯」花的時間差不多
    dummyHash ??= hashPassword(crypto.randomBytes(12).toString('hex'));
    const dummy = parseHash(await dummyHash)!;
    await scrypt(password, dummy.salt, dummy.key.length, dummy.options);
    return false;
  }
  const key = await scrypt(password, parsed.salt, parsed.key.length, parsed.options);
  return crypto.timingSafeEqual(key, parsed.key);
}
