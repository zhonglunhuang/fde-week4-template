import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <section>
      <h1>找不到這個頁面</h1>
      <p>網址可能打錯了，或這個頁面還沒有做。</p>
      <p>
        <Link to="/">回首頁</Link>
      </p>
    </section>
  );
}
