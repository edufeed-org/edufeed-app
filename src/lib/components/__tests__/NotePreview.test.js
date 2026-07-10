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
import { Subject } from 'rxjs';
import { nip19 } from 'nostr-tools';
import NotePreview from '../shared/NostrPreviews/NotePreview.svelte';

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

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    event: (/** @type {any} */ pointer) => eventSpy(pointer)
  },
  pool: {}
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
vi.mock('../shared/NostrContentRenderer.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));
vi.mock('$lib/components/polls/PollCard.svelte', () => ({ default: StubComponent }));

const nevent = nip19.neventEncode({ id: EVENT_ID, relays: [HINT_RELAY], author: AUTHOR });

describe('NotePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    event$ = new Subject();
  });

  it('subscribes to the EventStore with the id and relay hints from the nevent', () => {
    render(NotePreview, { props: { identifier: nevent } });

    expect(eventSpy).toHaveBeenCalledTimes(1);
    const pointer = /** @type {any} */ (eventSpy.mock.calls[0])[0];
    expect(pointer.id).toBe(EVENT_ID);
    expect(pointer.relays).toContain(HINT_RELAY);
    expect(pointer.relays).toContain('wss://lookup.example.com');
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

  it('unsubscribes from the store on unmount', () => {
    const { unmount } = render(NotePreview, { props: { identifier: nevent } });
    expect(event$.observed).toBe(true);
    unmount();
    expect(event$.observed).toBe(false);
  });
});
