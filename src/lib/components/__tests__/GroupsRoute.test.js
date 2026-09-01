/**
 * /groups — the flat list of the user's kind-10009 groups.
 *
 * The page must delegate its list to useMyGroups (which also asks the user's
 * NIP-65 write relays — a 10009 is a user-owned list, and the page's old
 * fallback-relays-only fetch rendered empty for users whose rail showed
 * groups fine) and resolve each row's display name from the group's kind
 * 39000 like the rail does, instead of printing the raw id.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const GROUP_RELAY = 'wss://groups.example.com/';

vi.mock('$lib/groups/unlinked-groups.svelte.js', () => ({
  useMyGroups: () => () => [
    { id: 'beechat', relay: GROUP_RELAY },
    { id: 'namelesschat', relay: GROUP_RELAY }
  ],
  useUnlinkedGroups: () => () => []
}));

vi.mock('$lib/groups/channel-metadata.svelte.js', () => ({
  useChannelMetadata: () => () => ({
    byKey: {
      [`beechat@${GROUP_RELAY}`]: {
        kind: 39000,
        tags: [
          ['d', 'beechat'],
          ['name', 'Bee Chat']
        ]
      }
    },
    failedRelays: []
  })
}));

vi.mock('$lib/paraglide/messages', () => ({
  groups_title: () => 'Groups',
  groups_join_placeholder: () => 'host…',
  groups_add: () => 'Open',
  groups_empty: () => 'No groups yet',
  groups_invalid_pointer: () => 'Invalid'
}));

const { default: GroupsPage } = await import('../../../routes/groups/+page.svelte');

describe('/groups route', () => {
  it('renders the kind-39000 display name, falling back to the raw id', async () => {
    render(GroupsPage);
    expect(await screen.findByText('Bee Chat')).toBeTruthy();
    // No 39000 arrived for the second group — the raw id is the fallback.
    expect(screen.getByText('namelesschat')).toBeTruthy();
    // The resolved row must not ALSO print its raw id.
    expect(screen.queryByText('beechat')).toBeNull();
  });
});
