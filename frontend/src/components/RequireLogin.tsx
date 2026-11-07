// 需要登入的頁面放在 <Route element={<RequireLogin />}> 底下：沒登入就導到 /login，登入後回到原本的頁面。
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

export function RequireLogin() {
  const { user, checking } = useAuth();
  const location = useLocation();

  if (checking) return <p className="hint">確認登入狀態中…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
