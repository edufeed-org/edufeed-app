// @ts-nocheck
/* eslint-disable no-undef -- runes are available in .svelte.js context */
/**
 * useListItems: the items of a NIP-51 list (e and a tags), store first,
 * loaded through loadReferencedEvent (hints + lookup relays, then the
 * author's outboxes) with delayed retries for the ones still missing.
 * Replaces three copies that fetched every item twice (their own
 * fetchEvents beside the store's fallback loader) and never retried.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { flushSync } from 'svelte';

/** @type {Map<string, BehaviorSubject<any>>} */
let sources = new Map();
const keyOf = (p) => (p.id ? 'e:' + p.id : `a:${p.kind}:${p.pubkey}:${p.identifier}`);
const eventSpy = vi.fn((pointer) => {
  const key = keyOf(pointer);
  if (!sources.has(key)) sources.set(key, new BehaviorSubject(undefined));
  return sources.get(key);
});
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { event: (pointer) => eventSpy(pointer) }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.example/']
}));
/** @type {Subject<any>[]} */
let loads = [];
const loadSpy = vi.fn(() => {
  const load$ = new Subject();
  loads.push(load$);
  return load$;
});
vi.mock('$lib/loaders/referenced-event.js', () => ({
  loadReferencedEvent: (pointer, options) => loadSpy(pointer, options)
}));

const { useListItems } = await import('../list-items.svelte.js');

const PK = 'a'.repeat(64);
const ID_A = '1'.repeat(64);
const ID_B = '2'.repeat(64);
const list = {
  id: 'f'.repeat(64),
  kind: 30003,
  pubkey: PK,
  created_at: 1,
  content: '',
  tags: [
    ['d', 'reading'],
    ['e', ID_A, 'wss://hint-a.org/'],
    ['e', ID_B],
    ['a', `30023:${PK}:post`, 'wss://hint-post.org/']
  ]
};
const note = (id) => ({ id, kind: 1, pubkey: PK, created_at: 1, tags: [], content: '' });

function mount(getList, options) {
  let hook;
  const cleanup = $effect.root(() => {
    hook = useListItems(getList, options);
  });
  flushSync();
  return { hook, cleanup };
}

describe('useListItems', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sources = new Map();
    eventSpy.mockClear();
    loadSpy.mockClear();
    loads = [];
  });
  afterEach(() => vi.useRealTimers());

  it('watches every item in the store by identity and keys what arrives', () => {
    const { hook } = mount(() => list);
    expect(eventSpy.mock.calls.map((c) => c[0])).toEqual([
      { id: ID_A },
      { id: ID_B },
      { kind: 30023, pubkey: PK, identifier: 'post' }
    ]);
    sources.get('e:' + ID_A).next(note(ID_A));
    flushSync();
    expect([...hook.items.keys()]).toEqual(['e:' + ID_A]);
    expect(hook.items.get('e:' + ID_A).id).toBe(ID_A);
  });

  it('loads each missing item once through loadReferencedEvent, hints first', () => {
    mount(() => list);
    expect(loadSpy.mock.calls.map((c) => c[0])).toEqual([
      { id: ID_A, relays: ['wss://hint-a.org/', 'wss://lookup.example/'] },
      { id: ID_B, relays: ['wss://lookup.example/'] },
      {
        kind: 30023,
        pubkey: PK,
        identifier: 'post',
        relays: ['wss://hint-post.org/', 'wss://lookup.example/']
      }
    ]);
  });

  it('asks the network only for items the store does not hold', () => {
    sources.set('e:' + ID_A, new BehaviorSubject(note(ID_A)));
    mount(() => list);
    expect(loadSpy.mock.calls.map((c) => c[0].id ?? c[0].identifier)).toEqual([ID_B, 'post']);
  });

  it('retries only the items still missing, after a delay', async () => {
    mount(() => list, { retryDelaysMs: [3000] });
    sources.get('e:' + ID_A).next(note(ID_A));
    sources.get(`a:30023:${PK}:post`).next({ ...note('9'.repeat(64)), kind: 30023 });
    for (const load of loads) load.complete();
    loadSpy.mockClear();

    await vi.advanceTimersByTimeAsync(3000);
    expect(loadSpy.mock.calls.map((c) => c[0].id)).toEqual([ID_B]);
  });

  it('stops everything when the view goes away or the list is gone', async () => {
    const { cleanup } = mount(() => list, { retryDelaysMs: [3000] });
    cleanup();
    for (const source of sources.values()) expect(source.observed).toBe(false);
    for (const load of loads) expect(load.observed).toBe(false);

    loadSpy.mockClear();
    const { hook } = mount(() => null);
    expect(hook.items.size).toBe(0);
    expect(loadSpy).not.toHaveBeenCalled();
  });
});
