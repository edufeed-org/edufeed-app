/**
 * NotePreview Component Tests (issue #37)
 *
 * The preview must subscribe reactively to the EventStore (which auto-loads
 * missing events via the attached eventLoader) instead of doing a one-shot
 * fetch. A referenced event arriving late must upgrade the badge/skeleton
 * to the embedded note card without remounting.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { BehaviorSubject, Subject } from 'rxjs';
import { nip19 } from 'nostr-tools';
import NotePreview from '../shared/NostrPreviews/NotePreview.svelte';
import { QUOTE_POINTERS } from '$lib/helpers/quote-pointers.js';

const EVENT_ID = 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8';
const AUTHOR = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const HINT_RELAY = 'wss://hint.example.com';

const mockEvent = {
  id: EVENT_ID,
  kind: 1,
  pubkey: AUTHOR,
  tags: [],
  created_at: 1700000000,
  content: 'Quoted note content'
};

/** @type {Subject<any>} */
let event$;
const eventSpy = vi.fn((/** @type {any} */ _pointer) => event$);
/** @type {Subject<any>[]} one per network attempt */
let loads = [];
const loaderSpy = vi.fn((/** @type {any} */ _pointer, /** @type {any} */ _options) => {
  const load$ = new Subject();
  loads.push(load$);
  return load$;
});

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    event: (/** @type {any} */ pointer) => eventSpy(pointer)
  },
  pool: {}
}));

vi.mock('$lib/loaders/referenced-event.js', () => ({
  loadReferencedEvent: (/** @type {any} */ pointer, /** @type {any} */ options) =>
    loaderSpy(pointer, options)
}));

vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    getAllLookupRelays: () => ['wss://lookup.example.com']
  };
});

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

vi.mock('$lib/paraglide/messages.js', () => ({
  common_show_more: () => 'Show more',
  common_show_less: () => 'Show less',
  profile_avatar_alt: () => 'Avatar',
  profile_avatar_fallback: () => '?'
}));

function StubComponent() {}
// The content renderer probe records the exact object it receives: applesauce
// memoizes parsed content on the event with non-enumerable descriptors, which
// a Svelte deep-state proxy rejects (state_descriptors_fixed).
vi.mock('../shared/NostrContentRenderer.svelte', () => import('./fixtures/EventPropProbe.svelte'));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));
vi.mock('$lib/components/polls/PollCard.svelte', () => ({ default: StubComponent }));

const nevent = nip19.neventEncode({ id: EVENT_ID, relays: [HINT_RELAY], author: AUTHOR });

describe('NotePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    event$ = new Subject();
    loads = [];
  });

  it('subscribes to the EventStore by id and loads from the nevent hints + lookup relays', () => {
    render(NotePreview, { props: { identifier: nevent } });

    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(/** @type {any} */ (eventSpy.mock.calls[0])[0]).toEqual({ id: EVENT_ID });

    expect(loaderSpy).toHaveBeenCalledTimes(1);
    const [pointer, options] = /** @type {any} */ (loaderSpy.mock.calls[0]);
    expect(pointer.id).toBe(EVENT_ID);
    expect(pointer.relays).toContain(HINT_RELAY);
    expect(pointer.relays).toContain('wss://lookup.example.com');
    // The nevent's author drives the outbox fallback
    expect(options).toEqual({ author: AUTHOR });
  });

  // A `note1…` names no author and no relay: the quoting event's q tag does,
  // and only with the author can the outbox fallback run.
  it("takes the author and relay hint from the quoting event's q tag", () => {
    const note = nip19.noteEncode(EVENT_ID);
    const quotes = new Map([
      [EVENT_ID, { id: EVENT_ID, relays: ['wss://q-hint.example.com/'], author: AUTHOR }]
    ]);
    render(NotePreview, {
      props: { identifier: note },
      context: new Map([[QUOTE_POINTERS, () => quotes]])
    });

    const [pointer, options] = /** @type {any} */ (loaderSpy.mock.calls[0]);
    expect(pointer.id).toBe(EVENT_ID);
    expect(pointer.relays).toEqual(['wss://q-hint.example.com/', 'wss://lookup.example.com']);
    expect(options).toEqual({ author: AUTHOR });
  });

  it('loads nothing past the nesting limit', () => {
    const { container } = render(NotePreview, { props: { identifier: nevent, depth: 2 } });
    expect(eventSpy).not.toHaveBeenCalled();
    expect(loaderSpy).not.toHaveBeenCalled();
    expect(container.querySelector('.badge')).toBeTruthy();
  });

  // A miss must not be final: the feed's first lookup can lose the race with a
  // slow WebSocket handshake while dozens of relays connect, and the store's
  // own fallback runs once per (60 s warm) model, so the detail page used to
  // inherit the miss until a full reload.
  it('asks the network again on every mount', () => {
    render(NotePreview, { props: { identifier: nevent } }).unmount();
    render(NotePreview, { props: { identifier: nevent } });
    expect(loaderSpy).toHaveBeenCalledTimes(2);
  });

  it('skips the network when the store already holds the event', () => {
    event$ = /** @type {any} */ (new BehaviorSubject(mockEvent));
    render(NotePreview, { props: { identifier: nevent } });
    expect(loaderSpy).not.toHaveBeenCalled();
  });

  it('retries after a miss and renders the late answer', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(NotePreview, { props: { identifier: nevent } });
      event$.next(undefined);
      loads[0].complete(); // first attempt found nothing

      await vi.advanceTimersByTimeAsync(10_000);
      expect(loaderSpy).toHaveBeenCalledTimes(2);

      loads[1].next(mockEvent);
      event$.next(mockEvent); // the loader feeds the store, the store feeds us
      await vi.advanceTimersByTimeAsync(0);
      expect(container.querySelector('a[href*="nevent"]')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after a few misses', async () => {
    vi.useFakeTimers();
    try {
      render(NotePreview, { props: { identifier: nevent } });
      for (let i = 0; i < 10; i++) {
        loads.at(-1)?.complete();
        await vi.advanceTimersByTimeAsync(60_000);
      }
      const attempts = loaderSpy.mock.calls.length;
      expect(attempts).toBeGreaterThan(1);
      expect(attempts).toBeLessThanOrEqual(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending retry on unmount', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(NotePreview, { props: { identifier: nevent } });
      loads[0].complete();
      unmount();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(loaderSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the embedded card when the event is already available', async () => {
    const { container } = render(NotePreview, { props: { identifier: nevent } });
    event$.next(mockEvent);

    await waitFor(() => {
      expect(container.querySelector('a[href*="nevent"]')).toBeTruthy();
    });
  });

  it('upgrades to the embedded card when the event arrives late (self-heal)', async () => {
    const { container } = render(NotePreview, { props: { identifier: nevent } });

    // Store miss: the store emits undefined first while the loader works
    event$.next(undefined);
    expect(container.querySelector('a[href*="nevent"]')).toBeFalsy();

    // Event arrives later (loader or any other surface added it to the store)
    event$.next(mockEvent);
    await waitFor(() => {
      expect(container.querySelector('a[href*="nevent"]')).toBeTruthy();
    });
  });

  it('keeps the badge fallback when the event never arrives', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(NotePreview, { props: { identifier: nevent } });
      event$.next(undefined);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(container.querySelector('.badge')).toBeTruthy();
      expect(container.querySelector('a[href*="nevent"]')).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands the renderer the plain event, not a deep-state proxy (state_descriptors_fixed)', async () => {
    const g = /** @type {any} */ (globalThis);
    g.__eventPropProbe = [];
    render(NotePreview, { props: { identifier: nevent } });
    event$.next(mockEvent);

    await waitFor(() => expect(g.__eventPropProbe).toHaveLength(1));
    const handed = g.__eventPropProbe[0];
    expect(handed.id).toBe(EVENT_ID);
    // What applesauce's getOrComputeCachedValue does on first parse
    expect(() =>
      Object.defineProperty(handed, Symbol('memo'), {
        value: 1,
        enumerable: false,
        configurable: true,
        writable: true
      })
    ).not.toThrow();
  });

  it('unsubscribes from the store on unmount', () => {
    const { unmount } = render(NotePreview, { props: { identifier: nevent } });
    expect(event$.observed).toBe(true);
    unmount();
    expect(event$.observed).toBe(false);
  });
});
