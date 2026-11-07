// 後端開始接收請求的位置（npm run dev:api 與 Staging 都從這裡開始）。
// - development：只接受這台電腦自己的連線，綁本機的兩個位址：127.0.0.1（IPv4）與 ::1（IPv6）。
//   瀏覽器打 http://localhost:4000 時常常先試 ::1。只綁 127.0.0.1 的話，這個埠如果剛好有別的程式
//   在接聽「所有網路介面」，localhost 會連到那個程式，畫面卻看不出來。兩個都綁，
//   localhost、127.0.0.1、::1 都會連到這個後端；同一個網路（例如教室的 Wi-Fi）的其他電腦連不進來。
//   本機的練習資料與測試帳號只給自己用，不能讓別人連。
//   這台電腦沒有 IPv6（綁 ::1 時回 EADDRNOTAVAIL 或 EAFNOSUPPORT）就只綁 127.0.0.1。
// - 其他環境（Staging）：Render 從主機外面把請求轉進來，所以監聽所有網路介面。
// 埠被佔用（例如另一個分頁的後端還開著）時丟出原本的錯誤，例如 listen EADDRINUSE: address already in use 127.0.0.1:4000。
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { Config } from './config.js';
import { errorMessage, logger } from './logger.js';

/** development 接收連線的位址：只有這台電腦自己。 */
export const DEVELOPMENT_HOSTS = ['127.0.0.1', '::1'] as const;

/** 綁 ::1 時，代表「這台電腦沒有 IPv6」的錯誤：略過 ::1，只用 127.0.0.1。 */
const IPV6_UNAVAILABLE = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);

export interface Listener {
  /** 實際接收連線的埠（設定成 0 時由系統挑一個） */
  port: number;
  /** 每一個接收連線的位址，例如 127.0.0.1 與 ::1 */
  addresses: AddressInfo[];
  /** 停止接收新的連線，等進行中的請求結束 */
  close(): Promise<void>;
}

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
    ? err.code
    : undefined;
}

/** 開始接收連線；開始之前的錯誤（例如 EADDRINUSE）丟出去，開始之後的錯誤只記 Log，後端不會因此停止。 */
function listenOn(app: Express, port: number, host?: string): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      server.on('error', (err) => logger.error(`server error: ${errorMessage(err)}`));
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    if (host === undefined) server.listen(port);
    else server.listen(port, host);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export async function listen(app: Express, config: Pick<Config, 'appEnv' | 'port'>): Promise<Listener> {
  const servers: http.Server[] = [];
  if (config.appEnv === 'development') {
    const [ipv4Host, ipv6Host] = DEVELOPMENT_HOSTS;
    const ipv4 = await listenOn(app, config.port, ipv4Host);
    servers.push(ipv4);
    // 埠設成 0 時由系統挑，::1 用同一個埠
    const port = (ipv4.address() as AddressInfo).port;
    try {
      servers.push(await listenOn(app, port, ipv6Host));
    } catch (err) {
      if (!IPV6_UNAVAILABLE.has(errorCode(err) ?? '')) {
        await closeServer(ipv4);
        throw err;
      }
    }
  } else {
    servers.push(await listenOn(app, config.port));
  }

  const addresses = servers.map((server) => server.address() as AddressInfo);
  return {
    port: addresses[0]!.port,
    addresses,
    close: async () => {
      await Promise.all(servers.map(closeServer));
    },
  };
}
