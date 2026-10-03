// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * useJoinedCommunitiesState — the list hook must tell "you follow no
 * communities" apart from "your list could not be loaded". On 2026-09-30 an
 * unreachable list rendered as an empty one, the user re-followed a community
 * to "fix" it, and that join replaced the real membership list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { BehaviorSubject } from 'rxjs';

const ME = 'e'.repeat(64);
const C1 = '1'.repeat(64);

/** @type {BehaviorSubject<any>} */
let store$;
let probeResult;
const probeMock = vi.fn();

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: { pubkey: 'e'.repeat(64) },
    active$: { subscribe: () => ({ unsubscribe: () => {} }) }
  }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { replaceable: () => store$ }
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getAllLookupRelays: () => [] }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({ getWriteRelays: async () => [] }));
vi.mock('$lib/helpers/follow-set-probe.js', () => ({
  probeCommunitiesFollowSet: (pk) => probeMock(pk)
}));

const { useJoinedCommunitiesState, useJoinedCommunitiesList } = await import(
  '$lib/stores/joined-communities-list.svelte.js'
);

const followSet = (pubkeys) => ({
  kind: 30000,
  pubkey: ME,
  created_at: 1,
  tags: [['d', 'communities'], ...pubkeys.map((p) => ['p', p])],
  content: ''
});

/** Resolve pending probe promises and let effects settle. */
const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
};

describe('useJoinedCommunitiesState', () => {
  let state;
  let cleanup;

  beforeEach(() => {
    store$ = new BehaviorSubject(undefined);
    probeResult = 'absent';
    probeMock.mockReset();
    probeMock.mockImplementation(async () => probeResult);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const mount = () => {
    cleanup = $effect.root(() => {
      state = useJoinedCommunitiesState();
    });
    flushSync();
  };

  it("is 'loading' while nothing is known yet", () => {
    probeMock.mockImplementation(() => new Promise(() => {}));
    mount();

    expect(state.status()).toBe('loading');
    expect(state.list()).toEqual([]);
  });

  it("is 'ready' with the list as soon as the follow set is in the store", () => {
    probeMock.mockImplementation(() => new Promise(() => {}));
    store$.next(followSet([C1]));
    mount();

    expect(state.status()).toBe('ready');
    expect(state.list()).toEqual([C1]);
  });

  it("is 'ready' and empty only when the network confirmed there is no list", async () => {
    probeResult = 'absent';
    mount();
    await settle();

    expect(state.status()).toBe('ready');
    expect(state.list()).toEqual([]);
  });

  it("is 'unavailable' — not an empty list — when the relays did not answer", async () => {
    probeResult = 'unknown';
    mount();
    await settle();

    expect(state.status()).toBe('unavailable');
  });

  it('recovers when the list arrives after the probe gave up', async () => {
    probeResult = 'unknown';
    mount();
    await settle();

    store$.next(followSet([C1]));
    flushSync();

    expect(state.status()).toBe('ready');
    expect(state.list()).toEqual([C1]);
  });

  it('retry() probes again and can turn unavailable into ready', async () => {
    probeResult = 'unknown';
    mount();
    await settle();
    expect(probeMock).toHaveBeenCalledTimes(1);

    probeResult = 'absent';
    state.retry();
    flushSync();
    expect(state.status()).toBe('loading');
    await settle();

    expect(probeMock).toHaveBeenCalledTimes(2);
    expect(state.status()).toBe('ready');
  });
});

describe('useJoinedCommunitiesList', () => {
  it('does not probe the network — only status-rendering surfaces pay for that', () => {
    probeMock.mockReset();
    const cleanup = $effect.root(() => {
      useJoinedCommunitiesList();
    });
    flushSync();
    expect(probeMock).not.toHaveBeenCalled();
    cleanup();
  });
});
