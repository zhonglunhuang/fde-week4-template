import { once } from 'node:events';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/config.js';
import { listen, type Listener } from '../src/listen.js';
import { closeTestDb, createTestApp, useTemplateDatabase } from './helpers.js';

// 模板內建的測試，用只跑過模板 Migration（000）的資料庫：你們加的 Migration 不會讓它變紅。你們自己的測試不要照抄這一行
useTemplateDatabase(import.meta.url);
afterAll(closeTestDb);

/** 這台電腦在區域網路上的 IPv4 位址（例如 Wi-Fi 的 192.168.x.x），同一個網路的其他電腦用它連進來；沒有網路就是 undefined。 */
function lanAddress(): string | undefined {
  return Object.values(os.networkInterfaces())
    .flat()
    .find((info) => info?.family === 'IPv4' && !info.internal)?.address;
}

/** 這台電腦有沒有 IPv6 的本機位址 ::1（有些電腦或 Container 關掉了 IPv6）。 */
async function hasIpv6Loopback(): Promise<boolean> {
  const probe = net.createServer();
  try {
    probe.listen(0, '::1');
    await once(probe, 'listening');
    return true;
  } catch {
    return false;
  } finally {
    probe.close();
  }
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/** 對這個位址打健康檢查，回傳收到的內容（用來分辨是不是連到我們的後端）。 */
async function healthBody(host: string, port: number): Promise<string> {
  const res = await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${port}/api/health`);
  return res.text();
}

const OUR_HEALTH = JSON.stringify({ status: 'ok', database: 'ok' });

/** 用 npm run dev:api 同一個方式開始接收請求（埠用 0，讓系統挑一個沒人用的）。 */
function start(appEnv: AppEnv, port = 0): Promise<Listener> {
  return listen(createTestApp({ appEnv }), { appEnv, port });
}

let ipv6 = false;
beforeAll(async () => {
  ipv6 = await hasIpv6Loopback();
});

describe('後端接收連線的位置', () => {
  it('development：只綁本機的 127.0.0.1 與 ::1，localhost 的每一個位址都連到這個後端', async () => {
    const listener = await start('development');
    try {
      const hosts = listener.addresses.map((address) => address.address).sort();
      expect(hosts).toEqual(ipv6 ? ['127.0.0.1', '::1'] : ['127.0.0.1']);
      expect(new Set(listener.addresses.map((address) => address.port))).toEqual(new Set([listener.port]));
      expect(await healthBody('127.0.0.1', listener.port)).toBe(OUR_HEALTH);
      if (ipv6) expect(await healthBody('::1', listener.port)).toBe(OUR_HEALTH);
      expect(await healthBody('localhost', listener.port)).toBe(OUR_HEALTH);
    } finally {
      await listener.close();
    }
  });

  it.skipIf(!lanAddress())('development：同一個網路的其他電腦（這台電腦的區域網路位址）連不進來', async () => {
    const listener = await start('development');
    try {
      expect(await canConnect(lanAddress()!, listener.port)).toBe(false);
      expect(await canConnect('127.0.0.1', listener.port)).toBe(true);
    } finally {
      await listener.close();
    }
  });

  it('development：埠已經被另一個後端（例如忘了關的分頁）佔用：停止並回報 EADDRINUSE，原本的照常運作', async () => {
    const first = await start('development');
    try {
      await expect(start('development', first.port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(await healthBody('127.0.0.1', first.port)).toBe(OUR_HEALTH);
    } finally {
      await first.close();
    }
  });

  it('development：別的程式在同一個埠接聽所有網路介面：回報 EADDRINUSE，或 localhost 全部連到這個後端，不會連到別人', async () => {
    const other = http.createServer((_req, res) => res.end('OTHER'));
    other.listen(0);
    await once(other, 'listening');
    const { port } = other.address() as AddressInfo;
    try {
      let listener: Listener | undefined;
      try {
        listener = await start('development', port);
      } catch (err) {
        // Linux、Windows：作業系統直接拒絕，後端停止並印出 EADDRINUSE
        expect(err).toMatchObject({ code: 'EADDRINUSE' });
        return;
      }
      // macOS：允許綁更明確的本機位址，這時 localhost 的每一個位址都要連到這個後端
      try {
        expect(await healthBody('127.0.0.1', port)).toBe(OUR_HEALTH);
        if (ipv6) expect(await healthBody('::1', port)).toBe(OUR_HEALTH);
        expect(await healthBody('localhost', port)).toBe(OUR_HEALTH);
      } finally {
        await listener.close();
      }
    } finally {
      other.closeAllConnections();
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it('Staging：監聽所有網路介面（Render 從主機外面把請求轉進來）', async () => {
    const listener = await start('staging');
    try {
      expect(listener.addresses).toHaveLength(1);
      expect(['::', '0.0.0.0']).toContain(listener.addresses[0]!.address);
    } finally {
      await listener.close();
    }
  });
});
