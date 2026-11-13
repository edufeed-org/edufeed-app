/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { createModelStatus } from '../termi/model-status.js';

const list = (/** @type {any[]} */ data) => ({ ok: true, json: async () => ({ data }) });

describe('createModelStatus', () => {
  it('maps status and demand to ready / busy / down and names', async () => {
    const fetch = vi.fn(async () =>
      list([
        { id: 'a', name: 'A', status: 'ready', demand: 0 },
        { id: 'b', name: 'B', status: 'ready', demand: 3 },
        { id: 'c', name: 'C', status: 'offline', demand: 0 }
      ])
    );
    const s = createModelStatus({ baseUrl: 'https://x/v1', apiKey: 'k', fetch });
    expect(await s.get()).toEqual({
      a: { name: 'A', state: 'ready' },
      b: { name: 'B', state: 'busy' },
      c: { name: 'C', state: 'down' }
    });
    expect(fetch.mock.calls[0][0]).toBe('https://x/v1/models');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
  });

  it('fetches once per TTL', async () => {
    let t = 0;
    const fetch = vi.fn(async () => list([{ id: 'a', status: 'ready', demand: 0 }]));
    const s = createModelStatus({ baseUrl: 'u', apiKey: 'k', fetch, now: () => t, ttlMs: 100 });
    await Promise.all([s.get(), s.get()]);
    t = 50;
    await s.get();
    expect(fetch).toHaveBeenCalledTimes(1);
    t = 150;
    await s.get();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good copy when a fetch fails, {} when none', async () => {
    let t = 0;
    let fail = true;
    const fetch = vi.fn(async () => {
      if (fail) throw new Error('boom');
      return list([{ id: 'a', status: 'ready', demand: 0 }]);
    });
    const s = createModelStatus({ baseUrl: 'u', apiKey: 'k', fetch, now: () => t, ttlMs: 10 });
    expect(await s.get()).toEqual({});
    fail = false;
    t = 20;
    expect((await s.get()).a.state).toBe('ready');
    fail = true;
    t = 40;
    expect((await s.get()).a.state).toBe('ready');
  });
});
