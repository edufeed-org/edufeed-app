/**
 * PollMessage — late-hydrating votes. Kind-1018 votes stream in AFTER the
 * poll row mounts, and ChannelChat / GroupChat rebuild the tally object on
 * every render. Two hazards (TestOER finding, 2026-08-04, originally against
 * the checkbox layout; re-asserted against the shared PollBody layout):
 *
 *  1. A vote that hydrates after mount must flip the row into its "voted"
 *     state, and a later "Change vote" must start from that vote so a
 *     partial re-submit cannot silently drop earlier choices (NIP-88
 *     latest-per-pubkey REPLACES the vote).
 *  2. A parent re-render with an equal-content tally must not clobber the
 *     user's in-flight selection.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    // @ts-ignore
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {}
    });
  }
});

vi.mock('$lib/paraglide/messages.js', () => ({
  poll_type_single: () => 'Single choice',
  poll_type_multiple: () => 'Multiple choice',
  poll_voter_count_one: () => '1 voter',
  poll_voter_count_other: (/** @type {{ count: number }} */ { count }) => `${count} voters`,
  poll_you_voted: () => 'You voted',
  poll_closed: () => 'Poll closed',
  poll_ends_at: (/** @type {{ date: string }} */ { date }) => `Ends ${date}`,
  poll_cast_vote: () => 'Cast vote',
  poll_show_results: () => 'Show results without voting',
  poll_back_to_vote: () => 'Back to vote',
  poll_change_vote: () => 'Change vote',
  poll_change_vote_cancel: () => 'Keep my vote',
  poll_login_to_vote: () => 'Log in to vote'
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => {
  const Stub = (await import('./PollCardProfileAvatarStub.svelte')).default;
  return { default: Stub };
});

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (/** @type {string} */ pubkey) => (pubkey ? `/p/${pubkey}` : '#')
}));

const { default: PollMessage } = await import(
  '$lib/components/community/channels/PollMessage.svelte'
);

const poll = {
  id: 'poll-1',
  question: 'Best bee?',
  options: [
    { id: 'opt-a', label: 'Honey bee' },
    { id: 'opt-b', label: 'Bumble bee' }
  ],
  pollType: /** @type {const} */ ('multiplechoice'),
  endsAt: undefined
};

/** @param {Record<string, string[]>} votersByOption @param {number} totalVoters @param {Set<string>} [myVote] */
function tally(votersByOption, totalVoters, myVote) {
  const counts = new Map();
  const voters = new Map();
  for (const [id, pubkeys] of Object.entries(votersByOption)) {
    counts.set(id, pubkeys.length);
    voters.set(id, pubkeys);
  }
  return { counts, voters, totalVoters, myVote };
}

describe('PollMessage — late-hydrating myVote (kind-1018 votes arrive after mount)', () => {
  it('flips into the voted state and a vote change starts from the hydrated vote', async () => {
    const onVote = vi.fn().mockResolvedValue(true);
    const { rerender } = render(PollMessage, {
      poll,
      // Poll message renders before any votes hydrate from the relay.
      tally: tally({}, 0, undefined),
      ended: false,
      onVote
    });
    expect(screen.getByRole('button', { name: 'Honey bee' })).toBeTruthy();

    // My earlier vote for opt-a streams in; parent recomputes the tally prop.
    await rerender({ tally: tally({ 'opt-a': ['me'] }, 1, new Set(['opt-a'])) });
    expect(screen.getByTestId('poll-you-voted')).toBeTruthy();
    expect(screen.getByText('✓ Honey bee')).toBeTruthy();

    // Data-loss half: changing the vote must start from {opt-a}, so adding
    // opt-b submits {opt-a, opt-b} rather than just {opt-b}.
    await fireEvent.click(screen.getByRole('button', { name: 'Change vote' }));
    expect(screen.getByRole('button', { name: 'Honey bee' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Bumble bee' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cast vote' }));
    expect(onVote).toHaveBeenCalledTimes(1);
    expect([...onVote.mock.calls[0][0]].sort()).toEqual(['opt-a', 'opt-b']);
  });

  it('an equal-content tally echo does not clobber an in-flight vote change', async () => {
    const seeded = () => tally({ 'opt-a': ['me'] }, 1, new Set(['opt-a']));
    const { rerender } = render(PollMessage, {
      poll,
      tally: seeded(),
      ended: false,
      onVote: vi.fn()
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Change vote' }));
    const a = screen.getByRole('button', { name: 'Honey bee' });
    expect(a.getAttribute('aria-pressed')).toBe('true');

    // User deselects their prior choice but has not submitted yet…
    await fireEvent.click(a);
    expect(a.getAttribute('aria-pressed')).toBe('false');

    // …and the parent re-renders with a NEW object carrying the SAME vote
    // content (ChannelChat rebuilds the tally every render). The user's
    // in-flight change must survive: still in the option view, still
    // deselected.
    await rerender({ tally: seeded() });
    expect(screen.getByRole('button', { name: 'Honey bee' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(screen.getByRole('button', { name: 'Cast vote' })).toBeTruthy();
  });
});
