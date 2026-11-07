// 修改密碼（模板內建；沒有票寫明，不要修改）：目前的密碼、新密碼、再輸入一次。
// 新密碼至少 10 個字。改好之後，舊密碼不能再登入；已經登入的其他視窗不會被登出。
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { useAuth } from '../auth';

const MIN_LENGTH = 10;

export function ChangePassword() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setDone(false);
    if (currentPassword === '') return setError('請輸入目前的密碼');
    if (newPassword.length < MIN_LENGTH) return setError(`新密碼至少要 ${MIN_LENGTH} 個字`);
    if (newPassword !== confirmPassword) return setError('兩次輸入的新密碼不一樣');
    setPending(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '發生錯誤，請稍後再試');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="narrow">
      <h1>修改密碼</h1>
      <form className="form" onSubmit={onSubmit} noValidate>
        <label>
          目前的密碼
          <input
            type="password"
            name="current-password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            disabled={pending}
          />
        </label>
        <label>
          新密碼
          <input
            type="password"
            name="new-password"
            autoComplete="new-password"
            aria-describedby="new-password-hint"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            disabled={pending}
          />
          <span id="new-password-hint" className="hint">
            至少 {MIN_LENGTH} 個字，不要用其他地方用過的密碼
          </span>
        </label>
        <label>
          再輸入一次新密碼
          <input
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={pending}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="ok" role="status">
            密碼已修改，下次登入請用新密碼
          </p>
        )}
        <button type="submit" className="primary" disabled={pending}>
          {pending ? '修改中…' : '修改密碼'}
        </button>
      </form>
    </section>
  );
}
