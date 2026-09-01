// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { flushSync } from 'svelte';

let replaceableSubject;
let addressLoaderSubject;
const addressLoaderMock = vi.fn();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: vi.fn(() => replaceableSubject)
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: (pointer) => {
    addressLoaderMock(pointer);
    return addressLoaderSubject;
  }
}));

const POINTER = {
  kind: 30818,
  pubkey: 'a'.repeat(64),
  identifier: 'some-topic',
  relays: ['wss://relay.test']
};

const EVENT = {
  kind: 30818,
  pubkey: POINTER.pubkey,
  tags: [['d', POINTER.identifier]],
  content: 'hello'
};

describe('useReplaceableEvent', () => {
  /** @type {typeof import('$lib/stores/replaceable-event.svelte.js').useReplaceableEvent} */
  let useReplaceableEvent;

  beforeEach(async () => {
    replaceableSubject = new Subject();
    addressLoaderSubject = new Subject();
    addressLoaderMock.mockClear();
    vi.useFakeTimers();
    const mod = await import('$lib/stores/replaceable-event.svelte.js');
    useReplaceableEvent = mod.useReplaceableEvent;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in the loading state when the EventStore is cold', () => {
    let getState;
    const cleanup = $effect.root(() => {
      getState = useReplaceableEvent(() => POINTER);
    });
    flushSync();

    expect(getState().loading).toBe(true);
    expect(getState().event).toBeUndefined();
    expect(getState().notFound).toBe(false);

    cleanup();
  });

  it('fires the addressLoader with the supplied pointer', () => {
    const cleanup = $effect.root(() => {
      useReplaceableEvent(() => POINTER);
    });
    flushSync();

    expect(addressLoaderMock).toHaveBeenCalledWith(POINTER);

    cleanup();
  });

  it('renders the event when the EventStore emits one', () => {
    let getState;
    const cleanup = $effect.root(() => {
      getState = useReplaceableEvent(() => POINTER);
    });
    flushSync();

    replaceableSubject.next(EVENT);
    flushSync();

    expect(getState().event).toBe(EVENT);
    expect(getState().loading).toBe(false);
    expect(getState().notFound).toBe(false);

    cleanup();
  });

  it('renders immediately on warm cache (BehaviorSubject pre-populated)', () => {
    replaceableSubject = new BehaviorSubject(EVENT);
    let getState;
    const cleanup = $effect.root(() => {
      getState = useReplaceableEvent(() => POINTER);
    });
    flushSync();

    expect(getState().event).toBe(EVENT);
    expect(getState().loading).toBe(false);

    cleanup();
  });

  it('flips to notFound after the configured delay if no event arrives', () => {
    let getState;
    const cleanup = $effect.root(() => {
      getState = useReplaceableEvent(() => POINTER, { notFoundDelayMs: 5000 });
    });
    flushSync();

    expect(getState().notFound).toBe(false);

    vi.advanceTimersByTime(5000);
    flushSync();

    expect(getState().notFound).toBe(true);
    expect(getState().loading).toBe(false);
    expect(getState().event).toBeUndefined();

    cleanup();
  });

  it('clears notFound if the event arrives after the timeout', () => {
    let getState;
    const cleanup = $effect.root(() => {
      getState = useReplaceableEvent(() => POINTER, { notFoundDelayMs: 2000 });
    });
    flushSync();

    vi.advanceTimersByTime(2000);
    flushSync();
    expect(getState().notFound).toBe(true);

    replaceableSubject.next(EVENT);
    flushSync();

    expect(getState().notFound).toBe(false);
    expect(getState().event).toBe(EVENT);

    cleanup();
  });

  it('tears down loader + store subscriptions on cleanup', () => {
    let getState;
    const cleanup = $effect.root(() => {
      getState = useReplaceableEvent(() => POINTER);
    });
    flushSync();

    cleanup();
    // Emitting after cleanup should not propagate to the (now-detached) state.
    expect(() => replaceableSubject.next(EVENT)).not.toThrow();
    expect(getState().event).toBeUndefined();
  });

  it('drops the event when the store signals removal (NIP-09 deletion)', () => {
    // ReplaceableModel emits `undefined` when the event is deleted from the
    // store. The hook must clear the rendered event instead of swallowing
    // the signal — otherwise a deleted event stays on screen forever.
    let getState;
    const cleanup = $effect.root(() => {
      getState = useReplaceableEvent(() => POINTER);
    });
    flushSync();

    replaceableSubject.next(EVENT);
    flushSync();
    expect(getState().event).toBe(EVENT);

    replaceableSubject.next(undefined);
    flushSync();

    expect(getState().event).toBeUndefined();
    expect(getState().loading).toBe(false);
    expect(getState().notFound).toBe(true);

    cleanup();
  });

  it('ignores an initial undefined emission while the store is still cold', () => {
    let getState;
    const cleanup = $effect.root(() => {
      getState = useReplaceableEvent(() => POINTER);
    });
    flushSync();

    replaceableSubject.next(undefined);
    flushSync();

    expect(getState().loading).toBe(true);
    expect(getState().notFound).toBe(false);

    cleanup();
  });

  it('does nothing when the pointer is null', () => {
    let getState;
    const cleanup = $effect.root(() => {
      getState = useReplaceableEvent(() => null);
    });
    flushSync();

    expect(getState().event).toBeUndefined();
    expect(getState().loading).toBe(false);
    expect(getState().notFound).toBe(false);
    expect(addressLoaderMock).not.toHaveBeenCalled();

    cleanup();
  });
});
