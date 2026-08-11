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
const OTHER = getPublicKey(OTHER_SK);
const GROUP_RELAY = 'wss://groups.example.com/';

/** @param {any} template @param {Uint8Array} sk */
function signWith(template, sk) {
  return finalizeEvent({ content: '', tags: [], created_at: 1700000000, ...template }, sk);
}

const metadataEvent = signWith(
  {
    kind: 39000,
    // `private` alongside the dead `public`/`open` tags of an older draft:
    // this group IS members-only, and a reader that trusts the old tags would
    // say the opposite.
    tags: [
      ['d', 'beechat'],
      ['name', 'Bee Chat'],
      ['about', 'buzzing'],
      ['private'],
      ['public'],
      ['open']
    ]
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
// The two live reply shapes, both hanging off `chatEvent`: the 872-event form
// (a lone `reply` marker pointing at the root) and the 3-event form (the
// conformant root+reply pair). The nested one answers `firstReply`, so a
// resolver that read the `reply` tag as the root would file it under
// `firstReply` and it would never appear in this thread.
const firstReply = signWith(
  {
    kind: 9,
    content: 'first reply',
    created_at: 1700000010,
    tags: [
      ['h', 'beechat'],
      ['e', chatEvent.id, '', 'reply']
    ]
  },
  OTHER_SK
);
// A SECOND top-level message, older than the threaded one, so it sorts first
// in the timeline. Without it the thread's root is also the first message in
// the list, and "find the root by id" and "take the first message" cannot be
// told apart — which is precisely the mistake the panel must not make, since
// thread reads come back created_at-ordered with ties unbroken.
const otherRoot = signWith(
  { kind: 9, content: 'an unrelated message', created_at: 1699999990, tags: [['h', 'beechat']] },
  OTHER_SK
);
// ...and one reply to it, so there are TWO threads. Switching between them
// without closing the panel in between is a path `closeThread` never sees.
const otherReply = signWith(
  {
    kind: 9,
    content: 'a reply over there',
    created_at: 1699999995,
    tags: [
      ['h', 'beechat'],
      ['e', otherRoot.id, '', 'reply']
    ]
  },
  OTHER_SK
);
// A reply-to-a-reply as the SHIPPED writer emits it: one `reply` tag naming
// the message that was clicked, which is `firstReply` — a mid-thread message,
// not the root. These exist on every relay that does not validate ancestry.
const legacyNested = signWith(
  {
    kind: 9,
    content: 'legacy nested reply',
    created_at: 1700000030,
    tags: [
      ['h', 'beechat'],
      ['e', firstReply.id, '', 'reply']
    ]
  },
  OTHER_SK
);
const nestedReply = signWith(
  {
    kind: 9,
    content: 'reply to the reply',
    created_at: 1700000020,
    tags: [
      ['h', 'beechat'],
      ['e', chatEvent.id, '', 'root'],
      ['e', firstReply.id, '', 'reply']
    ]
  },
  OTHER_SK
);

const publishMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const requestCalls = vi.hoisted(() => /** @type {any[]} */ ([]));
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
        request: (/** @type {any} */ filters) => {
          requestCalls.push(filters);
          return rxOf(metadataEvent, membersEvent);
        },
        // keep the subscription open after replay so unsubscribe paths run
        subscription: () =>
          rxMerge(
            rxOf(otherRoot, otherReply, chatEvent, firstReply, nestedReply, legacyNested),
            rxNever
          ),
        publish: publishMock,
        authenticate: vi.fn().mockResolvedValue({ ok: true }),
        // The header's badges read the relay's NIP-11 document. A fake relay
        // without it is not a relay: applesauce's Relay always exposes this,
        // and leaving it out only hides the wiring from the test.
        information$: rxOf({
          limitation: { auth_required: true },
          supported_nips: [1, 29, 42],
          software: 'git+https://github.com/fiatjaf/pyramid',
          version: '1.2'
        })
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
  useActiveUser: () => () => ({ pubkey: ME, signer: { signEvent } }),
  // Only reached by useJoinedCommunikeyEvents' underlying
  // useJoinedCommunitiesList hook (mounted at GroupChat init for the
  // post-delete cascade). No community is joined in this fixture, so
  // getAccountForPubkey is never actually called.
  manager: {
    active: null,
    active$: { subscribe: () => ({ unsubscribe: () => {} }) },
    getAccountForPubkey: () => undefined
  }
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
  groups_react_failed: () => 'Reaction could not be sent',
  groups_auth_required: () => 'auth required',
  groups_reply: () => 'Reply',
  groups_input_placeholder: (/** @type {{ name: string }} */ { name }) => `Message ${name}`,
  groups_badge_members_only: () => 'Members only',
  groups_badge_invite_only: () => 'Invite only',
  groups_badge_auth_required: () => 'Sign-in required',
  groups_badge_nip29: () => 'NIP-29',
  chat_thread_title: () => 'Thread',
  chat_thread_close: () => 'Close thread',
  chat_thread_reply_one: () => '1 reply',
  chat_thread_reply_many: (/** @type {{ count: number }} */ { count }) => `${count} replies`,
  chat_thread_reply_placeholder: () => 'Reply in thread'
}));

const { default: GroupChat } = await import('$lib/components/groups/GroupChat.svelte');

const pointer = { relay: GROUP_RELAY, id: 'beechat' };

describe('GroupChat', () => {
  beforeEach(() => {
    publishMock.mockClear();
    publishOptimisticMock.mockClear();
    signEvent.mockClear();
    relayCalls.length = 0;
    requestCalls.length = 0;
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

  it('a rejected reaction tells the user instead of failing silently', async () => {
    // Measured on groups.hzrd149.com: OK false "blocked: unknown member".
    const { showToast } = await import('$lib/helpers/toast');
    publishMock.mockResolvedValueOnce({ ok: false, message: 'blocked: unknown member' });
    const { container } = render(GroupChat, { props: { pointer } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="pick-stub"]')).toBeTruthy();
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="pick-stub"]'))
    );
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Reaction could not be sent', 'error')
    );
  });

  it('asks the GROUP relay for the profiles of authors and roster', async () => {
    // Members of a closed host often have no kind-0 on our lookup relays;
    // the host itself has them (Armada asks the same source).
    render(GroupChat, { props: { pointer } });
    await waitFor(
      () => {
        const profileReqs = requestCalls.filter((f) => f?.kinds?.length === 1 && f.kinds[0] === 0);
        expect(profileReqs.length).toBeGreaterThan(0);
        // The newest request carries the full set once the timeline landed.
        expect(profileReqs.at(-1).authors).toEqual(expect.arrayContaining([OTHER]));
      },
      { timeout: 2000 }
    );
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

  // The header's small labels, end to end: what the RELAY announces about
  // itself (NIP-11) and what the group says about getting in.
  it('shows what the relay announces about itself', async () => {
    render(GroupChat, { props: { pointer } });
    await screen.findByTestId('group-name');

    const badges = await screen.findByTestId('group-badges');
    expect(badges.textContent).toContain('Sign-in required');
    expect(badges.textContent).toContain('NIP-29');
    // NIP-11 `software` is a URL by convention; the last segment is the name.
    expect(badges.textContent).toContain('pyramid 1.2');
  });

  // The fixture is `private` AND carries the dead `public`/`open` tags of an
  // older NIP-29 draft — the ones applesauce still reads. Reading access off
  // the PARSED metadata instead of the event's own tags would label this
  // members-only group as open, so this is the test that makes the choice of
  // input load-bearing rather than incidental.
  it('reads access from the group event, not from the dead openness tags', async () => {
    render(GroupChat, { props: { pointer } });
    await screen.findByTestId('group-name');

    expect(await screen.findByTestId('group-badge-members')).toBeTruthy();
    // `closed` is absent, and members-only already says what a reader needs.
    expect(screen.queryByTestId('group-badge-invite')).toBeNull();
  });

  // A channel opened from a host directory used to be a dead end: the chat
  // named its host in plain text, so the only way back to that host's other
  // channels was the browser's back button.
  it('names the host as a way back to its other channels', async () => {
    render(GroupChat, { props: { pointer } });
    const link = await screen.findByTestId('group-host-link');
    expect(link.getAttribute('href')).toBe(`/relays/${encodeURIComponent(GROUP_RELAY)}`);
    expect(link.textContent).toContain('groups.example.com');
  });

  /** @param {HTMLElement} container */
  const bodies = (container) =>
    [...container.querySelectorAll('[data-testid="ncr-content"]')].map((el) => el.textContent);

  describe('threading', () => {
    // ORDER MATTERS IN HERE. The EventStore is created once for the module, so
    // a message published by one test is still in the timeline for the next.
    // Tests that assert the panel's EXACT contents must therefore come before
    // any test that sends something; adding a publishing test above them will
    // break them, and the failure will look like a threading bug.
    /** Timeline order is oldest first: [0] is `otherRoot`, [1] is `chatEvent`. */
    const openLinks = () => screen.getAllByTestId('thread-open');

    it('keeps replies out of the timeline and offers the thread instead', async () => {
      const { container } = render(GroupChat, { props: { pointer } });
      await waitFor(() => expect(bodies(container)).toContain('hello from armada'));

      // Both replies hang off `chatEvent`, so neither belongs in the timeline.
      expect(bodies(container)).not.toContain('first reply');
      expect(bodies(container)).not.toContain('reply to the reply');
      expect(bodies(container)).toContain('an unrelated message');
      expect(bodies(container)).not.toContain('a reply over there');
      // The count is per-message, not per-timeline, and the older root's
      // single reply exercises the singular label.
      const links = screen.getAllByTestId('thread-open').map((el) => el.textContent);
      expect(links).toEqual(['1 reply', '3 replies']);
      expect(screen.queryByTestId('thread-panel')).toBeNull();
    });

    // The nested reply names `firstReply` in its `reply` tag and `chatEvent`
    // in its `root` tag. Filing by the reply tag would put it in a thread of
    // its own, so its presence HERE is what proves root resolution ran.
    it('opens a panel holding the root and every reply in the thread, at any depth', async () => {
      const { container } = render(GroupChat, { props: { pointer } });
      await waitFor(() => expect(screen.getAllByTestId('thread-open')).toHaveLength(2));
      await fireEvent.click(openLinks()[1]);

      const panel = /** @type {HTMLElement} */ (await screen.findByTestId('thread-panel'));
      expect(bodies(panel)).toEqual([
        'hello from armada',
        'first reply',
        'reply to the reply',
        'legacy nested reply'
      ]);
      // ...and closing it puts the timeline back.
      await fireEvent.click(screen.getByTestId('thread-panel-close'));
      await waitFor(() => expect(screen.queryByTestId('thread-panel')).toBeNull());
      expect(bodies(container)).toContain('hello from armada');
    });

    // A reply written by the SHIPPED app names a mid-thread message. Filing
    // by the named id alone put it under a parent that is itself filed away:
    // absent from the timeline, absent from every reachable thread, gone from
    // the app entirely. Reachable only where the relay does not validate
    // ancestry — which is every relay except a Buzz-hosted one.
    it('shows a reply written by the pre-fix app in the thread it belongs to', async () => {
      const { container } = render(GroupChat, { props: { pointer } });
      await waitFor(() => expect(screen.getAllByTestId('thread-open')).toHaveLength(2));

      expect(bodies(container)).not.toContain('legacy nested reply');
      await fireEvent.click(openLinks()[1]);
      const panel = /** @type {HTMLElement} */ (await screen.findByTestId('thread-panel'));
      expect(bodies(panel)).toEqual([
        'hello from armada',
        'first reply',
        'reply to the reply',
        'legacy nested reply'
      ]);
    });

    // Its own affordance was a trap: the row snippet is shared, so a
    // mid-thread message with replies filed under it rendered an "N replies"
    // link inside the panel; clicking it set a root that is not in the
    // timeline and unmounted the whole panel. Root resolution removes the
    // cause; this removes the category.
    it('offers no thread link inside the panel — you are already in the thread', async () => {
      render(GroupChat, { props: { pointer } });
      await waitFor(() => expect(screen.getAllByTestId('thread-open')).toHaveLength(2));
      await fireEvent.click(openLinks()[1]);

      const panel = /** @type {HTMLElement} */ (await screen.findByTestId('thread-panel'));
      expect(panel.querySelectorAll('[data-testid="thread-open"]')).toHaveLength(0);
      // Control: the timeline still has its links, so this is not "the
      // affordance is gone everywhere".
      expect(screen.getAllByTestId('thread-open').length).toBe(2);
    });

    it('sends a panel reply against the thread root by default', async () => {
      render(GroupChat, { props: { pointer } });
      await waitFor(() => expect(screen.getAllByTestId('thread-open')).toHaveLength(2));
      await fireEvent.click(openLinks()[1]);

      const input = await screen.findByTestId('thread-chat-input');
      await fireEvent.input(input, { target: { value: 'me too' } });
      await fireEvent.submit(/** @type {HTMLElement} */ (input.closest('form')));

      await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
      const signed = publishMock.mock.calls[0][0];
      expect(signed.content).toBe('me too');
      // The root is top-level, so the reply keeps the single-tag shape.
      expect(signed.tags.filter((/** @type {string[]} */ t) => t[0] === 'e')).toEqual([
        ['e', chatEvent.id, '', 'reply']
      ]);
    });

    // The load-bearing publish case: answering a reply from inside the panel
    // has to inherit the thread root rather than start a new thread.
    it('sends a reply-to-a-reply as the conformant root+reply pair', async () => {
      render(GroupChat, { props: { pointer } });
      await waitFor(() => expect(screen.getAllByTestId('thread-open')).toHaveLength(2));
      await fireEvent.click(openLinks()[1]);

      const panel = /** @type {HTMLElement} */ (await screen.findByTestId('thread-panel'));
      // Second row in the panel is `firstReply` (row 0 is the root).
      const replyButtons = panel.querySelectorAll('button[title="Reply"]');
      await fireEvent.click(replyButtons[1]);

      const input = screen.getByTestId('thread-chat-input');
      await fireEvent.input(input, { target: { value: 'answering the reply' } });
      await fireEvent.submit(/** @type {HTMLElement} */ (input.closest('form')));

      await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
      const signed = publishMock.mock.calls[0][0];
      expect(signed.tags.filter((/** @type {string[]} */ t) => t[0] === 'e')).toEqual([
        ['e', chatEvent.id, '', 'root'],
        ['e', firstReply.id, '', 'reply']
      ]);
    });

    // The timeline stays beside the panel, so a second thread can be opened
    // without closing the first. That path never touches `closeThread`, and
    // an armed target carried across would send the next message into the
    // thread the user just left.
    it('forgets the reply target when switching straight to another thread', async () => {
      render(GroupChat, { props: { pointer } });
      await waitFor(() => expect(screen.getAllByTestId('thread-open')).toHaveLength(2));
      await fireEvent.click(openLinks()[1]);

      const panel = /** @type {HTMLElement} */ (await screen.findByTestId('thread-panel'));
      await fireEvent.click(panel.querySelectorAll('button[title="Reply"]')[1]);
      await waitFor(() => expect(screen.queryByTestId('chat-reply-strip')).not.toBeNull());

      // Straight to the other thread — no close in between.
      await fireEvent.click(openLinks()[0]);
      await waitFor(() =>
        expect(bodies(/** @type {HTMLElement} */ (screen.getByTestId('thread-panel')))).toEqual([
          'an unrelated message',
          'a reply over there'
        ])
      );

      const input = screen.getByTestId('thread-chat-input');
      await fireEvent.input(input, { target: { value: 'over here now' } });
      await fireEvent.submit(/** @type {HTMLElement} */ (input.closest('form')));

      await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
      expect(
        publishMock.mock.calls[0][0].tags.filter((/** @type {string[]} */ t) => t[0] === 'e')
      ).toEqual([['e', otherRoot.id, '', 'reply']]);
    });

    // Aiming at a reply, closing the panel and opening it again must not leave
    // the old target armed: the next thing typed would silently answer a
    // message the user is no longer looking at.
    it('forgets the reply target when the thread is reopened', async () => {
      render(GroupChat, { props: { pointer } });
      await waitFor(() => expect(screen.getAllByTestId('thread-open')).toHaveLength(2));
      await fireEvent.click(openLinks()[1]);

      const panel = /** @type {HTMLElement} */ (await screen.findByTestId('thread-panel'));
      await fireEvent.click(panel.querySelectorAll('button[title="Reply"]')[1]);
      await waitFor(() => expect(screen.queryByTestId('chat-reply-strip')).not.toBeNull());

      await fireEvent.click(screen.getByTestId('thread-panel-close'));
      await waitFor(() => expect(screen.queryByTestId('thread-panel')).toBeNull());
      await fireEvent.click(openLinks()[1]);
      await screen.findByTestId('thread-panel');

      const input = screen.getByTestId('thread-chat-input');
      await fireEvent.input(input, { target: { value: 'fresh start' } });
      await fireEvent.submit(/** @type {HTMLElement} */ (input.closest('form')));

      await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
      expect(
        publishMock.mock.calls[0][0].tags.filter((/** @type {string[]} */ t) => t[0] === 'e')
      ).toEqual([['e', chatEvent.id, '', 'reply']]);
    });

    // Two composers are mounted at once. A single shared draft would leak the
    // thread reply into the timeline input and vice versa.
    it('keeps the timeline draft and the thread draft apart', async () => {
      render(GroupChat, { props: { pointer } });
      await waitFor(() => expect(screen.getAllByTestId('thread-open')).toHaveLength(2));
      await fireEvent.input(screen.getByTestId('group-chat-input'), {
        target: { value: 'timeline draft' }
      });
      await fireEvent.click(openLinks()[1]);

      const threadInput = /** @type {HTMLInputElement} */ (
        await screen.findByTestId('thread-chat-input')
      );
      expect(threadInput.value).toBe('');
      await fireEvent.input(threadInput, { target: { value: 'thread draft' } });
      expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-chat-input')).value).toBe(
        'timeline draft'
      );
    });
  });

  // A relay on another port is another relay, so the label has to carry it —
  // found by mutation: with a portless fixture, `hostname` and `host` read the
  // same and the test above could not tell them apart.
  it('keeps the port in the host it names', async () => {
    render(GroupChat, {
      props: { pointer: { relay: 'wss://groups.example.com:8443/', id: 'beechat' } }
    });
    const link = await screen.findByTestId('group-host-link');
    expect(link.textContent).toContain('groups.example.com:8443');
  });
});
