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
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';

const eventSpy = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { event: (pointer) => eventSpy(pointer) }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.example/']
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

  it('subscribes to the store with that pointer and shows a stored event at once', () => {
    source.next(article);
    const { hook } = mount(naddr);
    expect(eventSpy).toHaveBeenCalledWith(pointerFor(naddr));
    expect(hook.event).toBe(article);
    expect(hook.isLoading).toBe(false);
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
