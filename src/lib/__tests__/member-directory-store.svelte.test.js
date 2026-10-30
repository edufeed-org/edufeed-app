// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * member-directory store — loads the deployment's NIP-05 directory once per
 * TTL, keeps the old members when a load fails, and prefetches the new
 * members' kind 0s so a name search finds them locally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writable } from 'svelte/store';
import { EMPTY } from 'rxjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const cfg = vi.hoisted(() => ({ runtimeConfig: { membership: { handleDomain: 'edufeed.org' } } }));
const loaders = vi.hoisted(() => ({ fetchEvents: vi.fn() }));

vi.mock('$lib/stores/config.svelte.js', () => ({
  configReady: writable(true),
  runtimeConfig: cfg.runtimeConfig
}));
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents: loaders.fetchEvents }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: () => ['wss://lookup.example']
}));

const store = await import('$lib/stores/member-directory.svelte.js');

/** @param {any} body @param {boolean} [ok] */
const answer = (body, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

beforeEach(() => {
  store._resetMemberDirectory();
  cfg.runtimeConfig.membership = { handleDomain: 'edufeed.org' };
  loaders.fetchEvents.mockReset();
  loaders.fetchEvents.mockReturnValue(EMPTY);
});

describe('ensureMemberDirectory', () => {
  it('reads the full directory of the handle domain and prefetches the members', async () => {
    const fetchImpl = answer({ names: { anna: A, ben: B } });
    await store.ensureMemberDirectory(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://edufeed.org/.well-known/nostr.json',
      expect.anything()
    );
    expect([...store.getMemberPubkeys()]).toEqual([A, B]);
    expect(store.getMemberDirectoryVersion()).toBeGreaterThan(0);
    expect(loaders.fetchEvents).toHaveBeenCalledWith(
      ['wss://lookup.example'],
      { kinds: [0], authors: [A, B] },
      { cache: true }
    );
  });

  it('asks nobody when the deployment has no handle domain', async () => {
    cfg.runtimeConfig.membership = { handleDomain: '' };
    const fetchImpl = answer({ names: { anna: A } });
    await store.ensureMemberDirectory(fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.getMemberPubkeys().size).toBe(0);
  });

  it('does not reload within the TTL', async () => {
    const fetchImpl = answer({ names: { anna: A } });
    await store.ensureMemberDirectory(fetchImpl);
    await store.ensureMemberDirectory(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchImpl = answer({ names: { anna: A } });
    await Promise.all([
      store.ensureMemberDirectory(fetchImpl),
      store.ensureMemberDirectory(fetchImpl)
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the members of the last good load when a reload fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await store.ensureMemberDirectory(answer({ names: { anna: A } }));
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      await store.ensureMemberDirectory(answer({}, false));
      expect([...store.getMemberPubkeys()]).toEqual([A]);
      await store.ensureMemberDirectory(vi.fn(async () => Promise.reject(new Error('offline'))));
      expect([...store.getMemberPubkeys()]).toEqual([A]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefetches only members it has not seen before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await store.ensureMemberDirectory(answer({ names: { anna: A } }));
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      await store.ensureMemberDirectory(answer({ names: { anna: A, ben: B } }));
      expect(loaders.fetchEvents).toHaveBeenLastCalledWith(
        expect.anything(),
        { kinds: [0], authors: [B] },
        expect.anything()
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
