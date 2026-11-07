// 登入狀態：誰登入了、登入、登出、修改密碼（模板內建；沒有票寫明，不要修改）。畫面用 useAuth() 取得。
// 登入資訊放在 HttpOnly 的 Cookie（畫面讀不到），這裡只記「這個瀏覽器登入過」，
// 有登入過才去問後端 /api/auth/me，沒登入過的人打開首頁時不會多一個 401 的請求。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

/** 登入者：後端 users 的整列（不含密碼）；之後用 Migration 加的欄位（例如 employee_no）也會在這裡。 */
export interface User {
  id: number;
  email: string;
  name: string;
  role: string | null;
  [column: string]: unknown;
}

interface AuthState {
  user: User | null;
  /** 正在向後端確認登入狀態 */
  checking: boolean;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

const LOGGED_IN_HINT = 'app_logged_in';

function hasLoginHint(): boolean {
  try {
    return window.localStorage.getItem(LOGGED_IN_HINT) === '1';
  } catch {
    return false;
  }
}

function setLoginHint(loggedIn: boolean): void {
  try {
    if (loggedIn) window.localStorage.setItem(LOGGED_IN_HINT, '1');
    else window.localStorage.removeItem(LOGGED_IN_HINT);
  } catch {
    // 瀏覽器不允許儲存時，就每次都當成沒登入過
  }
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(() => hasLoginHint());

  useEffect(() => {
    if (!hasLoginHint()) return;
    let cancelled = false;
    api<User>('/api/auth/me')
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        if (!cancelled) setLoginHint(false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: { email, password } });
    setLoginHint(true);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setLoginHint(false);
      setUser(null);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
  }, []);

  const value = useMemo(
    () => ({ user, checking, login, logout, changePassword }),
    [user, checking, login, logout, changePassword],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useAuth 要放在 <AuthProvider> 裡面使用');
  return state;
}
