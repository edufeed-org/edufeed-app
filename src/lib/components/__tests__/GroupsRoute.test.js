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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const GROUP_RELAY = 'wss://groups.example.com/';
const ME = 'a'.repeat(64);
const user = { pubkey: ME, signer: { signEvent: vi.fn() } };

// The page's remove affordance (issue 532c9210) speaks through the same
// door as the chat's join/leave mirror — stubbed at that seam.
const updatePersonalGroupsList = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/groups/personal-groups-list.js', () => ({ updatePersonalGroupsList }));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => user }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

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
  groups_invalid_pointer: () => 'Invalid',
  groups_list_remove: () => 'Remove from my list',
  groups_list_removed: () => 'Removed from your list',
  groups_list_update_failed: () => 'Your list could not be updated'
}));

const { default: GroupsPage } = await import('../../../routes/groups/+page.svelte');

describe('/groups route', () => {
  beforeEach(() => updatePersonalGroupsList.mockClear());

  it('renders the kind-39000 display name, falling back to the raw id', async () => {
    render(GroupsPage);
    expect(await screen.findByText('Bee Chat')).toBeTruthy();
    // No 39000 arrived for the second group — the raw id is the fallback.
    expect(screen.getByText('namelesschat')).toBeTruthy();
    // The resolved row must not ALSO print its raw id.
    expect(screen.queryByText('beechat')).toBeNull();
  });

  it('each row offers "Remove from my list", dropping just that pointer from my 10009', async () => {
    render(GroupsPage);
    await screen.findByText('Bee Chat');
    const buttons = screen.getAllByTestId('group-row-remove');
    expect(buttons).toHaveLength(2);
    await fireEvent.click(buttons[0]);
    await waitFor(() => expect(updatePersonalGroupsList).toHaveBeenCalledTimes(1));
    expect(updatePersonalGroupsList).toHaveBeenCalledWith(user, {
      remove: { id: 'beechat', relay: GROUP_RELAY }
    });
  });
});
