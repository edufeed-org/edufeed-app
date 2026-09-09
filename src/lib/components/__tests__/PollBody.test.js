/**
 * PollBody — the shared NIP-88 poll layout (meta line, option buttons /
 * result bars, vote actions, voter avatars) rendered by both PollCard
 * (community sections, feeds) and PollMessage (group / channel chat).
 * It is purely presentational: tally in, selected option ids out.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

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

vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => {
  const Stub = (await import('./PollCardProfileAvatarStub.svelte')).default;
  return { default: Stub };
});

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (/** @type {string} */ pubkey) => (pubkey ? `/p/${pubkey}` : '#')
}));

const { default: PollBody } = await import('$lib/components/polls/PollBody.svelte');

const options = [
  { id: 'opt-a', label: 'Honey bee' },
  { id: 'opt-b', label: 'Bumble bee' }
];

/**
 * @param {Record<string, string[]>} voters - option id → voter pubkeys
 */
function byOption(voters) {
  const map = new Map();
  for (const opt of options) {
    const v = voters[opt.id] ?? [];
    map.set(opt.id, { count: v.length, voters: v });
  }
  return map;
}

/**
 * @param {Partial<Record<string, any>>} [overrides]
 * @returns {any} - loosely typed so literal props read as the component's unions
 */
function props(overrides = {}) {
  return {
    options,
    pollType: 'singlechoice',
    byOption: byOption({}),
    totalVoters: 0,
    userVote: null,
    isClosed: false,
    endsAt: null,
    onCastVote: vi.fn().mockResolvedValue(true),
    ...overrides
  };
}

describe('PollBody — pre-vote', () => {
  it('shows the poll type, the voter count, and every option as a selectable button', () => {
    render(
      PollBody,
      props({ totalVoters: 3, byOption: byOption({ 'opt-a': ['p1', 'p2', 'p3'] }) })
    );
    expect(screen.getByText('Single choice')).toBeTruthy();
    expect(screen.getByText('3 voters')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Honey bee' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bumble bee' })).toBeTruthy();
    // Tally stays hidden until the viewer votes or explicitly reveals it.
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('single choice: picking a second option replaces the first', async () => {
    render(PollBody, props());
    const a = screen.getByRole('button', { name: 'Honey bee' });
    const b = screen.getByRole('button', { name: 'Bumble bee' });
    await fireEvent.click(a);
    expect(a.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(b);
    expect(a.getAttribute('aria-pressed')).toBe('false');
    expect(b.getAttribute('aria-pressed')).toBe('true');
  });

  it('multiple choice: selections accumulate and toggle off again', async () => {
    render(PollBody, props({ pollType: 'multiplechoice' }));
    expect(screen.getByText('Multiple choice')).toBeTruthy();
    const a = screen.getByRole('button', { name: 'Honey bee' });
    const b = screen.getByRole('button', { name: 'Bumble bee' });
    await fireEvent.click(a);
    await fireEvent.click(b);
    expect(a.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(a);
    expect(a.getAttribute('aria-pressed')).toBe('false');
  });

  it('Cast vote is disabled until something is selected, then submits the selected ids', async () => {
    const onCastVote = vi.fn().mockResolvedValue(true);
    render(PollBody, props({ pollType: 'multiplechoice', onCastVote }));
    const cast = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: 'Cast vote' })
    );
    expect(cast.disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Honey bee' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Bumble bee' }));
    expect(cast.disabled).toBe(false);
    await fireEvent.click(cast);
    expect(onCastVote).toHaveBeenCalledWith(['opt-a', 'opt-b']);
  });

  it('disables Cast vote while pending; a failed vote keeps the selection for a retry', async () => {
    /** @type {(v: boolean) => void} */
    let resolveVote = () => {};
    const onCastVote = vi.fn(() => new Promise((r) => (resolveVote = r)));
    render(PollBody, props({ onCastVote }));
    await fireEvent.click(screen.getByRole('button', { name: 'Honey bee' }));
    const cast = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: 'Cast vote' })
    );
    await fireEvent.click(cast);
    await fireEvent.click(cast);
    expect(onCastVote).toHaveBeenCalledTimes(1);
    expect(cast.disabled).toBe(true);
    resolveVote(false);
    await waitFor(() => expect(cast.disabled).toBe(false));
    expect(screen.getByRole('button', { name: 'Honey bee' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('a successful vote clears the selection', async () => {
    render(PollBody, props());
    await fireEvent.click(screen.getByRole('button', { name: 'Honey bee' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cast vote' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Honey bee' }).getAttribute('aria-pressed')).toBe(
        'false'
      )
    );
  });

  it('shows "Log in to vote" instead of Cast vote when the viewer cannot vote', () => {
    render(PollBody, props({ canVote: false }));
    expect(screen.getByText('Log in to vote')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cast vote' })).toBeNull();
  });

  it('"Show results without voting" reveals the tally, "Back to vote" hides it again', async () => {
    render(PollBody, props({ totalVoters: 2, byOption: byOption({ 'opt-a': ['p1', 'p2'] }) }));
    await fireEvent.click(screen.getByRole('button', { name: 'Show results without voting' }));
    expect(screen.getByText('100% · 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Honey bee' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Back to vote' }));
    expect(screen.getByRole('button', { name: 'Honey bee' })).toBeTruthy();
  });
});

describe('PollBody — results', () => {
  it('after voting: result bars, a ✓ on my pick, the "You voted" badge, no Cast vote', () => {
    render(
      PollBody,
      props({
        totalVoters: 2,
        byOption: byOption({ 'opt-a': ['me', 'p2'] }),
        userVote: ['opt-a']
      })
    );
    expect(screen.getByTestId('poll-you-voted').textContent).toBe('You voted');
    expect(screen.getByText('✓ Honey bee')).toBeTruthy();
    expect(screen.getByText('100% · 2')).toBeTruthy();
    expect(screen.getByText('0% · 0')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cast vote' })).toBeNull();
  });

  it('a closed poll shows the closed badge and results only, even without a vote', () => {
    render(PollBody, props({ isClosed: true, endsAt: 1_000, totalVoters: 0 }));
    expect(screen.getByText('Poll closed')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText('0% · 0')).toHaveLength(2);
  });

  it('an open poll with a deadline shows when it ends, in European date order without seconds', () => {
    // 2026-03-05 14:07:09 local time — day and month differ so day-first
    // order is provable. Tests run in the default (en) locale, which the
    // dates helper maps to en-GB; de renders the same as 05.03.2026, 14:07.
    const endsAt = Math.floor(new Date(2026, 2, 5, 14, 7, 9).getTime() / 1000);
    render(PollBody, props({ endsAt }));
    expect(screen.getByText('Ends 05/03/2026, 14:07')).toBeTruthy();
    expect(screen.queryByText('Poll closed')).toBeNull();
  });

  it('renders one avatar per voter and a "+N" overflow beyond six', () => {
    const voters = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'];
    const profiles = new Map(voters.map((p) => [p, { name: 'Voter ' + p }]));
    const { container } = render(
      PollBody,
      props({
        totalVoters: 8,
        byOption: byOption({ 'opt-a': voters }),
        userVote: ['opt-a'],
        profiles
      })
    );
    const avatars = container.querySelectorAll('[data-testid="voter-avatar"] [data-pubkey]');
    expect(avatars).toHaveLength(6);
    expect(screen.getByTestId('poll-overflow-voters').textContent?.trim()).toBe('+2');
  });

  it('"Change vote" re-opens the options with my current vote preselected and submits the new pick', async () => {
    const onCastVote = vi.fn().mockResolvedValue(true);
    render(
      PollBody,
      props({
        totalVoters: 1,
        byOption: byOption({ 'opt-a': ['me'] }),
        userVote: ['opt-a'],
        onCastVote
      })
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Change vote' }));
    const a = screen.getByRole('button', { name: 'Honey bee' });
    expect(a.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Bumble bee' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cast vote' }));
    expect(onCastVote).toHaveBeenCalledWith(['opt-b']);
  });

  it('"Keep my vote" abandons a vote change and returns to the results', async () => {
    render(
      PollBody,
      props({ totalVoters: 1, byOption: byOption({ 'opt-a': ['me'] }), userVote: ['opt-a'] })
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Change vote' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Keep my vote' }));
    expect(screen.getByText('✓ Honey bee')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cast vote' })).toBeNull();
  });

  it('offers no "Change vote" on a closed poll or when the viewer cannot vote', () => {
    const { unmount } = render(
      PollBody,
      props({
        userVote: ['opt-a'],
        isClosed: true,
        totalVoters: 1,
        byOption: byOption({ 'opt-a': ['me'] })
      })
    );
    expect(screen.queryByRole('button', { name: 'Change vote' })).toBeNull();
    unmount();
    render(
      PollBody,
      props({
        userVote: ['opt-a'],
        canVote: false,
        totalVoters: 1,
        byOption: byOption({ 'opt-a': ['me'] })
      })
    );
    expect(screen.queryByRole('button', { name: 'Change vote' })).toBeNull();
  });

  it('a parent re-render with a fresh (equal) tally does not clobber an in-flight selection', async () => {
    const { rerender } = render(PollBody, props({ pollType: 'multiplechoice' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Honey bee' }));
    await rerender(props({ pollType: 'multiplechoice' }));
    expect(screen.getByRole('button', { name: 'Honey bee' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });
});
