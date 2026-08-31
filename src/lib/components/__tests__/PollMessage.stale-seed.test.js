/**
 * FAILING-FIRST probes for the PollMessage `state_referenced_locally` defect
 * (TestOER finding, 2026-08-04; confirmed at 07753b2f — PollMessage.svelte:18
 * seeds `selection` once at mount while ChannelChat.svelte:551 recomputes the
 * tally live). Drop into src/lib/components/__tests__/ ON the fix branch and
 * run against the UNFIXED tip first: probe 1 must FAIL there.
 *
 * Probe 2 guards against the naive fix: ChannelChat builds a NEW tally object
 * every render, so a blind $effect re-seed keyed on object identity would
 * clobber the user's in-flight toggles on every parent render. Re-seed must
 * key on vote CONTENT, and a user's explicit change must win over an
 * equal-content echo.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  concord_poll_votes: (/** @type {{ count: number }} */ { count }) => `${count} votes`,
  concord_poll_ended: () => 'Poll ended',
  concord_poll_vote: () => 'Vote'
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

/** @param {Map<string, number>} counts @param {number} totalVoters @param {Set<string>} [myVote] */
function tally(counts, totalVoters, myVote) {
  return { counts, totalVoters, myVote };
}

describe('PollMessage — late-hydrating myVote (kind-1018 votes arrive after mount)', () => {
  it('re-seeds the checkboxes and a re-vote keeps the earlier choices', async () => {
    const onVote = vi.fn();
    const { rerender } = render(PollMessage, {
      poll,
      // Poll message renders before any votes hydrate from the relay.
      tally: tally(new Map(), 0, undefined),
      ended: false,
      onVote
    });

    // My earlier vote for opt-a streams in; parent recomputes the tally prop.
    await rerender({ tally: tally(new Map([['opt-a', 1]]), 1, new Set(['opt-a'])) });

    // Cosmetic half: the checkbox must agree with data-my-vote.
    const a = /** @type {HTMLInputElement} */ (screen.getByLabelText('Honey bee'));
    expect(a.checked).toBe(true);

    // Data-loss half: adding opt-b must submit {opt-a, opt-b}, not just {opt-b}
    // (NIP-88 latest-per-pubkey REPLACES the vote, so a partial submit silently
    // drops the earlier choices).
    await fireEvent.click(screen.getByLabelText('Bumble bee'));
    await fireEvent.click(screen.getByText('Vote'));
    expect(onVote).toHaveBeenCalledTimes(1);
    expect([...onVote.mock.calls[0][0]].sort()).toEqual(['opt-a', 'opt-b']);
  });

  it('an equal-content tally echo does not clobber an in-flight uncheck', async () => {
    const onVote = vi.fn();
    const seeded = () => tally(new Map([['opt-a', 1]]), 1, new Set(['opt-a']));
    const { rerender } = render(PollMessage, {
      poll,
      tally: seeded(),
      ended: false,
      onVote
    });

    const a = /** @type {HTMLInputElement} */ (screen.getByLabelText('Honey bee'));
    expect(a.checked).toBe(true);

    // User unchecks their prior choice but has not submitted yet…
    await fireEvent.click(a);
    expect(a.checked).toBe(false);

    // …and the parent re-renders with a NEW object carrying the SAME vote
    // content (ChannelChat rebuilds the tally every render). The user's
    // in-flight toggle must survive.
    await rerender({ tally: seeded() });
    expect(a.checked).toBe(false);
  });
});
