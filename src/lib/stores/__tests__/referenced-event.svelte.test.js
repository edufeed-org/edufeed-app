// @ts-nocheck
/* eslint-disable no-undef -- runes are available in .svelte.js context */
/**
 * useReferencedEvent: inline previews resolve their reference through the
 * EventStore (store first, late arrivals included) instead of a one-shot
 * fetch with a hard timeout.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { flushSync } from 'svelte';

const eventSpy = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { event: (pointer) => eventSpy(pointer) }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.example/']
}));
/** @type {Subject<any>[]} one per network attempt */
let loads = [];
const loadSpy = vi.fn(() => {
  const load$ = new Subject();
  loads.push(load$);
  return load$;
});
vi.mock('$lib/loaders/referenced-event.js', () => ({
  loadReferencedEvent: (pointer, options) => loadSpy(pointer, options)
}));

const { useReferencedEvent, pointerFor } = await import('../referenced-event.svelte.js');

const A = 'a'.repeat(64);
const naddr = {
  success: true,
  type: 'naddr',
  data: { kind: 30023, pubkey: A, identifier: 'post', relays: ['wss://hint.example/'] },
  identifier: 'naddr1…'
};
const article = {
  id: 'e'.repeat(64),
  kind: 30023,
  pubkey: A,
  created_at: 1,
  tags: [['d', 'post']],
  content: ''
};

function mount(decoded, options) {
  let hook;
  const cleanup = $effect.root(() => {
    hook = useReferencedEvent(() => decoded, options);
  });
  flushSync();
  return { hook, cleanup };
}

describe('useReferencedEvent', () => {
  let source;
  beforeEach(() => {
    vi.useFakeTimers();
    source = new BehaviorSubject(undefined);
    eventSpy.mockReset();
    eventSpy.mockImplementation(() => source);
    loadSpy.mockClear();
    loads = [];
  });
  afterEach(() => vi.useRealTimers());

  it('builds the pointer from the reference: hints first, then the lookup relays', () => {
    expect(pointerFor(naddr)).toEqual({
      kind: 30023,
      pubkey: A,
      identifier: 'post',
      relays: ['wss://hint.example/', 'wss://lookup.example/']
    });
    expect(pointerFor({ success: true, type: 'nevent', data: { id: 'x', relays: [] } })).toEqual({
      id: 'x',
      relays: ['wss://lookup.example/']
    });
    expect(pointerFor({ success: true, type: 'note', data: 'y' })).toEqual({
      id: 'y',
      relays: ['wss://lookup.example/']
    });
    expect(pointerFor({ success: true, type: 'npub', data: A })).toBeNull();
    expect(pointerFor({ success: false })).toBeNull();
  });

  it('subscribes to the store by identity and shows a stored event at once, without the network', () => {
    source.next(article);
    const { hook } = mount(naddr);
    expect(eventSpy).toHaveBeenCalledWith({ kind: 30023, pubkey: A, identifier: 'post' });
    expect(hook.event).toBe(article);
    expect(hook.isLoading).toBe(false);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  // The store's own fallback loader runs once per model and models stay warm
  // for 60 s keyed by their pointer: a miss there used to be inherited by
  // every remount (a quote on the note's detail page) until a full reload.
  it('loads from the network on every mount, with the reference author for the outbox fallback', () => {
    const nevent = {
      success: true,
      type: 'nevent',
      data: { id: 'x'.repeat(64), relays: ['wss://hint.example/'], author: A }
    };
    mount(nevent).cleanup();
    mount(nevent);
    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(loadSpy).toHaveBeenLastCalledWith(pointerFor(nevent), { author: A });
    expect(eventSpy).toHaveBeenLastCalledWith({ id: 'x'.repeat(64) });
  });

  it('retries after a miss and stops after the configured attempts', async () => {
    mount(naddr, { retryDelaysMs: [3000, 10000] });
    loads[0].complete();
    await vi.advanceTimersByTimeAsync(3000);
    expect(loadSpy).toHaveBeenCalledTimes(2);
    loads[1].complete();
    await vi.advanceTimersByTimeAsync(10000);
    expect(loadSpy).toHaveBeenCalledTimes(3);
    loads[2].complete();
    await vi.advanceTimersByTimeAsync(60000);
    expect(loadSpy).toHaveBeenCalledTimes(3);
  });

  it('does not retry once the event arrived, and cancels a pending retry on unmount', async () => {
    const { cleanup } = mount(naddr, { retryDelaysMs: [3000] });
    source.next(article);
    loads[0].complete();
    await vi.advanceTimersByTimeAsync(10000);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    cleanup();

    source = new BehaviorSubject(undefined);
    const second = mount(naddr, { retryDelaysMs: [3000] });
    loads[1].complete();
    second.cleanup();
    await vi.advanceTimersByTimeAsync(10000);
    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(loads[1].observed).toBe(false);
  });

  it('upgrades from the placeholder when the event arrives late, even after the loading grace', () => {
    const { hook } = mount(naddr, { timeoutMs: 1000 });
    expect(hook.isLoading).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(hook.isLoading).toBe(false);
    expect(hook.event).toBeNull();
    source.next(article);
    expect(hook.event).toBe(article);
  });

  it('is not loading for an identifier it cannot resolve', () => {
    const { hook } = mount({ success: false, identifier: 'garbage' });
    expect(hook.isLoading).toBe(false);
    expect(eventSpy).not.toHaveBeenCalled();
  });

  it('unsubscribes when the component goes away', () => {
    const { cleanup } = mount(naddr);
    expect(source.observed).toBe(true);
    cleanup();
    expect(source.observed).toBe(false);
  });
});
