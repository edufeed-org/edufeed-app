/**
 * GroupChat — NIP-29 relay-group chat wiring.
 *
 * A fake pool serves one group relay: metadata (39000) + members (39002) via
 * request(), kind-9/-7 events via subscription(); the REAL applesauce
 * EventStore + TimelineModel sit in the middle, so what's under test is the
 * actual data path (relay -> store -> model -> rows) plus the publish
 * contracts: kind 9 h-tagged messages, 9021 join to the GROUP relay, and the
 * kind-10009 list mirror through publishEventOptimistic.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

// REAL keys + signatures: the mock feeds a real applesauce EventStore, which
// rejects events whose id/sig don't verify — fakes would silently vanish and
// every "renders X" assertion would pass vacuously on an empty timeline.
const MY_SK = generateSecretKey();
const OTHER_SK = generateSecretKey();
const RELAY_SK = generateSecretKey();
const ME = getPublicKey(MY_SK);
const GROUP_RELAY = 'wss://groups.example.com/';

/** @param {any} template @param {Uint8Array} sk */
function signWith(template, sk) {
  return finalizeEvent({ content: '', tags: [], created_at: 1700000000, ...template }, sk);
}

const metadataEvent = signWith(
  {
    kind: 39000,
    tags: [['d', 'beechat'], ['name', 'Bee Chat'], ['about', 'buzzing'], ['public'], ['open']]
  },
  RELAY_SK
);
const membersEvent = signWith(
  {
    kind: 39002,
    tags: [
      ['d', 'beechat'],
      ['p', getPublicKey(OTHER_SK)]
    ]
  },
  RELAY_SK
);
const chatEvent = signWith(
  { kind: 9, content: 'hello from armada', tags: [['h', 'beechat']] },
  OTHER_SK
);

const publishMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const relayCalls = vi.hoisted(() => /** @type {string[]} */ ([]));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  await import('applesauce-common'); // registers models, same as the real module
  const { of: rxOf, NEVER: rxNever, merge: rxMerge } = await import('rxjs');
  const eventStore = new EventStore();
  // applesauce's default verifier (its own nostr-tools 2.19.4 / @noble 1.3.1)
  // does an `instanceof Uint8Array` that fails CROSS-REALM under jsdom, so
  // EventStore.add would throw for every event here. The fixtures are really
  // signed (see above); skip the store-side re-verification in this env.
  eventStore.verifyEvent = () => true;
  const pool = {
    relay: (/** @type {string} */ url) => {
      relayCalls.push(url);
      return {
        request: () => rxOf(metadataEvent, membersEvent),
        // keep the subscription open after replay so unsubscribe paths run
        subscription: () => rxMerge(rxOf(chatEvent), rxNever),
        publish: publishMock,
        authenticate: vi.fn().mockResolvedValue({ ok: true })
      };
    },
    group: () => ({ request: () => rxOf() })
  };
  return { eventStore, pool };
});

// Real signing so eventStore.add() accepts what the component publishes.
const signEvent = vi.fn(async (/** @type {any} */ template) => {
  const { pubkey: _drop, ...rest } = template;
  return finalizeEvent({ ...rest }, MY_SK);
});
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME, signer: { signEvent } })
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));
const publishOptimisticMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: publishOptimisticMock
}));
vi.mock('$lib/helpers/message-utils.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/helpers/message-utils.js'));
  return { ...actual, formatMessageTimestamp: () => '12:00' };
});

function Stub() {}
vi.mock(
  '$lib/components/shared/NostrContentRenderer.svelte',
  () => import('./fixtures/NostrContentStub.svelte')
);
vi.mock('$lib/components/shared/LinkPreviewList.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/icons', () => ({ ReplyIcon: Stub }));
vi.mock(
  '$lib/components/reactions/ReactionChips.svelte',
  () => import('./fixtures/ReactionChipsStub.svelte')
);

vi.mock('$lib/paraglide/messages', () => ({
  groups_join: () => 'Join',
  groups_leave: () => 'Leave',
  groups_join_sent: () => 'Join request sent',
  groups_leave_sent: () => 'Leave request sent',
  groups_join_failed: () => 'Request failed',
  groups_send_failed: () => 'Message could not be sent',
  groups_auth_required: () => 'auth required',
  groups_reply: () => 'Reply',
  groups_input_placeholder: (/** @type {{ name: string }} */ { name }) => `Message ${name}`
}));

const { default: GroupChat } = await import('$lib/components/groups/GroupChat.svelte');

const pointer = { relay: GROUP_RELAY, id: 'beechat' };

describe('GroupChat', () => {
  beforeEach(() => {
    publishMock.mockClear();
    publishOptimisticMock.mockClear();
    signEvent.mockClear();
    relayCalls.length = 0;
  });

  it('renders relay-served metadata and chat messages through the real event store', async () => {
    const { container } = render(GroupChat, { props: { pointer } });

    await waitFor(() => {
      expect(screen.getByTestId('group-name').textContent).toContain('Bee Chat');
    });
    await waitFor(() => {
      const contents = [...container.querySelectorAll('[data-testid="ncr-content"]')].map(
        (el) => el.textContent
      );
      expect(contents).toContain('hello from armada');
    });
    expect(relayCalls.every((url) => url === GROUP_RELAY)).toBe(true);
  });

  it('sends a kind-9 h-tagged message to the group relay only', async () => {
    render(GroupChat, { props: { pointer } });
    await waitFor(() => screen.getByTestId('group-chat-input'));

    await fireEvent.input(screen.getByTestId('group-chat-input'), {
      target: { value: 'hi group' }
    });
    await fireEvent.submit(
      /** @type {HTMLElement} */ (screen.getByTestId('group-chat-input').closest('form'))
    );

    await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
    const signed = publishMock.mock.calls[0][0];
    expect(signed.kind).toBe(9);
    expect(signed.content).toBe('hi group');
    expect(signed.tags[0]).toEqual(['h', 'beechat']);
    expect(signed.pubkey).toBe(ME);
  });

  it('join publishes a 9021 to the group relay and mirrors the group into the 10009 list', async () => {
    render(GroupChat, { props: { pointer } });
    // I'm not in the members list -> Join button shows
    const joinButton = await screen.findByTestId('group-join');
    await fireEvent.click(joinButton);

    await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
    const joinEvent = publishMock.mock.calls[0][0];
    expect(joinEvent.kind).toBe(9021);
    expect(joinEvent.tags).toEqual([['h', 'beechat']]);

    await waitFor(() => expect(publishOptimisticMock).toHaveBeenCalledTimes(1));
    const listEvent = publishOptimisticMock.mock.calls[0][0];
    expect(listEvent.kind).toBe(10009);
    expect(listEvent.tags).toContainEqual(['group', 'beechat', GROUP_RELAY]);
  });
});
