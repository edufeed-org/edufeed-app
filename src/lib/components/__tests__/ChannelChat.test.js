/**
 * ChannelChat.svelte — concord private-channel chat reaction/reply parity.
 *
 * Verifies the wiring introduced to give concord channel messages the SAME
 * ReactionChips experience as the public community chat (Chat.svelte):
 *  - kind-7 reaction rumors are aggregated into the SAME summary shape as
 *    the public chat's aggregateReactions() (count/userReacted/reactors/
 *    emojiUrl), fed to the shared ReactionChips component.
 *  - picking a NEW emoji calls community.react(channelId, {id, author}, emoji).
 *  - re-toggling an emoji the user ALREADY reacted with is a silent no-op
 *    (ConcordCommunity has no retract/unreact method yet).
 *
 * ReactionChips itself is stubbed (its own behavior — chip rendering,
 * opacity-based hover reveal — is covered by ReactionChips.test.js); this
 * file only asserts ChannelChat wires it correctly.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { of, BehaviorSubject } from 'rxjs';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = /** @type {any} */ (
    (/** @type {string} */ query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  );
}

const ACTIVE_PUBKEY = 'c'.repeat(64);
const OTHER_PUBKEY = 'a'.repeat(64);

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ACTIVE_PUBKEY })
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));

vi.mock('$lib/helpers/message-utils.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/helpers/message-utils.js'));
  return { ...actual, formatMessageTimestamp: () => '12:00' };
});

function Stub() {}
vi.mock('$lib/components/shared/NostrContentRenderer.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/LinkPreviewList.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/icons', () => ({ ReplyIcon: Stub }));

vi.mock(
  '$lib/components/reactions/ReactionChips.svelte',
  () => import('./fixtures/ReactionChipsStub.svelte')
);

vi.mock('$lib/paraglide/messages', () => ({
  concord_chat_subtitle: () => 'subtitle',
  concord_how_it_works: () => 'how it works',
  concord_menu_invite: () => 'Invite',
  concord_menu_members: () => 'Members',
  concord_menu_backup: () => 'Backup',
  concord_menu_dissolve: () => 'Dissolve',
  concord_dissolved_banner: () => 'Dissolved',
  concord_keybar_title: () => 'Back up your key',
  concord_keybar_body: () => 'body',
  concord_keybar_action: () => 'Back up',
  concord_genesis_title: (/** @type {{ name: string }} */ { name }) => `Welcome to ${name}`,
  concord_genesis_body: () => 'genesis body',
  concord_input_placeholder: (/** @type {{ name: string }} */ { name }) => `Message ${name}`,
  concord_read_only: () => 'Read only',
  concord_no_key_error: () => 'No key',
  concord_send_failed: () => 'Send failed',
  concord_reply: () => 'Reply'
}));

const { default: ChannelChat } = await import(
  '$lib/components/community/channels/ChannelChat.svelte'
);

const CHANNEL = { channel_id: 'chan-1', name: 'general', private: true };

const message1 = {
  id: 'msg-1',
  pubkey: OTHER_PUBKEY,
  content: 'hello',
  created_at: 1700000000,
  tags: []
};

/** @param {any[]} reactionRumors @param {any} reactMock */
function makeCommunity(reactionRumors, reactMock = vi.fn().mockResolvedValue(undefined)) {
  return {
    channelStore: (/** @type {string} */ _id) => ({
      timeline: (/** @type {any[]} */ filters) => {
        const kind = filters?.[0]?.kinds?.[0];
        if (kind === 7) return of(reactionRumors);
        return of([message1]);
      }
    }),
    members$: new BehaviorSubject(new Set([ACTIVE_PUBKEY, OTHER_PUBKEY])),
    react: reactMock
  };
}

describe('ChannelChat reaction parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('feeds ReactionChips an aggregated summary matching the public chat shape', async () => {
    const reactionRumor = {
      content: '👍',
      pubkey: ACTIVE_PUBKEY,
      tags: [['e', 'msg-1']]
    };
    const community = makeCommunity([reactionRumor]);

    const { container } = render(ChannelChat, {
      props: { community, channel: CHANNEL, openOverlay: () => {}, onBack: () => {} }
    });
    await Promise.resolve();
    await Promise.resolve();

    const stub = container.querySelector('[data-testid="reaction-chips-stub"]');
    expect(stub).toBeTruthy();
    expect(stub?.getAttribute('data-add-button-on-hover')).toBe('true');

    const aggregated = JSON.parse(stub?.getAttribute('data-aggregated') ?? '[]');
    expect(aggregated).toEqual([
      [
        '👍',
        {
          count: 1,
          userReacted: true,
          userReactionEvent: null,
          emojiUrl: null,
          reactors: [ACTIVE_PUBKEY]
        }
      ]
    ]);
  });

  it('publishes a NEW reaction via community.react when a message has no prior reaction', async () => {
    const reactMock = vi.fn().mockResolvedValue(undefined);
    const community = makeCommunity([], reactMock);

    const { container } = render(ChannelChat, {
      props: { community, channel: CHANNEL, openOverlay: () => {}, onBack: () => {} }
    });
    await Promise.resolve();
    await Promise.resolve();

    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="pick-stub"]'))
    );
    await Promise.resolve();

    expect(reactMock).toHaveBeenCalledWith('chan-1', { id: 'msg-1', author: OTHER_PUBKEY }, '😀');
  });

  it('does NOT call community.react again when toggling an emoji the user already reacted with (no retract support)', async () => {
    const reactMock = vi.fn().mockResolvedValue(undefined);
    const reactionRumor = { content: '👍', pubkey: ACTIVE_PUBKEY, tags: [['e', 'msg-1']] };
    const community = makeCommunity([reactionRumor], reactMock);

    const { container } = render(ChannelChat, {
      props: { community, channel: CHANNEL, openOverlay: () => {}, onBack: () => {} }
    });
    await Promise.resolve();
    await Promise.resolve();

    const chipButton = [...container.querySelectorAll('button')].find((b) =>
      b.getAttribute('data-testid')?.startsWith('chip-stub-')
    );
    await fireEvent.click(/** @type {HTMLElement} */ (chipButton));
    await Promise.resolve();

    expect(reactMock).not.toHaveBeenCalled();
  });
});
