/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { postJson } from './apiRoute.fixtures.js';

const BASE_ENV = {
  TERMI_AI_ENABLED: 'true',
  TERMI_EMBED_URL: 'https://embed.example',
  TERMI_EMBED_API_KEY: 'k'
};

/** @param {Request} request @param {string} [ip] */
function ev(request, ip = '1.2.3.4') {
  return { request, getClientAddress: () => ip };
}

/**
 * Fresh import of the route per test, with `$env/dynamic/private` and the
 * router index mocked. `indexBehavior` lets a test control `ready()`/`rank()`
 * of the single module-level index the route creates at import time.
 *
 * @param {Record<string, string>} env
 * @param {{ ready?: boolean, rank?: (...args: any[]) => Promise<any> }} [indexBehavior]
 */
async function importRoute(env, indexBehavior) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const createRouterIndexMock = vi.fn(() => ({
    warmUp: () => Promise.resolve(),
    ready: () => indexBehavior?.ready ?? true,
    rank: indexBehavior?.rank ?? (async () => [{ skill: 'home', score: 0.9 }])
  }));
  vi.doMock('$lib/server/termi/router-index.js', () => ({
    createRouterIndex: createRouterIndexMock
  }));
  const mod = await import('../../routes/api/termi/+server.js');
  return { POST: mod.POST, createRouterIndexMock };
}

afterEach(() => {
  vi.doUnmock('$env/dynamic/private');
  vi.doUnmock('$lib/server/termi/router-index.js');
  vi.useRealTimers();
});

describe('POST /api/termi', () => {
  it('returns 503 when the embed flag/env is off', async () => {
    const { POST, createRouterIndexMock } = await importRoute({});
    const res = await POST(ev(postJson('/api/termi', { text: 'hallo', locale: 'de' })));
    expect(res.status).toBe(503);
    expect(createRouterIndexMock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty text', { text: '', locale: 'de' }],
    ['301-char text', { text: 'a'.repeat(301), locale: 'de' }],
    ['non-string text', { text: 42, locale: 'de' }],
    ['invalid locale', { text: 'hallo', locale: 'fr' }]
  ])('returns 400 for %s', async (_label, body) => {
    const { POST } = await importRoute(BASE_ENV);
    const res = await POST(ev(postJson('/api/termi', body)));
    expect(res.status).toBe(400);
  });

  it('returns 503 when the index is not ready yet', async () => {
    const rank = vi.fn();
    const { POST } = await importRoute(BASE_ENV, { ready: false, rank });
    const res = await POST(ev(postJson('/api/termi', { text: 'hallo', locale: 'de' })));
    expect(res.status).toBe(503);
    expect(rank).not.toHaveBeenCalled();
  });

  it('returns 503 when rank() takes too long (bounded well under the 4s embed delay)', async () => {
    vi.useFakeTimers();
    const { POST } = await importRoute(BASE_ENV, {
      rank: () => new Promise((resolve) => setTimeout(() => resolve([]), 4_000))
    });
    const resPromise = POST(ev(postJson('/api/termi', { text: 'hallo', locale: 'de' })));
    await vi.advanceTimersByTimeAsync(3_500);
    const res = await resPromise;
    expect(res.status).toBe(503);
  });

  it('blocks the 31st request from one IP within the rate window', async () => {
    const { POST } = await importRoute(BASE_ENV);
    /** @type {number[]} */
    const statuses = [];
    for (let i = 0; i < 31; i++) {
      const res = await POST(ev(postJson('/api/termi', { text: 'hallo', locale: 'de' })));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('returns 200 with the ranked matches', async () => {
    const { POST } = await importRoute(BASE_ENV, {
      rank: async () => [{ skill: 'calendar', score: 0.8 }]
    });
    const res = await POST(ev(postJson('/api/termi', { text: 'hallo', locale: 'de' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [{ skill: 'calendar', score: 0.8 }] });
  });

  it('never logs the user text, even when rank() fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const marker = 'secret-user-text-marker-xyz';
    const { POST } = await importRoute(BASE_ENV, {
      rank: async () => {
        throw new Error('boom');
      }
    });
    const res = await POST(ev(postJson('/api/termi', { text: marker, locale: 'de' })));
    expect(res.status).toBe(503);

    const allArgs = [...errorSpy.mock.calls, ...logSpy.mock.calls, ...warnSpy.mock.calls].flat();
    for (const arg of allArgs) {
      expect(String(arg)).not.toContain(marker);
    }
    errorSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
