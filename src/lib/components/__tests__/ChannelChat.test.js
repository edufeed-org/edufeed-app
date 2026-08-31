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
import { render, fireEvent, screen } from '@testing-library/svelte';
import { of, BehaviorSubject } from 'rxjs';
import { nip19 } from 'nostr-tools';
import { tick } from 'svelte';

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

// Shared, hoisted profile map so mention tests can hand members display
// names; reaction tests leave it empty (same behavior as the previous
// always-empty-Map mock).
const memberProfiles = vi.hoisted(() => new Map());
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => memberProfiles
}));

const sendChannelMessageMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$lib/concord/send-message.js', () => ({
  sendChannelMessage: sendChannelMessageMock
}));

vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));

vi.mock('$lib/helpers/message-utils.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/helpers/message-utils.js'));
  return { ...actual, formatMessageTimestamp: () => '12:00' };
});

function Stub() {}
// Renders event.content verbatim (data-testid="ncr-content") so the
// attachment tests can assert the URL-stripped clone reaches the renderer.
vi.mock(
  '$lib/components/shared/NostrContentRenderer.svelte',
  () => import('./fixtures/NostrContentStub.svelte')
);
vi.mock('$lib/components/shared/LinkPreviewList.svelte', () => ({ default: Stub }));
// Prop-capturing stub — real render behavior covered by MessageAttachments.test.js.
vi.mock(
  '$lib/components/community/channels/MessageAttachments.svelte',
  () => import('./fixtures/MessageAttachmentsStub.svelte')
);
// Prop-capturing stub — real render behavior covered by PollMessage.test.js.
vi.mock(
  '$lib/components/community/channels/PollMessage.svelte',
  () => import('./fixtures/PollMessageStub.svelte')
);
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/icons', () => ({ ReplyIcon: Stub, PeopleIcon: Stub }));

vi.mock(
  '$lib/components/reactions/ReactionChips.svelte',
  () => import('./fixtures/ReactionChipsStub.svelte')
);

vi.mock('$lib/paraglide/messages', () => ({
  chat_thread_expand: () => 'Expand',
  chat_thread_collapse: () => 'Collapse',
  concord_chat_subtitle: () => 'subtitle',
  concord_how_it_works: () => 'how it works',
  concord_menu_invite: () => 'Invite',
  concord_menu_members: () => 'Members',
  concord_menu_backup: () => 'Backup',
  concord_menu_dissolve: () => 'Dissolve',
  concord_menu_delete_channel: () => 'Delete channel',
  concord_dissolved_banner: () => 'Dissolved',
  concord_dissolved_recover: () => 'Start a new area',
  concord_keybar_title: () => 'Back up your key',
  concord_keybar_body: () => 'body',
  concord_keybar_action: () => 'Back up',
  concord_genesis_title: (/** @type {{ name: string }} */ { name }) => `Welcome to ${name}`,
  concord_genesis_body: () => 'genesis body',
  concord_input_placeholder: (/** @type {{ name: string }} */ { name }) => `Message ${name}`,
  concord_read_only: () => 'Read only',
  concord_no_key_error: () => 'No key',
  concord_send_failed: () => 'Send failed',
  concord_reply: () => 'Reply',
  concord_notif_level_label: () => 'Notify me',
  concord_notif_level_all: () => 'All messages',
  concord_notif_level_mentions: () => 'Mentions only',
  concord_notif_level_nothing: () => 'Nothing',
  concord_thread_title: () => 'Thread',
  concord_thread_close: () => 'Close thread',
  concord_thread_replies: (/** @type {{ count: number }} */ { count }) => `${count} replies`,
  concord_thread_reply_placeholder: () => 'Reply in thread…',
  concord_thread_send: () => 'Send',
  concord_thread_open: () => 'Reply in thread',
  concord_events_title: (/** @type {{ count: number }} */ { count }) => `${count} upcoming events`,
  disclosure_encrypted: () => 'End-to-end encrypted — only members can read along.'
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

/** @param {any[]} reactionRumors @param {any} [reactMock] @param {Set<string>} [members] */
function makeCommunity(
  reactionRumors,
  reactMock = vi.fn().mockResolvedValue(undefined),
  members = new Set([ACTIVE_PUBKEY, OTHER_PUBKEY])
) {
  return {
    channelStore: (/** @type {string} */ _id) => ({
      timeline: (/** @type {any[]} */ filters) => {
        const kind = filters?.[0]?.kinds?.[0];
        if (kind === 7) return of(reactionRumors);
        return of([message1]);
      }
    }),
    members$: new BehaviorSubject(members),
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

describe('ChannelChat disclosure line', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the constant encrypted disclosure line above the composer', async () => {
    const community = makeCommunity([]);
    const { container } = render(ChannelChat, {
      props: { community, channel: CHANNEL, openOverlay: () => {}, onBack: () => {} }
    });
    await Promise.resolve();
    await Promise.resolve();

    const line = container.querySelector('[data-testid="disclosure-line"]');
    expect(line?.textContent).toBe('End-to-end encrypted — only members can read along.');
  });
});

describe('ChannelChat header invite button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls openOverlay("invite") from a visible header button', async () => {
    const openOverlay = vi.fn();
    const community = makeCommunity([]);

    const { container } = render(ChannelChat, {
      props: {
        community,
        channel: CHANNEL,
        dissolved: false,
        canCreateInvite: true,
        openOverlay,
        onBack: () => {}
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    const button = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="concord-header-invite"]')
    );
    expect(button).toBeTruthy();
    await fireEvent.click(button);

    expect(openOverlay).toHaveBeenCalledWith('invite');
  });

  it('hides the header invite button when the area is dissolved', async () => {
    const community = makeCommunity([]);

    const { container } = render(ChannelChat, {
      props: {
        community,
        channel: CHANNEL,
        dissolved: true,
        canCreateInvite: true,
        openOverlay: () => {},
        onBack: () => {}
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('[data-testid="concord-header-invite"]')).toBeNull();
  });

  it('hides the header invite button when canCreateInvite is false, even when live', async () => {
    const community = makeCommunity([]);

    const { container } = render(ChannelChat, {
      props: {
        community,
        channel: CHANNEL,
        dissolved: false,
        canCreateInvite: false,
        openOverlay: () => {},
        onBack: () => {}
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('[data-testid="concord-header-invite"]')).toBeNull();
  });
});

describe('ChannelChat mention composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberProfiles.clear();
  });

  /** @param {any} community */
  async function renderChat(community) {
    const utils = render(ChannelChat, {
      props: { community, channel: CHANNEL, openOverlay: () => {}, onBack: () => {} }
    });
    await Promise.resolve();
    await Promise.resolve();
    const input = /** @type {HTMLInputElement} */ (
      utils.container.querySelector('[data-testid="concord-chat-input"]')
    );
    return { ...utils, input };
  }

  it('clicking Send with an open, matching mention still sends the message', async () => {
    const community = makeCommunity([]);
    const { container, input } = await renderChat(community);

    // A trailing bare "@" opens the picker with an empty query, which
    // matches EVERY member — the exact state that used to swallow the send.
    await fireEvent.input(input, { target: { value: 'hello @' } });
    expect(container.querySelector('[role="listbox"]')).toBeTruthy();

    await fireEvent.submit(/** @type {HTMLFormElement} */ (input.closest('form')));

    expect(sendChannelMessageMock).toHaveBeenCalledWith(
      community,
      'chan-1',
      'hello @',
      undefined,
      ACTIVE_PUBKEY
    );
  });

  it('typing @ali opens the dropdown with name-filtered candidates, excluding self', async () => {
    const bobPubkey = 'b'.repeat(64);
    memberProfiles.set(OTHER_PUBKEY, { name: 'alice' });
    memberProfiles.set(bobPubkey, { name: 'bob' });
    // The active user matches the query too — must still be excluded.
    memberProfiles.set(ACTIVE_PUBKEY, { name: 'alina' });
    const community = makeCommunity(
      [],
      undefined,
      new Set([ACTIVE_PUBKEY, OTHER_PUBKEY, bobPubkey])
    );
    const { container, input } = await renderChat(community);

    await fireEvent.input(input, { target: { value: '@ali' } });

    const options = [...container.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('alice');
  });

  it('caps the candidate list at 8', async () => {
    const members = new Set([ACTIVE_PUBKEY]);
    for (let i = 0; i < 10; i++) {
      const pubkey = `${i}`.repeat(64);
      members.add(pubkey);
      memberProfiles.set(pubkey, { name: `user${i}` });
    }
    const community = makeCommunity([], undefined, members);
    const { container, input } = await renderChat(community);

    await fireEvent.input(input, { target: { value: '@user' } });

    expect(container.querySelectorAll('[role="option"]')).toHaveLength(8);
  });

  it('Enter with the dropdown open picks the highlighted candidate and does NOT send', async () => {
    memberProfiles.set(OTHER_PUBKEY, { name: 'alice' });
    const community = makeCommunity([]);
    const { container, input } = await renderChat(community);

    await fireEvent.input(input, { target: { value: 'hi @ali' } });
    expect(container.querySelector('[role="listbox"]')).toBeTruthy();

    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(input.value).toBe(`hi nostr:${nip19.npubEncode(OTHER_PUBKEY)} `);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(sendChannelMessageMock).not.toHaveBeenCalled();
  });

  it('restores the caret right after the inserted mention by the next microtask (Task 11 race)', async () => {
    memberProfiles.set(OTHER_PUBKEY, { name: 'alice' });
    const community = makeCommunity([]);
    const { container, input } = await renderChat(community);

    // Mid-string mention with a trailing tail, so the expected caret is NOT
    // end-of-value (where bind:value's DOM write parks it) — the exact shape
    // of Task 11's live repro. Caret is placed after "@ali" and refreshMention
    // re-runs via the composer's onclick handler.
    await fireEvent.input(input, { target: { value: 'hi @ali yy' } });
    input.setSelectionRange(7, 7);
    await fireEvent.click(input);
    expect(container.querySelector('[role="listbox"]')).toBeTruthy();

    await fireEvent.keyDown(input, { key: 'Enter' });
    await tick();

    const inserted = `nostr:${nip19.npubEncode(OTHER_PUBKEY)} `;
    expect(input.value).toBe(`hi ${inserted} yy`);
    // By the time the DOM has flushed (tick), the caret must already sit
    // right after the mention — a rAF-deferred restore loses this race to
    // the user's next keystroke (0/8 restored in Task 11's live smoke).
    const expectedCaret = 3 + inserted.length;
    expect(input.selectionStart).toBe(expectedCaret);
    expect(input.selectionEnd).toBe(expectedCaret);
  });
});

describe('ChannelChat delete + dissolved recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** @param {any} props */
  async function renderChat(props) {
    const community = makeCommunity([]);
    const utils = render(ChannelChat, {
      props: { community, channel: CHANNEL, onBack: () => {}, ...props }
    });
    await Promise.resolve();
    await Promise.resolve();
    return utils;
  }

  it('shows "Kanal löschen" and calls openOverlay(delete-channel) when canManageChannels, live, >1 channel', async () => {
    const openOverlay = vi.fn();
    const { container } = await renderChat({
      openOverlay,
      isOwner: true,
      canManageChannels: true,
      dissolved: false,
      channelCount: 2
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="concord-chat-menu"]'))
    );
    await fireEvent.click(screen.getByRole('button', { name: /Kanal löschen|Delete channel/ }));
    expect(openOverlay).toHaveBeenCalledWith('delete-channel');
  });

  it('hides "Kanal löschen" for the last remaining channel', async () => {
    const { container } = await renderChat({
      openOverlay: vi.fn(),
      isOwner: true,
      canManageChannels: true,
      dissolved: false,
      channelCount: 1
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="concord-chat-menu"]'))
    );
    expect(screen.queryByRole('button', { name: /Kanal löschen|Delete channel/ })).toBeNull();
  });

  it('hides "Kanal löschen" when canManageChannels is false, even for the owner and >1 channel', async () => {
    const { container } = await renderChat({
      openOverlay: vi.fn(),
      isOwner: true,
      canManageChannels: false,
      dissolved: false,
      channelCount: 2
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="concord-chat-menu"]'))
    );
    expect(screen.queryByRole('button', { name: /Kanal löschen|Delete channel/ })).toBeNull();
  });

  it('shows "Kanal löschen" for a non-owner with canManageChannels (delegated admin)', async () => {
    const openOverlay = vi.fn();
    const { container } = await renderChat({
      openOverlay,
      isOwner: false,
      canManageChannels: true,
      dissolved: false,
      channelCount: 2
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="concord-chat-menu"]'))
    );
    expect(screen.queryByRole('button', { name: /Kanal löschen|Delete channel/ })).not.toBeNull();
  });

  it('hides the ⋯ menu dissolve item for a non-owner even with full manage capabilities', async () => {
    const { container } = await renderChat({
      openOverlay: vi.fn(),
      isOwner: false,
      canManageChannels: true,
      canCreateInvite: true,
      dissolved: false,
      channelCount: 2
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="concord-chat-menu"]'))
    );
    expect(screen.queryByRole('button', { name: /Bereich auflösen|Dissolve/ })).toBeNull();
  });

  it('shows the ⋯ menu dissolve item for the owner, unchanged, regardless of caps', async () => {
    const { container } = await renderChat({
      openOverlay: vi.fn(),
      isOwner: true,
      canManageChannels: false,
      canCreateInvite: false,
      dissolved: false,
      channelCount: 2
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="concord-chat-menu"]'))
    );
    expect(screen.getByRole('button', { name: /Bereich auflösen|Dissolve/ })).toBeTruthy();
  });

  it('hides the ⋯ menu invite item when canCreateInvite is false', async () => {
    const { container } = await renderChat({
      openOverlay: vi.fn(),
      isOwner: true,
      canCreateInvite: false,
      dissolved: false,
      channelCount: 1
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="concord-chat-menu"]'))
    );
    expect(container.querySelector('[data-testid="concord-menu-invite"]')).toBeNull();
  });

  it('shows the ⋯ menu invite item when canCreateInvite is true', async () => {
    const { container } = await renderChat({
      openOverlay: vi.fn(),
      isOwner: false,
      canCreateInvite: true,
      dissolved: false,
      channelCount: 1
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="concord-chat-menu"]'))
    );
    expect(container.querySelector('[data-testid="concord-menu-invite"]')).not.toBeNull();
  });

  it('shows the dissolved recover button (owner) and calls openOverlay(create)', async () => {
    const openOverlay = vi.fn();
    await renderChat({ openOverlay, isOwner: true, dissolved: true, channelCount: 1 });
    await fireEvent.click(
      screen.getByRole('button', { name: /Neuen Bereich gründen|Start a new area/ })
    );
    expect(openOverlay).toHaveBeenCalledWith('create');
  });

  it('hides the recover button for non-owners', async () => {
    await renderChat({ openOverlay: vi.fn(), isOwner: false, dissolved: true, channelCount: 1 });
    expect(
      screen.queryByRole('button', { name: /Neuen Bereich gründen|Start a new area/ })
    ).toBeNull();
  });
});

describe('ChannelChat imeta attachments', () => {
  const BLOB_URL = 'https://blossom.example/aabbccddeeff.bin';
  const attMessage = {
    id: 'msg-att',
    pubkey: OTHER_PUBKEY,
    content: `look at this ${BLOB_URL}`,
    created_at: 1700000100,
    tags: [
      [
        'imeta',
        `url ${BLOB_URL}`,
        'm image/jpeg',
        'encryption-algorithm aes-gcm',
        `decryption-key ${'f'.repeat(64)}`,
        `decryption-nonce ${'0'.repeat(32)}`
      ]
    ]
  };

  /** Community whose kind-9 timeline carries one plain + one attachment message. */
  function makeAttachmentCommunity() {
    return {
      channelStore: () => ({
        timeline: (/** @type {any[]} */ filters) => {
          const kind = filters?.[0]?.kinds?.[0];
          if (kind === 7) return of([]);
          return of([message1, attMessage]);
        }
      }),
      members$: new BehaviorSubject(new Set([ACTIVE_PUBKEY, OTHER_PUBKEY])),
      react: vi.fn()
    };
  }

  it('hands MessageAttachments the parsed imeta attachment and strips its URL from the rendered content', async () => {
    const { container } = render(ChannelChat, {
      props: {
        community: makeAttachmentCommunity(),
        channel: CHANNEL,
        openOverlay: () => {},
        onBack: () => {}
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    const stubs = container.querySelectorAll('[data-testid="message-attachments-stub"]');
    expect(stubs).toHaveLength(1); // only the imeta-bearing message gets one

    const atts = JSON.parse(stubs[0].getAttribute('data-attachments') ?? '[]');
    expect(atts).toHaveLength(1);
    expect(atts[0].url).toBe(BLOB_URL);
    expect(atts[0].type).toBe('image/jpeg');
    expect(atts[0].encryption).toEqual({
      algorithm: 'aes-gcm',
      key: 'f'.repeat(64),
      nonce: '0'.repeat(32)
    });

    // The attachment message's bubble renders the STRIPPED clone…
    const contents = [...container.querySelectorAll('[data-testid="ncr-content"]')].map(
      (el) => el.textContent
    );
    expect(contents).toContain('look at this');
    expect(contents.some((c) => c?.includes(BLOB_URL))).toBe(false);
    // …while the plain message's content is untouched.
    expect(contents).toContain('hello');
  });
});

describe('ChannelChat threads', () => {
  const rootMsg = {
    id: 'msg-root',
    kind: 9,
    pubkey: OTHER_PUBKEY,
    content: 'thread me',
    created_at: 1700000000,
    tags: []
  };
  const commentRumor = {
    id: 'cmt-1',
    kind: 1111,
    pubkey: ACTIVE_PUBKEY,
    content: 'a reply',
    created_at: 1700000010,
    tags: [
      ['K', '9'],
      ['E', 'msg-root', '', OTHER_PUBKEY],
      ['P', OTHER_PUBKEY],
      ['k', '9'],
      ['e', 'msg-root', '', OTHER_PUBKEY],
      ['p', OTHER_PUBKEY]
    ]
  };

  function makeThreadCommunity() {
    return {
      channelStore: () => ({
        timeline: (/** @type {any[]} */ filters) => {
          const kind = filters?.[0]?.kinds?.[0];
          if (kind === 7) return of([]);
          if (kind === 1111) return of([commentRumor]);
          return of([rootMsg]);
        }
      }),
      members$: new BehaviorSubject(new Set([ACTIVE_PUBKEY, OTHER_PUBKEY])),
      react: vi.fn(),
      sendEvent: vi.fn().mockResolvedValue('rumor-id')
    };
  }

  it('shows a reply-count badge on the thread root and opens the ThreadPanel on click', async () => {
    const { container } = render(ChannelChat, {
      props: {
        community: makeThreadCommunity(),
        channel: CHANNEL,
        openOverlay: () => {},
        onBack: () => {}
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    const badge = container.querySelector('[data-testid="thread-badge"]');
    expect(badge?.textContent).toContain('1 replies');
    expect(screen.queryByText('Thread')).toBeNull(); // panel closed

    await fireEvent.click(/** @type {HTMLElement} */ (badge));
    await Promise.resolve();

    expect(screen.getByText('Thread')).toBeTruthy(); // panel open
    // the panel shows the reply
    const contents = [...container.querySelectorAll('[data-testid="ncr-content"]')].map(
      (el) => el.textContent
    );
    expect(contents).toContain('a reply');
  });

  it('offers a hover start-thread button on messages without replies', async () => {
    const community = makeThreadCommunity();
    community.channelStore = () => ({
      timeline: (/** @type {any[]} */ filters) => {
        const kind = filters?.[0]?.kinds?.[0];
        if (kind === 7 || kind === 1111) return of([]);
        return of([rootMsg]);
      }
    });
    const { container } = render(ChannelChat, {
      props: { community, channel: CHANNEL, openOverlay: () => {}, onBack: () => {} }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('[data-testid="thread-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="thread-start"]')).toBeTruthy();
  });
});

describe('ChannelChat polls', () => {
  const pollRumor = {
    id: 'poll-1',
    kind: 1068,
    pubkey: OTHER_PUBKEY,
    content: 'Best bee?',
    created_at: 1700000000,
    tags: [
      ['option', 'opt-a', 'Honey bee'],
      ['option', 'opt-b', 'Bumble bee'],
      ['polltype', 'singlechoice']
    ]
  };
  const voteRumor = {
    id: 'vote-1',
    kind: 1018,
    pubkey: ACTIVE_PUBKEY,
    content: '',
    created_at: 1700000010,
    ms: 1700000010000,
    tags: [
      ['e', 'poll-1'],
      ['response', 'opt-a']
    ]
  };

  function makePollCommunity(sendEvent = vi.fn().mockResolvedValue('rumor-id')) {
    return {
      channelStore: () => ({
        timeline: (/** @type {any[]} */ filters) => {
          const kinds = filters?.[0]?.kinds ?? [];
          if (kinds.includes(9)) return of([pollRumor]); // message timeline (9 + 1068)
          if (kinds.includes(1018)) return of([voteRumor]);
          return of([]);
        }
      }),
      members$: new BehaviorSubject(new Set([ACTIVE_PUBKEY, OTHER_PUBKEY])),
      react: vi.fn(),
      sendEvent
    };
  }

  it('requests kinds 9+1068 for the timeline and renders a poll row with its tally', async () => {
    const { container } = render(ChannelChat, {
      props: {
        community: makePollCommunity(),
        channel: CHANNEL,
        openOverlay: () => {},
        onBack: () => {}
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    const stub = container.querySelector('[data-testid="poll-message-stub"]');
    expect(stub).toBeTruthy();
    const poll = JSON.parse(stub?.getAttribute('data-poll') ?? '{}');
    expect(poll.id).toBe('poll-1');
    expect(poll.question).toBe('Best bee?');
    expect(poll.options).toHaveLength(2);
    expect(stub?.getAttribute('data-total-voters')).toBe('1'); // the kind-1018 vote counted
    expect(stub?.getAttribute('data-ended')).toBe('false');
  });

  it('publishes a kind-1018 vote through community.sendEvent', async () => {
    const sendEvent = vi.fn().mockResolvedValue('rumor-id');
    const { container } = render(ChannelChat, {
      props: {
        community: makePollCommunity(sendEvent),
        channel: CHANNEL,
        openOverlay: () => {},
        onBack: () => {}
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="poll-vote-stub"]'))
    );
    await Promise.resolve();

    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [channelId, template] = sendEvent.mock.calls[0];
    expect(channelId).toBe('chan-1');
    expect(template.kind).toBe(1018);
    expect(template.tags).toEqual([
      ['e', 'poll-1'],
      ['response', 'opt-a']
    ]);
  });
});

describe('ChannelChat calendar events', () => {
  const FUTURE = Math.floor(Date.now() / 1000) + 86400;
  const eventRumor = {
    id: 'ev-1',
    kind: 31923,
    pubkey: OTHER_PUBKEY,
    content: '',
    created_at: 1700000000,
    tags: [
      ['d', 'standup'],
      ['title', 'Standup'],
      ['start', String(FUTURE)]
    ]
  };

  it('surfaces channel events in the bar and publishes RSVPs via sendEvent', async () => {
    const sendEvent = vi.fn().mockResolvedValue('rumor-id');
    const community = {
      channelStore: () => ({
        timeline: (/** @type {any[]} */ filters) => {
          const kinds = filters?.[0]?.kinds ?? [];
          if (kinds.includes(31922)) return of([eventRumor]);
          if (kinds.includes(9)) return of([message1]);
          return of([]);
        }
      }),
      members$: new BehaviorSubject(new Set([ACTIVE_PUBKEY, OTHER_PUBKEY])),
      react: vi.fn(),
      sendEvent
    };

    const { container } = render(ChannelChat, {
      props: { community, channel: CHANNEL, openOverlay: () => {}, onBack: () => {} }
    });
    await Promise.resolve();
    await Promise.resolve();

    const toggle = container.querySelector('[data-testid="events-bar-toggle"]');
    expect(toggle?.textContent).toContain('1 upcoming events');

    await fireEvent.click(/** @type {HTMLElement} */ (toggle));
    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="rsvp-accepted"]'))
    );
    await Promise.resolve();

    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [channelId, template] = sendEvent.mock.calls[0];
    expect(channelId).toBe('chan-1');
    expect(template.kind).toBe(31925);
    expect(template.tags).toEqual([
      ['e', 'ev-1'],
      ['status', 'accepted']
    ]);
  });
});

describe('ChannelChat zaps', () => {
  it('shows a verified zap tally chip on the target message (on-chain rail)', async () => {
    const onchainZap = {
      id: 'zap-1',
      kind: 8333,
      pubkey: ACTIVE_PUBKEY,
      content: '',
      created_at: 1700000010,
      tags: [
        ['e', 'msg-1'],
        ['i', `bitcoin:tx:${'f'.repeat(64)}`],
        ['amount', '21'] // sats
      ]
    };
    const community = {
      channelStore: () => ({
        timeline: (/** @type {any[]} */ filters) => {
          const kinds = filters?.[0]?.kinds ?? [];
          if (kinds.includes(9735)) return of([onchainZap]);
          if (kinds.includes(9)) return of([message1]);
          return of([]);
        }
      }),
      members$: new BehaviorSubject(new Set([ACTIVE_PUBKEY, OTHER_PUBKEY])),
      react: vi.fn()
    };

    const { container } = render(ChannelChat, {
      props: { community, channel: CHANNEL, openOverlay: () => {}, onBack: () => {} }
    });
    // the verdict resolves through a promise chain -> flush microtasks + a tick
    await Promise.resolve();
    await Promise.resolve();
    await tick();
    await Promise.resolve();
    await tick();

    const chip = container.querySelector('[data-testid="zap-tally"]');
    expect(chip?.textContent).toContain('⚡ 21');
    expect(chip?.getAttribute('title')).toBe('1×');
  });

  it('never shows a chip for an unverifiable zap rumor', async () => {
    const bogusZap = {
      id: 'zap-bad',
      kind: 8333,
      pubkey: ACTIVE_PUBKEY,
      content: '',
      created_at: 1700000010,
      tags: [
        ['e', 'msg-1'],
        ['i', 'bitcoin:tx:nothex'],
        ['amount', '21']
      ]
    };
    const community = {
      channelStore: () => ({
        timeline: (/** @type {any[]} */ filters) => {
          const kinds = filters?.[0]?.kinds ?? [];
          if (kinds.includes(9735)) return of([bogusZap]);
          if (kinds.includes(9)) return of([message1]);
          return of([]);
        }
      }),
      members$: new BehaviorSubject(new Set([ACTIVE_PUBKEY, OTHER_PUBKEY])),
      react: vi.fn()
    };

    const { container } = render(ChannelChat, {
      props: { community, channel: CHANNEL, openOverlay: () => {}, onBack: () => {} }
    });
    await Promise.resolve();
    await tick();
    await Promise.resolve();
    await tick();

    expect(container.querySelector('[data-testid="zap-tally"]')).toBeNull();
  });
});
