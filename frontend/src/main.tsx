import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('index.html 裡找不到 <div id="root">');

// 不包 StrictMode：開發時它會讓畫面一載入就送的請求送兩次，DevTools 的 Network 會看到兩個 health，容易誤會。
createRoot(root).render(<App />);
