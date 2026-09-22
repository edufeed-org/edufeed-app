// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * The thread must show a file bubble and the private reactions attached to a
 * message. Mock preamble mirrors ConversationThread.emoji.test.js.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { of } from 'rxjs';
import { nip19 } from 'nostr-tools';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const COMMUNITY = 'c'.repeat(64);

const threadEmission = vi.hoisted(() => ({
  value: { messages: [], reactionsByTarget: new Map() }
}));
vi.mock('$lib/models/wrapped-dm.js', () => ({
  DmThreadModel: () => () => of(threadEmission.value),
  DmConversationsModel: () => () => of([]),
  DmRumorsModel: () => () => of([])
}));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { model: (factory, ...args) => factory(...args)({}) },
  pool: {}
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => ({ pubkey: ME }) }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/stores/user-emoji-sets.svelte.js', () => ({ useUserEmojiSets: () => () => [] }));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: { run: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  markConversationAsRead: vi.fn(),
  ensureLegacyMessagesUnlocked: vi.fn().mockResolvedValue(new Set()),
  fetchLegacyConversationHistory: vi.fn()
}));
vi.mock('$lib/services/dm-recipient-relays.js', () => ({
  ensureRecipientDmRelays: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/services/wrapped-dm.js', () => ({ sendWrappedDm: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$lib/helpers/nostrUtils.js', () => ({ profileLink: (pk) => `/p/${pk}` }));
vi.mock('$lib/stores/mute-list.svelte.js', () => ({
  getMutedPubkeys: () => new Set(),
  muteUser: vi.fn(),
  unmuteUser: vi.fn()
}));
vi.mock('$lib/components/dm/DmFileMessage.svelte', async () => {
  const mock = await import('./__mocks__/EmptyStub.svelte');
  return { default: mock.default };
});
vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => {
  const mock = await import('./__mocks__/EmptyStub.svelte');
  return { default: mock.default };
});

import ConversationThread from '$lib/components/dm/ConversationThread.svelte';

const chat = {
  id: 'r1',
  pubkey: PEER,
  kind: 14,
  created_at: 100,
  tags: [['p', ME]],
  content: 'hallo'
};
const fileMsg = {
  id: 'r2',
  pubkey: PEER,
  kind: 15,
  created_at: 200,
  tags: [['p', ME]],
  content: 'https://x/a.bin'
};

describe('ConversationThread message kinds', () => {
  it('renders a file bubble for a kind-15 message', async () => {
    threadEmission.value = { messages: [chat, fileMsg], reactionsByTarget: new Map() };
    render(ConversationThread, {
      props: { conversationId: `${ME}:${PEER}`, participants: [ME, PEER] }
    });
    expect(await screen.findByTestId('dm-file-bubble')).toBeTruthy();
  });

  it('shows the private reactions attached to a message', async () => {
    threadEmission.value = {
      messages: [chat],
      reactionsByTarget: new Map([
        [
          'r1',
          [{ id: 'r3', pubkey: ME, kind: 7, created_at: 300, tags: [['e', 'r1']], content: '🔥' }]
        ]
      ])
    };
    render(ConversationThread, {
      props: { conversationId: `${ME}:${PEER}`, participants: [ME, PEER] }
    });
    expect((await screen.findByTestId('dm-message-reactions')).textContent).toContain('🔥');
  });

  it('shows no reaction strip when there are none', async () => {
    threadEmission.value = { messages: [chat], reactionsByTarget: new Map() };
    render(ConversationThread, {
      props: { conversationId: `${ME}:${PEER}`, participants: [ME, PEER] }
    });
    await screen.findByText('hallo');
    expect(screen.queryByTestId('dm-message-reactions')).toBeNull();
  });

  it('renders a group invite DM as an invite card with a join CTA', async () => {
    const joinUrl = `https://dev.edufeed.org/c/${nip19.npubEncode(COMMUNITY)}?join=hMX6PYy4m37J`;
    const invite = {
      id: 'r4',
      pubkey: PEER,
      kind: 14,
      created_at: 400,
      tags: [['p', ME]],
      content: `Du bist eingeladen, ALPIKA beizutreten. Öffne diesen Link:\n${joinUrl}`
    };
    threadEmission.value = { messages: [chat, invite], reactionsByTarget: new Map() };
    render(ConversationThread, {
      props: { conversationId: `${ME}:${PEER}`, participants: [ME, PEER] }
    });
    const card = await screen.findByTestId('dm-group-invite');
    expect(card.querySelector('[data-testid="group-invite-cta"]')?.getAttribute('href')).toBe(
      joinUrl
    );
    // The raw body is not rendered a second time underneath the card.
    expect(screen.queryByText(/Öffne diesen Link/)).toBeNull();
  });
});
