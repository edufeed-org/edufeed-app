// @ts-nocheck
/** @vitest-environment node */
// probeRelay: one REQ for the user's own kind 10002 on exactly one relay.
// Completing (EOSE) is proof of reachability — with or without the event; a
// relay that refuses with auth-required/restricted is reachable too; only a
// transport failure counts as unreachable, and a deadline without any answer
// is 'timeout', which is no evidence either way.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, throwError, NEVER } from 'rxjs';

const request = vi.fn();
const getInformation = vi.fn(async () => null);
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    request: (...args) => request(...args),
    relay: () => ({ getInformation: () => getInformation() })
  }
}));

import {
  probeRelay,
  probeAndRecord,
  loadRelayHealthHistory,
  RELAY_HEALTH_STORAGE_KEY
} from '$lib/services/relay-health.js';

const PK = 'a'.repeat(64);
const list = { kind: 10002, pubkey: PK, id: 'e'.repeat(64), tags: [['r', 'wss://x.example']] };

beforeEach(() => {
  request.mockReset();
  getInformation.mockReset();
  getInformation.mockResolvedValue(null);
});

describe('probeRelay', () => {
  it('asks exactly that relay for the user’s kind 10002', async () => {
    request.mockReturnValue(of(list));
    await probeRelay('wss://x.example', PK, { timeoutMs: 100 });
    expect(request).toHaveBeenCalledTimes(1);
    const [relays, filter] = request.mock.calls[0];
    expect(relays).toEqual(['wss://x.example']);
    expect(filter).toMatchObject({ kinds: [10002], authors: [PK], limit: 1 });
  });

  it('is ok + holdsList when the relay answers with the list', async () => {
    request.mockReturnValue(of(list));
    const r = await probeRelay('wss://x.example', PK, { timeoutMs: 100 });
    expect(r.status).toBe('ok');
    expect(r.holdsList).toBe(true);
    expect(typeof r.rttMs).toBe('number');
  });

  it('is ok without holdsList when the relay answers EOSE with nothing', async () => {
    request.mockReturnValue(of());
    const r = await probeRelay('wss://x.example', PK, { timeoutMs: 100 });
    expect(r).toMatchObject({ status: 'ok', holdsList: false });
  });

  it('is unreachable on a transport error', async () => {
    request.mockReturnValue(throwError(() => new Error('WebSocket connection failed')));
    const r = await probeRelay('wss://x.example', PK, { timeoutMs: 100 });
    expect(r).toMatchObject({ status: 'unreachable', holdsList: false, rttMs: null });
  });

  it('treats an auth-required / restricted refusal as reachable', async () => {
    request.mockReturnValue(throwError(() => new Error('auth-required: you must auth')));
    expect((await probeRelay('wss://x.example', PK, { timeoutMs: 100 })).status).toBe('ok');
    request.mockReturnValue(throwError(() => new Error('restricted: not a member')));
    expect((await probeRelay('wss://x.example', PK, { timeoutMs: 100 })).status).toBe('ok');
  });

  it('reads the reason out of a RelayGroupError-shaped outcome map', async () => {
    const err = Object.assign(new Error('all relays failed'), {
      outcomes: { 'wss://x.example/': { error: new Error('auth-required: nope') } }
    });
    request.mockReturnValue(throwError(() => err));
    expect((await probeRelay('wss://x.example', PK, { timeoutMs: 100 })).status).toBe('ok');
  });

  it('is timeout when nothing at all comes back in time', async () => {
    request.mockReturnValue(NEVER);
    const r = await probeRelay('wss://x.example', PK, { timeoutMs: 20 });
    expect(r.status).toBe('timeout');
  });

  it('attaches the NIP-11 document when the relay has one, null otherwise', async () => {
    request.mockReturnValue(of());
    getInformation.mockResolvedValue({ name: 'X', limitation: { auth_required: true } });
    const r = await probeRelay('wss://x.example', PK, { timeoutMs: 100 });
    expect(r.info).toEqual({ name: 'X', limitation: { auth_required: true } });

    getInformation.mockRejectedValue(new Error('no nip11'));
    expect((await probeRelay('wss://x.example', PK, { timeoutMs: 100 })).info).toBeNull();
  });
});

describe('probeAndRecord', () => {
  /** In-memory localStorage stand-in. */
  function fakeStorage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k)
    };
  }

  it('records ok and unreachable outcomes, but not timeouts', async () => {
    const storage = fakeStorage();
    request.mockImplementation(([url]) =>
      url.includes('dead')
        ? throwError(() => new Error('connect failed'))
        : url.includes('slow')
          ? NEVER
          : of()
    );
    const now = Date.UTC(2026, 9, 27);
    const { results, history } = await probeAndRecord(
      ['wss://ok.example', 'wss://dead.example', 'wss://slow.example'],
      PK,
      { timeoutMs: 20, now, storage }
    );
    expect(results.get('wss://ok.example').status).toBe('ok');
    expect(results.get('wss://dead.example').status).toBe('unreachable');
    expect(results.get('wss://slow.example').status).toBe('timeout');
    expect(history['wss://ok.example'].lastSuccessAt).toBe(now);
    expect(history['wss://dead.example'].firstFailedAt).toBe(now);
    expect(history['wss://slow.example']).toBeUndefined();
    // persisted
    expect(loadRelayHealthHistory(storage)).toEqual(history);
    expect(storage.getItem(RELAY_HEALTH_STORAGE_KEY)).toContain('dead.example');
  });

  it('survives corrupt storage', () => {
    const storage = fakeStorage();
    storage.setItem(RELAY_HEALTH_STORAGE_KEY, '{not json');
    expect(loadRelayHealthHistory(storage)).toEqual({});
  });
});
