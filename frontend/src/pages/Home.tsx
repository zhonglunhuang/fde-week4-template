// 首頁：顯示專案名稱，以及後端、資料庫的狀態。
// 健康檢查在瀏覽器端呼叫（DevTools 的 Network 看得到 health 這個請求）；重新整理頁面就重新檢查一次。
import { useEffect, useState } from 'react';
import { checkHealth, type HealthState } from '../api';
import { PROJECT_NAME } from '../config';

const LABELS: Record<HealthState | 'checking', { backend: [string, string]; database: [string, string] }> = {
  checking: { backend: ['檢查中…', 'unknown'], database: ['檢查中…', 'unknown'] },
  ok: { backend: ['正常', 'ok'], database: ['正常', 'ok'] },
  database: { backend: ['正常', 'ok'], database: ['異常', 'bad'] },
  unreachable: { backend: ['無法連線', 'bad'], database: ['無法確認', 'unknown'] },
  unexpected: { backend: ['回應不正確（確認 API_BASE_URL 指到這個專案的後端）', 'bad'], database: ['無法確認', 'unknown'] },
};

export function Home() {
  const [health, setHealth] = useState<HealthState | 'checking'>('checking');

  useEffect(() => {
    let cancelled = false;
    checkHealth().then((state) => {
      if (!cancelled) setHealth(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { backend, database } = LABELS[health];
  return (
    <section>
      <h1>{PROJECT_NAME}</h1>
      <ul className="status" aria-live="polite">
        <li>
          後端：<span className={backend[1]}>{backend[0]}</span>
        </li>
        <li>
          資料庫：<span className={database[1]}>{database[0]}</span>
        </li>
      </ul>
    </section>
  );
}
