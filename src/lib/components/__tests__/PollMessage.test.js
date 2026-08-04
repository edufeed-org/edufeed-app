/**
 * PollMessage — NIP-88 poll options + tally UI inside a chat bubble (the
 * question itself is the bubble's content, rendered by the caller).
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
  pollType: /** @type {const} */ ('singlechoice'),
  endsAt: undefined
};

/** @param {Map<string, number>} counts @param {number} totalVoters @param {Set<string>} [myVote] */
function tally(counts, totalVoters, myVote) {
  return { counts, totalVoters, myVote };
}

describe('PollMessage', () => {
  it('renders every option with its count and the voter total', () => {
    render(PollMessage, {
      poll,
      tally: tally(new Map([['opt-a', 3]]), 4, undefined),
      ended: false,
      onVote: () => {}
    });
    expect(screen.getByText('Honey bee')).toBeTruthy();
    expect(screen.getByText('Bumble bee')).toBeTruthy();
    expect(screen.getByText('4 votes')).toBeTruthy();
  });

  it('single choice: clicking an option votes for exactly that option', async () => {
    const onVote = vi.fn();
    render(PollMessage, {
      poll,
      tally: tally(new Map(), 0, undefined),
      ended: false,
      onVote
    });
    await fireEvent.click(screen.getByText('Bumble bee'));
    expect(onVote).toHaveBeenCalledWith(['opt-b']);
  });

  it('multiple choice: checkboxes collect a selection, the Vote button submits it', async () => {
    const onVote = vi.fn();
    render(PollMessage, {
      poll: { ...poll, pollType: 'multiplechoice' },
      tally: tally(new Map(), 0, undefined),
      ended: false,
      onVote
    });
    await fireEvent.click(screen.getByLabelText('Honey bee'));
    await fireEvent.click(screen.getByLabelText('Bumble bee'));
    await fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
    expect(onVote).toHaveBeenCalledWith(['opt-a', 'opt-b']);
  });

  it('an ended poll shows the ended label and never calls onVote', async () => {
    const onVote = vi.fn();
    render(PollMessage, {
      poll,
      tally: tally(new Map([['opt-a', 1]]), 1, undefined),
      ended: true,
      onVote
    });
    expect(screen.getByText('Poll ended')).toBeTruthy();
    await fireEvent.click(screen.getByText('Honey bee'));
    expect(onVote).not.toHaveBeenCalled();
  });

  it('marks the option(s) I voted for', () => {
    const { container } = render(PollMessage, {
      poll,
      tally: tally(new Map([['opt-a', 1]]), 1, new Set(['opt-a'])),
      ended: false,
      onVote: () => {}
    });
    const mine = container.querySelector('[data-my-vote="true"]');
    expect(mine?.textContent).toContain('Honey bee');
  });
});
