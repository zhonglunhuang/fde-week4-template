// 畫面的路由：一個網址一個頁面（frontend/src/pages/），外框是 AppShell。
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { AppShell } from './components/AppShell';
import { RequireLogin } from './components/RequireLogin';
import { ChangePassword } from './pages/ChangePassword';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="login" element={<Login />} />
            {/* 需要登入的頁面放在 RequireLogin 底下，沒登入會導到 /login，登入後回到原本的頁面 */}
            <Route element={<RequireLogin />}>
              <Route path="password" element={<ChangePassword />} />
              {/* 例如：<Route path="orders" element={<OrderList />} /> */}
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
