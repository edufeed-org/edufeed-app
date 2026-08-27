/** @vitest-environment jsdom */
/**
 * GroupBadges — the id -> text mapping shared by a group's home and the
 * community's channel overview.
 *
 * Found by mutation: making BOTH access ids render "invite only" broke no
 * test. Every caller so far produced the `members` id, so the second branch
 * had never been rendered anywhere — a label that could have said the wrong
 * thing on a whole class of groups with nothing to catch it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import GroupBadges from '$lib/components/groups/GroupBadges.svelte';
import { channelBadges, relayBadges } from '$lib/groups/group-badges.js';

/** The two access ids, from the real reader rather than by hand. */
const privateGroup = channelBadges({ kind: 39000, tags: [['d', 'x'], ['private']] });
const closedGroup = channelBadges({ kind: 39000, tags: [['d', 'x'], ['closed']] });

describe('GroupBadges', () => {
  it('tells the two access ids apart', () => {
    expect(privateGroup).toEqual([{ id: 'members' }]);
    expect(closedGroup).toEqual([{ id: 'invite' }]);

    const { unmount } = render(GroupBadges, { props: { access: privateGroup } });
    const members = screen.getByTestId('group-badge-members').textContent?.trim();
    unmount();

    render(GroupBadges, { props: { access: closedGroup } });
    const invite = screen.getByTestId('group-badge-invite').textContent?.trim();

    expect(members).toBeTruthy();
    expect(invite).toBeTruthy();
    expect(members).not.toBe(invite);
  });

  it('shows the relay software verbatim and translates the rest', () => {
    const host = relayBadges({
      limitation: { auth_required: true },
      supported_nips: [1, 29],
      software: 'git+https://example/pyramid',
      version: '1.2'
    });
    render(GroupBadges, { props: { host } });
    expect(screen.getByTestId('group-badge-software').textContent?.trim()).toBe('pyramid 1.2');
    // The other two are ours to word, so they must NOT read as the raw id.
    expect(screen.getByTestId('group-badge-auth').textContent?.trim()).not.toBe('auth');
    expect(screen.getByTestId('group-badge-nip29').textContent?.trim()).toBeTruthy();
  });

  it('renders nothing at all when there is nothing to say', () => {
    render(GroupBadges, { props: {} });
    expect(screen.queryByTestId('group-badges')).toBeNull();
  });
});
