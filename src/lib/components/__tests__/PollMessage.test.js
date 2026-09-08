/**
 * PollMessage — NIP-88 poll inside a chat bubble (NIP-29 group rooms and
 * Concord channels). The question itself is the bubble's content, rendered
 * by the caller; this component adapts the channel tally onto the shared
 * PollBody so chat polls look and behave like the community poll cards:
 * pick, then "Cast vote"; results (bars + voter avatars) after voting.
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
  useProfileMap: (/** @type {() => Iterable<string>} */ getPubkeys) => () => {
    /** @type {Map<string, any>} */
    const map = new Map();
    for (const pubkey of getPubkeys()) map.set(pubkey, { name: 'Voter ' + pubkey });
    return map;
  }
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
  pollType: /** @type {const} */ ('singlechoice'),
  endsAt: undefined
};

/**
 * Build a Concord-shaped tally from voter pubkeys per option.
 * @param {Record<string, string[]>} votersByOption
 * @param {number} totalVoters
 * @param {Set<string>} [myVote]
 */
function tally(votersByOption, totalVoters, myVote) {
  const counts = new Map();
  const voters = new Map();
  for (const [id, pubkeys] of Object.entries(votersByOption)) {
    counts.set(id, pubkeys.length);
    voters.set(id, pubkeys);
  }
  return { counts, voters, totalVoters, myVote };
}

describe('PollMessage', () => {
  it('renders every option as a selectable button plus the voter total, tally hidden', () => {
    render(PollMessage, {
      poll,
      tally: tally({ 'opt-a': ['p1', 'p2', 'p3'] }, 4, undefined),
      ended: false,
      onVote: () => {}
    });
    expect(screen.getByRole('button', { name: 'Honey bee' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bumble bee' })).toBeTruthy();
    expect(screen.getByText('4 voters')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('single choice: pick an option, then Cast vote submits exactly that option', async () => {
    const onVote = vi.fn().mockResolvedValue(true);
    render(PollMessage, { poll, tally: tally({}, 0, undefined), ended: false, onVote });
    await fireEvent.click(screen.getByRole('button', { name: 'Bumble bee' }));
    expect(onVote).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Cast vote' }));
    expect(onVote).toHaveBeenCalledWith(['opt-b']);
  });

  it('multiple choice: several picks are submitted together', async () => {
    const onVote = vi.fn().mockResolvedValue(true);
    render(PollMessage, {
      poll: { ...poll, pollType: 'multiplechoice' },
      tally: tally({}, 0, undefined),
      ended: false,
      onVote
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Honey bee' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Bumble bee' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cast vote' }));
    expect(onVote).toHaveBeenCalledWith(['opt-a', 'opt-b']);
  });

  it('an ended poll shows the closed badge and the results, with nothing to click', () => {
    render(PollMessage, {
      poll,
      tally: tally({ 'opt-a': ['p1'] }, 1, undefined),
      ended: true,
      onVote: () => {}
    });
    expect(screen.getByText('Poll closed')).toBeTruthy();
    expect(screen.getByText('100% · 1')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks my vote with a ✓ and the "You voted" badge and draws the voter avatars', () => {
    const { container } = render(PollMessage, {
      poll,
      tally: tally({ 'opt-a': ['me', 'p2'] }, 2, new Set(['opt-a'])),
      ended: false,
      onVote: () => {}
    });
    expect(screen.getByText('✓ Honey bee')).toBeTruthy();
    expect(screen.getByTestId('poll-you-voted')).toBeTruthy();
    const avatars = [...container.querySelectorAll('[data-testid="voter-avatar"] [data-pubkey]')];
    expect(avatars.map((a) => a.getAttribute('data-pubkey'))).toEqual(['me', 'p2']);
  });

  it('wraps the poll in a card so it reads on both own and foreign bubbles', () => {
    const { container } = render(PollMessage, {
      poll,
      tally: tally({}, 0, undefined),
      ended: false,
      onVote: () => {}
    });
    const card = container.querySelector('[data-testid="poll-message"]');
    expect(card?.className).toContain('bg-base-100');
    expect(card?.className).toContain('text-base-content');
  });
});
