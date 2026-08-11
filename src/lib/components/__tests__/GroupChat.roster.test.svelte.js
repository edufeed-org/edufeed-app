/**
 * GroupChat — admin roster capture + management entry points (Task 6).
 *
 * Exercises the header seams Tasks 7-8 build on: the member-count span
 * becomes a clickable "group-members-open" button, and an admin-only
 * "group-settings-open" gear appears when the active user's pubkey is in
 * the group's kind 39001 admin roster.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

const ADMIN_SK = generateSecretKey();
const NON_ADMIN_SK = generateSecretKey();
const RELAY_SK = generateSecretKey();
const ADMIN_PUBKEY = getPublicKey(ADMIN_SK);
const NON_ADMIN_PUBKEY = getPublicKey(NON_ADMIN_SK);
const GROUP_RELAY = 'wss://groups.example.com/';

/** @param {any} template @param {Uint8Array} sk */
function signWith(template, sk) {
  return finalizeEvent({ content: '', tags: [], created_at: 1700000000, ...template }, sk);
}

const metadataEvent = signWith(
  {
    kind: 39000,
    tags: [
      ['d', 'beechat'],
      ['name', 'Bee Chat']
    ]
  },
  RELAY_SK
);
// Only ADMIN_PUBKEY is in the 39001 roster — NON_ADMIN_PUBKEY is a plain member.
const adminsEvent = signWith(
  {
    kind: 39001,
    tags: [
      ['d', 'beechat'],
      ['p', ADMIN_PUBKEY, 'admin']
    ]
  },
  RELAY_SK
);
const membersEvent = signWith(
  {
    kind: 39002,
    tags: [
      ['d', 'beechat'],
      ['p', ADMIN_PUBKEY],
      ['p', NON_ADMIN_PUBKEY]
    ]
  },
  RELAY_SK
);

/** @type {{pubkey: string, signer: any} | null} */
let currentUser = null;

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  await import('applesauce-common'); // registers models, same as the real module
  const { of: rxOf, NEVER: rxNever } = await import('rxjs');
  const eventStore = new EventStore();
  // Cross-realm Uint8Array check fails under jsdom for the default verifier;
  // fixtures are really signed above, so skip re-verification here.
  eventStore.verifyEvent = () => true;
  const pool = {
    relay: () => ({
      request: () => rxOf(metadataEvent, adminsEvent, membersEvent),
      subscription: () => rxNever,
      publish: vi.fn().mockResolvedValue({ ok: true }),
      authenticate: vi.fn().mockResolvedValue({ ok: true }),
      information$: rxOf({
        limitation: {},
        supported_nips: [1, 29],
        software: '',
        version: ''
      })
    }),
    group: () => ({ request: () => rxOf() })
  };
  return { eventStore, pool };
});

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => currentUser,
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
vi.mock('$lib/services/publish-service.js', () => ({ publishEventOptimistic: vi.fn() }));
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

describe('GroupChat admin roster + management entry points', () => {
  beforeEach(() => {
    currentUser = null;
  });

  it('exposes a members-open button showing the member count', async () => {
    currentUser = { pubkey: NON_ADMIN_PUBKEY, signer: {} };
    render(GroupChat, { props: { pointer } });

    const button = await screen.findByTestId('group-members-open');
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toContain('2');
  });

  it('shows the settings gear only when the active user is a group admin', async () => {
    currentUser = { pubkey: ADMIN_PUBKEY, signer: {} };
    render(GroupChat, { props: { pointer } });

    await screen.findByTestId('group-members-open');
    expect(await screen.findByTestId('group-settings-open')).toBeTruthy();
  });

  it('hides the settings gear for a non-admin member', async () => {
    currentUser = { pubkey: NON_ADMIN_PUBKEY, signer: {} };
    render(GroupChat, { props: { pointer } });

    await screen.findByTestId('group-members-open');
    expect(screen.queryByTestId('group-settings-open')).toBeNull();
  });

  it('hides the settings gear when logged out', async () => {
    currentUser = null;
    render(GroupChat, { props: { pointer } });

    await screen.findByTestId('group-members-open');
    expect(screen.queryByTestId('group-settings-open')).toBeNull();
  });
});
