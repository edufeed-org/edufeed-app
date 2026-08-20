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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
// Real module (not mocked): the walledchat auth-required retry exercises the
// actual one-AUTH-per-challenge guard, so its attempt cache must be cleared
// between tests the same way a fresh page load would start clean.
import { __resetAuthAttempts } from '$lib/groups/relay-auth.js';

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
// ME is on the roster: the composer only renders for members now (the
// join-bar tests below cover the non-member view via openchat/ghostchat).
const membersEvent = signWith(
  {
    kind: 39002,
    tags: [
      ['d', 'beechat'],
      ['p', getPublicKey(OTHER_SK)],
      ['p', getPublicKey(MY_SK)]
    ]
  },
  RELAY_SK
);
const chatEvent = signWith(
  { kind: 9, content: 'hello from armada', tags: [['h', 'beechat']] },
  OTHER_SK
);
// A SECOND group, world-readable (no `private` tag), for the disclosure-line
// test that needs a 39000 lacking it — the primary `beechat` fixture is
// deliberately private (see below) and reused by most other tests here.
const metadataEventOpen = signWith(
  {
    kind: 39000,
    tags: [
      ['d', 'openchat'],
      ['name', 'Open Chat']
    ]
  },
  RELAY_SK
);
const membersEventOpen = signWith({ kind: 39002, tags: [['d', 'openchat']] }, RELAY_SK);
// The roster AFTER an accepted self-join: the relay's own put-user (kind
// 9000, not modelled here — only its RESULT, the updated 39002, is
// observable to this component) lands ME on the roster. Served by the mock
// once REAL wall-clock time has passed since the 9021 was actually
// published (see `openchatJoinPublishedAt` / `pool.relay().request` below)
// — simulating a relay slower than pyramid's ~100ms, to exercise the
// join-specific follow-up bump rather than the immediate one.
const membersEventOpenJoined = signWith(
  {
    kind: 39002,
    tags: [
      ['d', 'openchat'],
      ['p', ME]
    ]
  },
  RELAY_SK
);
// A THIRD group: no `private` tag (same shape as `openchat`), but reached
// through a relay whose NIP-11 declares every read gated behind NIP-42 — the
// live buzz-relay case (finding 2): the absence of `private` must NOT read as
// "world" there, only as "members". Carries a real member so the disclosure
// line's numeric-suppression rule (finding 5, size === 0 hides the line)
// doesn't swallow this fixture's whole point.
const metadataEventAuthNoPrivate = signWith(
  {
    kind: 39000,
    tags: [
      ['d', 'authchat'],
      ['name', 'Auth Chat']
    ]
  },
  RELAY_SK
);
const membersEventAuthNoPrivate = signWith(
  {
    kind: 39002,
    tags: [
      ['d', 'authchat'],
      ['p', OTHER]
    ]
  },
  RELAY_SK
);
// A FOURTH group: private, but with an EMPTY roster (no `p` tags) — finding 5:
// "readable by 0 members" is not a real disclosure, it's "we haven't heard
// from the roster yet" indistinguishable from "genuinely nobody", so the line
// must be suppressed entirely rather than print the number.
const metadataEventEmptyRoster = signWith(
  { kind: 39000, tags: [['d', 'emptychat'], ['name', 'Empty Chat'], ['private']] },
  RELAY_SK
);
const membersEventEmptyRoster = signWith({ kind: 39002, tags: [['d', 'emptychat']] }, RELAY_SK);
// A FIFTH group, `hangchat`: the live pyramid shape for an AUTHENTICATED
// NON-MEMBER of a members-tier channel (groups.edufeed.org, reproduced four
// times). The roster REQ hands over the 39000 and a 39002 that simply does
// not list me, and then NEVER terminates — no CLOSE `restricted`, no error,
// no completion applesauce surfaces; its own REQ timeout tears the
// subscription down silently. The messages subscription hangs the same way.
// Nothing in either stream ever says "you are not a member", so only a
// bounded floor in the component can answer this.
const metadataEventHang = signWith(
  {
    kind: 39000,
    tags: [['d', 'hangchat'], ['name', 'Hang Chat'], ['private'], ['closed']]
  },
  RELAY_SK
);
const membersEventHang = signWith(
  {
    kind: 39002,
    tags: [
      ['d', 'hangchat'],
      ['p', OTHER]
    ]
  },
  RELAY_SK
);
// `adminchat`: a private + closed channel where I am a 39001 ADMIN but the
// 39002 member list does NOT include me. NIP-29 (and root-roster.js) count
// admins as members, so the Join/Leave affordance must treat me as already-in
// — the creator of a moderated community is seated as an admin and must NOT be
// shown "request to join" their own channel (self-approval loop). Roster loads
// cleanly here (isolating the header-button gate from the auth-race path).
const metadataEventAdmin = signWith(
  {
    kind: 39000,
    tags: [['d', 'adminchat'], ['name', 'Admin Chat'], ['private'], ['closed']]
  },
  RELAY_SK
);
const adminsEventAdmin = signWith(
  {
    kind: 39001,
    tags: [
      ['d', 'adminchat'],
      ['p', ME, 'admin']
    ]
  },
  RELAY_SK
);
const membersEventAdmin = signWith(
  {
    kind: 39002,
    tags: [
      ['d', 'adminchat'],
      ['p', OTHER]
    ]
  },
  RELAY_SK
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
// Shared across every fake relay object so a test can assert the component
// authenticated at all (proactively, not only on an auth-required error).
const authenticateSpy = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const requestCalls = vi.hoisted(() => /** @type {any[]} */ ([]));
// The viewer's own stored join request, served to the own-9021 filter that
// rides along with the roster REQ (pending-state persistence).
const relayOwn9021 = vi.hoisted(() => ({ value: /** @type {any[]} */ ([]) }));
// Records the REAL Date.now() a 9021 to `openchat` actually landed on the
// relay's `publish` — separate from `publishMock`'s own call history so the
// instant-join test's timing is exact, not derived from event `created_at`
// (whose Math.floor(Date.now()/1000) is only 1-second precise).
const openchatJoinPublishedAt = vi.hoisted(() => ({ ms: /** @type {number | null} */ (null) }));
const relayCalls = vi.hoisted(() => /** @type {string[]} */ ([]));
// `walledchat`: a members-tier group on a relay that gates reads — the live
// finding. Both the roster REQ and the chat subscription reject the FIRST
// attempt auth-required (the shared authenticateOnce retry handles that,
// see the `challenge`/`url` fields added to the fake relay below), then
// reject every attempt AFTER that restricted: authenticated, but not on the
// roster. Two independent counters because the roster (`request`) and the
// chat+reactions (`subscription`) calls are separate pool methods.
const walledChatCalls = vi.hoisted(() => ({ roster: 0, messages: 0 }));
// `rosteronlychat`: the same live-relay refusal sequence (auth-required then
// restricted), but ONLY on the roster REQ — isolates the roster effect's own
// tryAuthRetry wiring from the messages effect's (both are exercised
// together by `walledChatCalls` above; this fixture is the regression test
// for a relay that refuses ONLY the roster REQ, per the coordinator's
// requirement 1).
const rosterOnlyChatCalls = vi.hoisted(() => ({ roster: 0 }));
// Mutable holder for the relay's NIP-11 document (finding 2's test needs to
// flip auth_required per test) — same pattern as joinedCommunikeyEventsHolder
// below. Defaults to auth-required, matching the badges test's expectation
// ("Sign-in required") and every other test's assumption; reset in the outer
// `beforeEach`.
const relayInfoHolder = vi.hoisted(() => ({
  info: /** @type {any} */ ({
    limitation: { auth_required: true },
    supported_nips: [1, 29, 42],
    software: 'git+https://github.com/fiatjaf/pyramid',
    version: '1.2'
  })
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  await import('applesauce-common'); // registers models, same as the real module
  const {
    of: rxOf,
    NEVER: rxNever,
    merge: rxMerge,
    Observable: rxObservable
  } = await import('rxjs');
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
          // The roster request keys on `#d`; route each fixture group's `#d`
          // to its own metadata/members pair and leave every other pointer
          // (including the kind:0 profile requests, which carry no `#d`) on
          // `beechat`. The real REQ is an ARRAY since the own-9021 filter
          // rides along — normalize and read the `#d` off whichever filter
          // carries one.
          const filterList = Array.isArray(filters) ? filters : [filters];
          const d = filterList.find((f) => f?.['#d'])?.['#d']?.[0];
          const own = filterList.some((f) => f?.kinds?.includes(9021)) ? relayOwn9021.value : [];
          if (own.length && d === 'ghostchat') return rxOf(...own);
          // Roster REQ that never answers (gated relay, pre-auth): the join
          // button must not flash at a possible member meanwhile.
          if (d === 'silentchat') return rxNever;
          if (d === 'openchat') {
            // "Joined" flips 1.2s of REAL wall-clock time after the 9021 was
            // actually published — slower than an immediate bump and the
            // 800ms admin-op heal, inside the join-specific 1500ms window —
            // so this exercises THAT follow-up bump, not the immediate one.
            const joined =
              openchatJoinPublishedAt.ms !== null &&
              Date.now() - openchatJoinPublishedAt.ms >= 1200;
            return rxOf(metadataEventOpen, joined ? membersEventOpenJoined : membersEventOpen);
          }
          // hangchat: metadata + a roster I'm not on, then silence forever —
          // the live non-member hang (no CLOSE, no error, no completion).
          if (d === 'hangchat') return rxMerge(rxOf(metadataEventHang, membersEventHang), rxNever);
          if (d === 'adminchat')
            return rxOf(metadataEventAdmin, adminsEventAdmin, membersEventAdmin);
          if (d === 'authchat') return rxOf(metadataEventAuthNoPrivate, membersEventAuthNoPrivate);
          if (d === 'emptychat') return rxOf(metadataEventEmptyRoster, membersEventEmptyRoster);
          // A group whose metadata REQ yields nothing (relay hiccup, race
          // with NIP-42) — the fallback-name test renders this one.
          if (d === 'ghostchat') return rxOf();
          // walledchat: bundled 39000/39001/39002(+9021) REQ, auth-required
          // on the first attempt, restricted on every retry after that.
          if (d === 'walledchat') {
            walledChatCalls.roster++;
            const message =
              walledChatCalls.roster === 1
                ? 'auth-required: please authenticate'
                : "restricted: you're trying to access a private group";
            return new rxObservable((/** @type {any} */ sub) => sub.error(new Error(message)));
          }
          // rosteronlychat: ONLY the roster REQ is ever refused (auth-required
          // then restricted) — the messages/reactions subscription below
          // never errors at all for this id, so the roster's OWN
          // auth-required retry (tryAuthRetry, not the messages effect's) is
          // what has to drive the outcome here.
          if (d === 'rosteronlychat') {
            rosterOnlyChatCalls.roster++;
            const message =
              rosterOnlyChatCalls.roster === 1
                ? 'auth-required: please authenticate'
                : "restricted: you're trying to access a private group";
            return new rxObservable((/** @type {any} */ sub) => sub.error(new Error(message)));
          }
          return rxOf(metadataEvent, membersEvent);
        },
        // keep the subscription open after replay so unsubscribe paths run
        subscription: (/** @type {any} */ filters) => {
          // A private group the active user is NOT a member of: the relay
          // answers the chat REQ with CLOSED restricted (NIP-29) — modelled
          // as an erroring observable, same as applesauce surfaces it.
          const h = Array.isArray(filters) ? filters[0]?.['#h']?.[0] : filters?.['#h']?.[0];
          if (h === 'restrictedchat') {
            return new rxObservable((/** @type {any} */ sub) =>
              sub.error(new Error('restricted: not a member'))
            );
          }
          if (h === 'walledchat') {
            // Only the FIRST attempt needs auth (drives the shared retry);
            // the retried read comes back a normal empty stream, unlike the
            // roster's request() above — isolating the assertion to the
            // roster's OWN restricted routing, the actual gap under test
            // (a relay where the chat log settles empty/open rather than
            // restricted is exactly the case a messages-only fix would miss).
            walledChatCalls.messages++;
            if (walledChatCalls.messages === 1) {
              return new rxObservable((/** @type {any} */ sub) =>
                sub.error(new Error('auth-required: please authenticate'))
              );
            }
            return rxNever;
          }
          // rosteronlychat: never answers, never errors — only the roster
          // REQ above ever refuses anything for this id.
          if (h === 'rosteronlychat') return rxNever;
          // hangchat: the chat read hangs exactly like the roster read does.
          if (h === 'hangchat') return rxNever;
          return rxMerge(
            rxOf(otherRoot, otherReply, chatEvent, firstReply, nestedReply, legacyNested),
            rxNever
          );
        },
        publish: (/** @type {any} */ event) => {
          if (
            event?.kind === 9021 &&
            event.tags?.some((/** @type {string[]} */ t) => t[0] === 'h' && t[1] === 'openchat')
          ) {
            openchatJoinPublishedAt.ms = Date.now();
          }
          return publishMock(event);
        },
        authenticate: authenticateSpy,
        // authenticateOnce (relay-auth.js) needs a challenge to answer and a
        // `url` to key its per-relay attempt cache — both real applesauce
        // Relay exposes; a fake without them resolves 'no challenge' and the
        // walledchat retry would never fire.
        url,
        challenge: 'test-challenge',
        authenticated: false,
        // The header's badges (and the disclosure line's auth cap) read the
        // relay's NIP-11 document. A fake relay without it is not a relay:
        // applesauce's Relay always exposes this, and leaving it out only
        // hides the wiring from the test.
        information$: rxOf(relayInfoHolder.info)
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
// Holder so the anonymous-viewer spec can null this out — every other test
// keeps the default logged-in ME; reset in the outer `beforeEach` below.
const activeUserHolder = vi.hoisted(() => ({
  current: /** @type {{pubkey: string, signer: any} | null} */ (null)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => activeUserHolder.current,
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
// GroupChat calls useJoinedCommunikeyEvents() directly (not just through the
// post-delete cascade's useJoinedCommunitiesList chain) to resolve the
// disclosure line's linked-community access. Stubbed at this seam — the
// exact hook GroupChat imports — rather than the manager/addressLoader chain
// underneath it, so a test can hand it a kind:10222 fixture without wiring up
// a whole fake follow-set/relay round trip. Holder object so individual
// tests can override the (usually empty) list; reset in the outer
// `beforeEach` below.
const joinedCommunikeyEventsHolder = vi.hoisted(() => ({ events: /** @type {any[]} */ ([]) }));
vi.mock('$lib/helpers/joined-communikey-events.svelte.js', () => ({
  useJoinedCommunikeyEvents: () => () => joinedCommunikeyEventsHolder.events
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
vi.mock('$lib/components/icons', () => ({ ReplyIcon: Stub, PeopleIcon: Stub }));
vi.mock(
  '$lib/components/reactions/ReactionChips.svelte',
  () => import('./fixtures/ReactionChipsStub.svelte')
);

vi.mock('$lib/paraglide/messages', () => ({
  groups_join: () => 'Join',
  groups_restricted_note: () => 'Only members can read and write in this channel.',
  groups_leave: () => 'Leave',
  groups_join_sent: () => 'Join request sent',
  groups_join_already: () => 'You are already a member.',
  groups_composer_join_note: () => 'Join to write here.',
  community_join_request: () => 'Request to join',
  community_join_pending: () => 'Request sent — waiting for approval.',
  groups_leave_sent: () => 'Leave request sent',
  groups_join_failed: () => 'Request failed',
  groups_send_failed: () => 'Message could not be sent',
  groups_react_failed: () => 'Reaction could not be sent',
  groups_join_required: () => 'Join this group first',
  groups_auth_required: () => 'auth required',
  groups_reply: () => 'Reply',
  groups_input_placeholder: (/** @type {{ name: string }} */ { name }) => `Message ${name}`,
  groups_badge_members_only: () => 'Members only',
  groups_badge_invite_only: () => 'Invite only',
  groups_badge_auth_required: () => 'Sign-in required',
  groups_badge_nip29: () => 'NIP-29',
  chat_thread_title: () => 'Thread',
  chat_thread_expand: () => 'Expand',
  chat_thread_collapse: () => 'Collapse',
  chat_thread_close: () => 'Close thread',
  chat_thread_reply_one: () => '1 reply',
  chat_thread_reply_many: (/** @type {{ count: number }} */ { count }) => `${count} replies`,
  chat_thread_reply_placeholder: () => 'Reply in thread',
  disclosure_world: () => 'Anyone on the network can read along — even without an account.',
  disclosure_members: (/** @type {{ count: number }} */ { count }) =>
    `Readable by all ${count} members.`,
  disclosure_invited: (/** @type {{ count: number }} */ { count }) =>
    `Readable by ${count} selected members.`
}));

const { default: GroupChat } = await import('$lib/components/groups/GroupChat.svelte');

const pointer = { relay: GROUP_RELAY, id: 'beechat' };

describe('GroupChat', () => {
  beforeEach(() => {
    publishMock.mockClear();
    publishOptimisticMock.mockClear();
    signEvent.mockClear();
    authenticateSpy.mockClear();
    activeUserHolder.current = { pubkey: ME, signer: { signEvent } };
    relayCalls.length = 0;
    requestCalls.length = 0;
    relayOwn9021.value = [];
    openchatJoinPublishedAt.ms = null;
    walledChatCalls.roster = 0;
    walledChatCalls.messages = 0;
    rosterOnlyChatCalls.roster = 0;
    __resetAuthAttempts();
    joinedCommunikeyEventsHolder.events = [];
    relayInfoHolder.info = {
      limitation: { auth_required: true },
      supported_nips: [1, 29, 42],
      software: 'git+https://github.com/fiatjaf/pyramid',
      version: '1.2'
    };
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

  // The embedded community pane knows the channel's name from the 10222's
  // group pointer tag; when the relay's kind:39000 does not arrive (races
  // the NIP-42 handshake on gated hosts — laoc, 2026-08-19: the header read
  // 'ce023508cb82bd3f' instead of 'willkommen'), that name must win over
  // the cryptic id.
  it('falls back to the given name, not the group id, while metadata is missing', async () => {
    render(GroupChat, {
      props: { pointer: { relay: GROUP_RELAY, id: 'ghostchat' }, fallbackName: 'willkommen' }
    });
    await waitFor(() => {
      expect(screen.getByTestId('group-name').textContent).toContain('willkommen');
    });
    expect(screen.getByTestId('group-name').textContent).not.toContain('ghostchat');
  });

  // NIP-29: only members read/write a private group — the relay refuses the
  // chat REQ with CLOSED restricted. That must become a visible state, not
  // an empty chat with a live composer whose sends silently vanish
  // (laoc, 2026-08-19).
  it('a restricted refusal hides the composer behind a members-only notice', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'restrictedchat' } } });
    await waitFor(() => {
      expect(screen.getByTestId('group-restricted-note')).toBeTruthy();
    });
    expect(screen.queryByTestId('group-chat-input')).toBeNull();
  });

  // The live finding: a non-member on a relay that gates every read hits
  // auth-required FIRST, then restricted on the retry — the retried
  // rejection has to land in the same members-only state as an immediate
  // one, AND still offer a way in (the relay accepts pending 9021s to a
  // closed group even while reads stay restricted).
  it('a restricted refusal on the post-auth retry still shows the notice and a join affordance', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'walledchat' } } });

    const note = await screen.findByTestId('group-restricted-note');
    expect(note.textContent).toContain('Only members can read and write in this channel.');
    expect(note.textContent).toContain('Request to join');
    expect(screen.queryByTestId('group-chat-input')).toBeNull();
    // Both bundled REQs actually retried post-auth, not just answered once.
    expect(walledChatCalls.roster).toBeGreaterThanOrEqual(2);
  });

  it('clicking the join affordance in the restricted notice sends the 9021 and flips to pending', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'walledchat' } } });
    const note = await screen.findByTestId('group-restricted-note');

    await fireEvent.click(within(note).getByRole('button', { name: 'Request to join' }));

    await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
    const joinEvent = publishMock.mock.calls[0][0];
    expect(joinEvent.kind).toBe(9021);
    expect(joinEvent.tags).toContainEqual(['h', 'walledchat']);

    await waitFor(() => {
      expect(screen.getByTestId('group-restricted-note').textContent).toContain(
        'Request sent — waiting for approval.'
      );
    });
    expect(
      within(screen.getByTestId('group-restricted-note')).queryByRole('button', {
        name: 'Request to join'
      })
    ).toBeNull();
  });

  // While the roster read is still in flight (no answer, no error — the
  // relay just never closes the REQ), a non-member must never see a live,
  // enabled input: sends into it would be silently rejected the moment the
  // relay actually answers.
  it('shows no enabled composer while the roster has not answered', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'silentchat' } } });
    await new Promise((r) => setTimeout(r, 50));

    const input = /** @type {HTMLInputElement | null} */ (screen.queryByTestId('group-chat-input'));
    expect(input === null || input.disabled).toBe(true);
  });

  // The live hang (laoc, 2026-08-19, four reproductions on
  // groups.edufeed.org): an AUTHENTICATED non-member of a members-tier
  // channel. The roster REQ answers with metadata and a roster I'm not on and
  // then never terminates — no CLOSE `restricted`, no error, no completion —
  // so every "the relay told us something" path stays cold and the composer
  // sat greyed out forever with no notice and no way in. Real timers on
  // purpose (this file takes that tradeoff elsewhere too, see the
  // slower-relay join test): the floor is a wall-clock deadline.
  it('answers a roster REQ that never terminates, and offers the join instead of a dead composer', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'hangchat' } } });
    await screen.findByTestId('group-name');
    // Before the floor elapses nothing is claimed: no join bar yet, and the
    // composer — if rendered at all — is disabled.
    expect(screen.queryByTestId('group-join-bar')).toBeNull();
    const earlyInput = /** @type {HTMLInputElement | null} */ (
      screen.queryByTestId('group-chat-input')
    );
    expect(earlyInput === null || earlyInput.disabled).toBe(true);

    const bar = await waitFor(() => screen.getByTestId('group-join-bar'), {
      timeout: 10000,
      interval: 100
    });
    expect(within(bar).getByTestId('group-join-bar-button').textContent).toContain(
      'Request to join'
    );
    // Still no enabled composer, and no members-only notice either: silence
    // is not proof of restriction, so the softer join bar is what shows.
    expect(screen.queryByTestId('group-chat-input')).toBeNull();
    expect(screen.queryByTestId('group-restricted-note')).toBeNull();
  }, 20000);

  // Regression for the coordinator's live-relay finding: a relay that
  // refuses ONLY the roster REQ (auth-required, then restricted on the
  // retry) — the messages/reactions subscription never errors at all — must
  // still reach the members-only notice. Before the roster effect's own
  // tryAuthRetry wiring, this refusal was silently absorbed by the roster's
  // unconditional `rosterAnswered = true` and never routed anywhere else.
  // Live finding (laoc 2026-08-20, edufeed on raum-1): a private channel's
  // roster REQ is NOT closed auth-required — pyramid silently OMITS the 39002
  // members list and EOSEs clean. So a real member, waiting for a reactive
  // auth-required that never comes on the roster, read as a non-member (empty
  // roster + "request to join", no messages) even though authenticating once
  // served the whole roster + history. GroupChat now authenticates PROACTIVELY
  // on open, not only in reaction to an error. `beechat` (ME is a member, no
  // auth-required anywhere) would never have triggered auth reactively.
  it('authenticates the groups relay proactively on open, without waiting for an auth-required error', async () => {
    render(GroupChat, { props: { pointer } }); // beechat: ME is a member; nothing errors auth-required
    await screen.findByTestId('group-name');
    await waitFor(() => expect(authenticateSpy).toHaveBeenCalled());
  });

  it('a roster-only auth-required-then-restricted refusal still reaches the members-only notice', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'rosteronlychat' } } });

    const note = await screen.findByTestId('group-restricted-note');
    expect(note.textContent).toContain('Only members can read and write in this channel.');
    expect(screen.queryByTestId('group-chat-input')).toBeNull();
    // The roster genuinely retried post-auth, not just answered once.
    expect(rosterOnlyChatCalls.roster).toBeGreaterThanOrEqual(2);
  });

  // Live finding: an anonymous viewer (no active user — so no signer to
  // ever authenticate with) of a private group. Measured against the real
  // groups.edufeed.org relay: the messages REQ's `auth-required` CLOSE never
  // resolves to next/error/complete without a NIP-42 response, so the
  // subscription just hangs — a plain disabled composer with no explanation
  // was the result, not a notice. The mock reproduces the same hang (a
  // subscription that never terminates), so this only passes if the fix
  // reads the answer off the metadata that DOES load instead of waiting on
  // that REQ.
  it('an anonymous viewer of a private group gets the members-only notice, not a dead composer', async () => {
    activeUserHolder.current = null;
    render(GroupChat, { props: { pointer } });

    const note = await screen.findByTestId('group-restricted-note');
    expect(note.textContent).toContain('Only members can read and write in this channel.');
    // No identity to join with — the notice alone, no button.
    expect(within(note).queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('group-chat-input')).toBeNull();
  });

  // An admin (39001) who is not on the 39002 member list is the community
  // creator's own situation. Admins ARE members in NIP-29 — the header must
  // show no "request to join", and the composer must render (canWrite).
  it('admin who is not a listed member: no join affordance, composer renders', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'adminchat' } } });
    await screen.findByTestId('group-name');
    // Composer is available (admin can write); no header join, no join bar.
    await waitFor(() => expect(screen.queryByTestId('group-chat-input')).not.toBeNull(), {
      timeout: 8000
    });
    expect(screen.queryByTestId('group-join')).toBeNull();
    expect(screen.queryByTestId('group-join-bar')).toBeNull();
    expect(screen.queryByTestId('group-restricted-note')).toBeNull();
  });

  // A readable group the viewer hasn't joined: the relay would reject every
  // send ('blocked: unknown member'), so the composer gives way to a join
  // bar (laoc, 2026-08-19: an enabled input whose sends silently bounced).
  it('non-member of a readable group: join bar instead of composer', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'openchat' } } });
    const bar = await screen.findByTestId('group-join-bar');
    expect(bar.textContent).toContain('Join to write here.');
    expect(screen.queryByTestId('group-chat-input')).toBeNull();
  });

  // A closed group stores the 9021 for the admin queue — after sending, the
  // join affordances flip to the pending note instead of a Join button that
  // looks ignored (laoc, 2026-08-19: 'the join button kept there').
  it('closed group: request wording, and pending note after sending', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'ghostchat' } } });
    const bar = await screen.findByTestId('group-join-bar');
    const button = within(bar).getByTestId('group-join-bar-button');
    expect(button.textContent).toContain('Request to join');

    await fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId('group-join-bar').textContent).toContain(
        'Request sent — waiting for approval.'
      )
    );
    expect(await screen.findByTestId('group-join-pending')).toBeTruthy();
    expect(screen.queryByTestId('group-join')).toBeNull();
  });

  it('a stored 9021 of mine keeps the pending state across a reload', async () => {
    relayOwn9021.value = [signWith({ kind: 9021, content: '', tags: [['h', 'ghostchat']] }, MY_SK)];
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'ghostchat' } } });
    expect(await screen.findByTestId('group-join-pending')).toBeTruthy();
    expect(screen.queryByTestId('group-join')).toBeNull();
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
    const { showToast } = await import('$lib/helpers/toast');
    publishMock.mockResolvedValueOnce({ ok: false, message: 'rate-limited: slow down' });
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

  it('a membership refusal says JOIN FIRST, not a generic failure', async () => {
    // Measured on the buzz relay: "blocked: unknown member".
    const { showToast } = await import('$lib/helpers/toast');
    publishMock.mockResolvedValueOnce({ ok: false, message: 'blocked: unknown member' });
    const { container } = render(GroupChat, { props: { pointer } });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="pick-stub"]')).toBeTruthy();
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="pick-stub"]'))
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Join this group first', 'warning'));
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
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'openchat' } } });
    // I'm not in openchat's members list -> Join button shows
    const joinButton = await screen.findByTestId('group-join');
    await fireEvent.click(joinButton);

    await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
    const joinEvent = publishMock.mock.calls[0][0];
    expect(joinEvent.kind).toBe(9021);
    expect(joinEvent.tags).toEqual([['h', 'openchat']]);

    await waitFor(() => expect(publishOptimisticMock).toHaveBeenCalledTimes(1));
    const listEvent = publishOptimisticMock.mock.calls[0][0];
    expect(listEvent.kind).toBe(10009);
    expect(listEvent.tags).toContainEqual(['group', 'openchat', GROUP_RELAY]);
  });

  // Pyramid: an accepted 9021 is followed within ~100ms by the relay's own
  // put-user, and the composer should unlock without a reload. Timing design
  // (the point of this test): the mock relay materialises the roster update
  // 1.2s of REAL wall-clock time after the 9021 lands — AFTER the component's
  // immediate re-request bump, but BEFORE its 800ms admin-op heal timer, and
  // still inside GroupChat's JOIN_ROSTER_HEAL_DELAY_MS (1500ms) follow-up —
  // so it straddles exactly the gap only that dedicated join timer covers.
  // Margins below are deliberately wide (real setTimeout, no fake timers —
  // see the file-level note on that tradeoff) because this project has a
  // documented flaky-under-load class for real-timer tests on a busy CI
  // runner (laoc, 2026-08-19).
  it('unlocks the composer once a slower relay materialises the accepted self-join', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'openchat' } } });
    const joinButton = await screen.findByTestId('group-join');
    await fireEvent.click(joinButton);
    await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));

    // Too soon: the relay has not materialised the roster change yet, so
    // the composer must still be gated behind the join bar.
    expect(screen.queryByTestId('group-chat-input')).toBeNull();

    await waitFor(
      () => {
        expect(screen.getByTestId('group-chat-input')).toBeTruthy();
      },
      { timeout: 8000, interval: 100 }
    );
    expect(screen.queryByTestId('group-join-bar')).toBeNull();
  }, 15000);

  // laoc, 2026-08-19: a member whose roster read hadn't answered yet was
  // shown Beitreten, and clicking it surfaced the relay's 'duplicate:
  // already a member' as a raw error. Two guards: no join/leave until the
  // roster REQ has ANSWERED, and the duplicate refusal is a friendly no-op.
  it('offers neither Join nor Leave while the roster has not answered', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'silentchat' } } });
    // Give effects a beat — the button must not appear at all.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('group-join')).toBeNull();
    expect(screen.queryByTestId('group-leave')).toBeNull();
  });

  it("an 'already a member' refusal is a friendly no-op, not an error", async () => {
    publishMock.mockRejectedValueOnce(new Error('duplicate: already a member'));
    const { showToast } = await import('$lib/helpers/toast');
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'openchat' } } });
    const joinButton = await screen.findByTestId('group-join');
    await fireEvent.click(joinButton);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('You are already a member.', 'info')
    );
    expect(showToast).not.toHaveBeenCalledWith('Request failed', 'error');
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

  // The disclosure line above the composer: who can read, in numbers.
  it('shows the members count on the disclosure line for a standalone private group', async () => {
    render(GroupChat, { props: { pointer } });
    await screen.findByTestId('group-name');

    // Standalone group -> no linked community -> the stricter 'invited'
    // reading (see access-choice.js), but the count is the same roster
    // either way: `membersEvent` carries exactly one member.
    const line = await screen.findByTestId('disclosure-line');
    expect(line.textContent).toBe('Readable by 2 selected members.');
  });

  it('shows the world-readable disclosure line for a group without `private`', async () => {
    // The genuinely-open combination: relay does NOT gate reads behind
    // NIP-42, and the group carries no `private` tag either.
    relayInfoHolder.info = { ...relayInfoHolder.info, limitation: { auth_required: false } };
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'openchat' } } });
    await screen.findByTestId('group-name');

    const line = await screen.findByTestId('disclosure-line');
    expect(line.textContent).toBe(
      'Anyone on the network can read along — even without an account.'
    );
  });

  // Finding 2: overstating openness is the harmful direction. A host that
  // gates every read behind NIP-42 (relayInfoHolder's default) means a 39000
  // lacking `private` is still only readable by whoever the relay admits —
  // the disclosure line must say MEMBERS, not world.
  it('shows the members-wording disclosure line when the relay requires auth even though the channel has no `private` tag', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'authchat' } } });
    await screen.findByTestId('group-name');

    const line = await screen.findByTestId('disclosure-line');
    expect(line.textContent).toBe('Readable by all 1 members.');
  });

  // Finding 5: a members/invited line with count 0 is not information, it's
  // ambiguous between "empty roster" and "roster hasn't arrived" — hide it.
  it('hides the disclosure line for a members/invited channel with an empty roster', async () => {
    render(GroupChat, { props: { pointer: { relay: GROUP_RELAY, id: 'emptychat' } } });
    await screen.findByTestId('group-name');

    // Give any (absent) disclosure line a chance to render before asserting
    // its absence.
    await waitFor(() => expect(screen.queryByTestId('group-badges')).toBeTruthy());
    expect(screen.queryByTestId('disclosure-line')).toBeNull();
  });

  // The kind-10222 `group` pointer's access marker is RETIRED (2026-08-20):
  // channels are discovered from the relay subtree, and a `private` channel is
  // always 'invited' — whatever a joined community's (now-ignored) pointer
  // marker says. The disclosure reads "selected members", never "all members".
  // ("all community members, privately" is Concord's job now.)
  it('ignores a joined community’s retired `members` pointer marker — a private channel stays invited-wording', async () => {
    joinedCommunikeyEventsHolder.events = [
      {
        kind: 10222,
        pubkey: 'f'.repeat(64),
        tags: [
          ['d', ''],
          ['group', pointer.id, pointer.relay, 'Bee Chat', 'members']
        ]
      }
    ];
    render(GroupChat, { props: { pointer } });
    await screen.findByTestId('group-name');

    const line = await screen.findByTestId('disclosure-line');
    expect(line.textContent).toBe('Readable by 2 selected members.');
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
