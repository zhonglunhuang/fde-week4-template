// 每一頁共用的外框：頁首（專案名稱；登入後是「姓名｜修改密碼｜登出」）、Staging 提示條、最下面的版本（靠右）。
import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { appConfig, PROJECT_NAME } from '../config';

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  async function onLogout() {
    setLeaving(true);
    try {
      await logout();
      navigate('/login');
    } finally {
      setLeaving(false);
    }
  }

  return (
    <>
      {appConfig.appEnv === 'staging' && <div className="env-banner">測試環境（Staging）：只放測試資料</div>}
      <header className="topbar">
        <Link to="/" className="brand">
          {PROJECT_NAME}
        </Link>
        <nav className="account" aria-label="帳號">
          {user ? (
            <>
              <span className="user-name">{user.name}</span>
              <span className="separator" aria-hidden="true">
                ｜
              </span>
              <Link to="/password">修改密碼</Link>
              <span className="separator" aria-hidden="true">
                ｜
              </span>
              <button type="button" className="link-button" onClick={onLogout} disabled={leaving}>
                {leaving ? '登出中…' : '登出'}
              </button>
            </>
          ) : (
            <Link to="/login">登入</Link>
          )}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="version">版本 {appConfig.version}</footer>
    </>
  );
}
