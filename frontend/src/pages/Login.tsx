// 登入頁：Email 與密碼（模板內建；沒有票寫明，不要修改）。
// 帳號由管理者建立（開發與 Staging 用種子資料）；初始密碼當面告知，第一次登入後到「修改密碼」換掉。
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return '發生錯誤，請稍後再試';
}

export function Login() {
  const { login, user, checking } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const from = (location.state as { from?: string } | null)?.from;
  const next = from && from !== '/login' ? from : '/';
  if (!checking && user && !pending) return <Navigate to={next} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (email.trim() === '' || password === '') {
      setError('請輸入 Email 與密碼');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  return (
    <section className="narrow">
      <h1>登入</h1>
      <form className="form" onSubmit={onSubmit} noValidate>
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
          />
        </label>
        <label>
          密碼
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={pending}>
          {pending ? '登入中…' : '登入'}
        </button>
      </form>
    </section>
  );
}
