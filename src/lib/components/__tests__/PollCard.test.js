/**
 * PollCard Component Tests — render skeleton + states.
 *
 * Vote action and voter avatars are deferred to later tasks.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

// jsdom does not implement window.matchMedia.
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

import PollCard from '$lib/components/polls/PollCard.svelte';

/** @type {{ active: any }} */
const managerState = vi.hoisted(() => ({ active: null }));

/** @type {{ value: any[] }} */
const mockResponses = vi.hoisted(() => ({ value: [] }));

const factoryCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    kind: 1018,
    content: '',
    created_at: 1,
    tags: [
      ['e', 'pollid'],
      ['response', 'opt-a']
    ]
  })
);

const publishEventSpy = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ success: true, successCount: 1, relays: [], results: [] })
);

const { deleteEventSpy } = vi.hoisted(() => ({
  deleteEventSpy: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('$lib/helpers/eventDeletion.js', () => ({
  deleteEvent: deleteEventSpy
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ create: factoryCreate })
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => publishEventSpy(...args)
}));

// Mock loader to avoid transitive `pool` import from nostr-infrastructure.
// The test populates responses via the eventStore.timeline mock below; the
// loader itself only matters for relay-fetch behavior, which is covered
// elsewhere.
vi.mock('$lib/loaders/polls.js', () => ({
  pollResponsesLoader: () => () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: managerState
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    timeline: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb(mockResponses.value);
        return { unsubscribe: vi.fn() };
      }
    })),
    add: vi.fn(),
    remove: vi.fn(),
    getReplaceable: vi.fn()
  }
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: (/** @type {() => Iterable<string>} */ getPubkeys) => {
    return () => {
      /** @type {Map<string, any>} */
      const m = new Map();
      for (const pubkey of getPubkeys()) {
        m.set(pubkey, { name: 'Voter ' + pubkey.slice(0, 4), picture: undefined });
      }
      return m;
    };
  }
}));

// Stub ProfileAvatar to avoid transitive loader imports + expose the pubkey
// via a data attribute so the voter-avatar test can assert on it.
vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => {
  const Stub = (await import('./PollCardProfileAvatarStub.svelte')).default;
  return { default: Stub };
});

/**
 * Build a minimal kind 1068 poll event.
 * @param {Object} [overrides]
 * @param {string} [overrides.content]
 * @param {Array<[string, ...string[]]>} [overrides.extraTags]
 * @param {number} [overrides.endsAt]
 * @param {string} [overrides.pollType]
 */
function makePoll({ content = 'Fruit?', extraTags = [], endsAt, pollType = 'singlechoice' } = {}) {
  /** @type {Array<string[]>} */
  const tags = [
    ['option', 'opt-a', 'Apple'],
    ['option', 'opt-b', 'Banana'],
    ['polltype', pollType]
  ];
  if (endsAt !== undefined) tags.push(['endsAt', String(endsAt)]);
  for (const t of extraTags) tags.push(/** @type {string[]} */ (t));
  return {
    id: 'poll-1'.padEnd(64, '0'),
    kind: 1068,
    pubkey: 'author'.padEnd(64, '0'),
    created_at: 1700000000,
    tags,
    content
  };
}

describe('PollCard — render skeleton + states', () => {
  beforeEach(() => {
    managerState.active = null;
    mockResponses.value = [];
    vi.clearAllMocks();
  });

  it('renders the question and options', () => {
    render(PollCard, { props: { event: makePoll() } });
    expect(screen.getByText('Fruit?')).toBeTruthy();
    expect(screen.getByText('Apple')).toBeTruthy();
    expect(screen.getByText('Banana')).toBeTruthy();
  });

  it('hides the tally before voting (logged-in pre-vote state)', () => {
    managerState.active = { pubkey: 'me'.padEnd(64, '0') };
    render(PollCard, { props: { event: makePoll() } });
    // No percentage text visible.
    expect(screen.queryByText(/%/)).toBeNull();
    // Reveal CTA is rendered.
    expect(screen.getByRole('button', { name: /show results without voting/i })).toBeTruthy();
  });

  it('shows "Poll closed" badge when endsAt is in the past', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    render(PollCard, { props: { event: makePoll({ endsAt: past }) } });
    expect(screen.getByText(/poll closed/i)).toBeTruthy();
  });

  it('reveals tally when "Show results" clicked', async () => {
    managerState.active = { pubkey: 'me'.padEnd(64, '0') };
    render(PollCard, { props: { event: makePoll() } });
    const reveal = screen.getByRole('button', { name: /show results without voting/i });
    await fireEvent.click(reveal);
    // Reveal button should be gone.
    expect(screen.queryByRole('button', { name: /show results without voting/i })).toBeNull();
    // 0% appears for empty tally.
    expect(screen.getAllByText(/0%/).length).toBeGreaterThan(0);
  });

  it('clamps long questions when truncate=true', () => {
    const { container } = render(PollCard, {
      props: { event: makePoll({ content: 'a'.repeat(500) }), truncate: true }
    });
    const q = container.querySelector('[data-testid="poll-question"]');
    expect(q).toBeTruthy();
    expect(/** @type {Element} */ (q).classList.contains('line-clamp-3')).toBe(true);
  });

  it('marks selected option with aria-pressed=true', async () => {
    managerState.active = { pubkey: 'me'.padEnd(64, '0') };
    const { container } = render(PollCard, { props: { event: makePoll() } });
    const buttons = /** @type {HTMLButtonElement[]} */ (
      Array.from(container.querySelectorAll('button[aria-pressed]'))
    );
    expect(buttons.length).toBe(2);
    await fireEvent.click(buttons[0]);
    const after = /** @type {HTMLButtonElement[]} */ (
      Array.from(container.querySelectorAll('button[aria-pressed]'))
    );
    expect(after[0].getAttribute('aria-pressed')).toBe('true');
    expect(after[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('renders voter avatars when results are shown', async () => {
    managerState.active = { pubkey: 'me'.padEnd(64, '0') };
    const voter1 = 'voter1'.padEnd(64, '0');
    const voter2 = 'voter2'.padEnd(64, '0');
    /**
     * Build a kind 1018 response event for option `optId`.
     * @param {string} pubkey
     * @param {string} optId
     * @param {string} idSeed
     */
    function makeResponse(pubkey, optId, idSeed) {
      return {
        id: idSeed.padEnd(64, '0'),
        kind: 1018,
        pubkey,
        created_at: 1700000100,
        tags: [
          ['e', 'poll-1'.padEnd(64, '0')],
          ['response', optId]
        ],
        content: ''
      };
    }
    mockResponses.value = [
      makeResponse(voter1, 'opt-a', 'r1'),
      makeResponse(voter2, 'opt-a', 'r2')
    ];

    const { container } = render(PollCard, { props: { event: makePoll() } });
    const reveal = screen.getByRole('button', { name: /show results without voting/i });
    await fireEvent.click(reveal);

    const avatars = container.querySelectorAll('[data-testid="voter-avatar"]');
    expect(avatars.length).toBeGreaterThanOrEqual(2);
    // Inner ProfileAvatar stub carries the voter name (a11y + hover tooltip).
    const inner = Array.from(avatars).map((a) => a.querySelector('[data-pubkey]'));
    const titles = inner.map((el) => el?.getAttribute('title'));
    expect(titles.every((t) => t && t.startsWith('Voter '))).toBe(true);
    const ariaLabels = inner.map((el) => el?.getAttribute('aria-label'));
    expect(ariaLabels.every((l) => l && l.startsWith('Voter '))).toBe(true);
    expect(inner[0]?.getAttribute('role')).toBe('img');
  });

  it('casts a vote: signs PollResponseBlueprint output and publishes', async () => {
    managerState.active = {
      pubkey: 'me',
      signEvent: vi.fn().mockResolvedValue({
        id: 'voteid'.padEnd(64, '0'),
        kind: 1018,
        pubkey: 'me',
        sig: 's',
        created_at: 1,
        content: '',
        tags: [
          ['e', 'pollid'],
          ['response', 'opt-a']
        ]
      })
    };

    render(PollCard, { props: { event: makePoll() } });

    await fireEvent.click(screen.getByRole('button', { name: 'Apple' }));
    await fireEvent.click(screen.getByRole('button', { name: /cast vote/i }));

    await waitFor(() => expect(managerState.active.signEvent).toHaveBeenCalled());
    expect(factoryCreate).toHaveBeenCalled();
    expect(publishEventSpy).toHaveBeenCalled();
  });

  it('disables Cast vote button while submitting (no double-submit)', async () => {
    // Mock signEvent to delay so we can observe the disabled state mid-flight.
    /** @type {(value: any) => void} */
    let resolveSign = () => {};
    const signEvent = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSign = resolve;
        })
    );
    managerState.active = { pubkey: 'me', signEvent };

    render(PollCard, { props: { event: makePoll() } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apple' }));

    const castBtn = screen.getByRole('button', { name: /cast vote/i });
    await fireEvent.click(castBtn);

    // Mid-flight: signEvent has been called but hasn't resolved.
    await waitFor(() => expect(signEvent).toHaveBeenCalled());
    expect(/** @type {HTMLButtonElement} */ (castBtn).disabled).toBe(true);

    // Resolve the sign and let the publish path run.
    resolveSign({
      id: 'voteid'.padEnd(64, '0'),
      kind: 1018,
      pubkey: 'me',
      sig: 's',
      created_at: 1,
      content: '',
      tags: [
        ['e', 'pollid'],
        ['response', 'opt-a']
      ]
    });
  });

  it('shows delete affordance to the poll author', async () => {
    managerState.active = { pubkey: 'author'.padEnd(64, '0'), signEvent: vi.fn() };
    render(PollCard, { props: { event: makePoll() } });
    expect(screen.getByRole('button', { name: /delete poll/i })).toBeTruthy();
  });

  it('does NOT show delete affordance to non-authors', async () => {
    managerState.active = { pubkey: 'someone-else'.padEnd(64, '0'), signEvent: vi.fn() };
    render(PollCard, { props: { event: makePoll() } });
    expect(screen.queryByRole('button', { name: /delete poll/i })).toBeNull();
  });

  it('does NOT show delete affordance when logged out', async () => {
    managerState.active = null;
    render(PollCard, { props: { event: makePoll() } });
    expect(screen.queryByRole('button', { name: /delete poll/i })).toBeNull();
  });

  it('calls deleteEvent helper when delete is confirmed', async () => {
    managerState.active = { pubkey: 'author'.padEnd(64, '0'), signEvent: vi.fn() };
    const originalConfirm = window.confirm;
    window.confirm = vi.fn(() => true);
    try {
      render(PollCard, { props: { event: makePoll() } });
      await fireEvent.click(screen.getByRole('button', { name: /delete poll/i }));
      await waitFor(() => expect(deleteEventSpy).toHaveBeenCalled());
      const [eventArg, accountArg] = deleteEventSpy.mock.calls[0];
      expect(eventArg.kind).toBe(1068);
      expect(accountArg).toBe(managerState.active);
    } finally {
      window.confirm = originalConfirm;
    }
  });

  it('does NOT call deleteEvent when delete is cancelled', async () => {
    managerState.active = { pubkey: 'author'.padEnd(64, '0'), signEvent: vi.fn() };
    const originalConfirm = window.confirm;
    window.confirm = vi.fn(() => false);
    try {
      render(PollCard, { props: { event: makePoll() } });
      await fireEvent.click(screen.getByRole('button', { name: /delete poll/i }));
      expect(deleteEventSpy).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  it('shows "You voted" badge when user has cast a vote', async () => {
    const me = 'me'.padEnd(64, '0');
    managerState.active = { pubkey: me };
    mockResponses.value = [
      {
        id: 'r1'.padEnd(64, '0'),
        kind: 1018,
        pubkey: me,
        created_at: 1700000100,
        tags: [
          ['e', 'poll-1'.padEnd(64, '0')],
          ['response', 'opt-a']
        ],
        content: ''
      }
    ];
    render(PollCard, { props: { event: makePoll() } });
    expect(screen.getByTestId('poll-you-voted')).toBeTruthy();
  });

  it('does NOT show "You voted" badge when user has not voted', () => {
    managerState.active = { pubkey: 'me'.padEnd(64, '0') };
    render(PollCard, { props: { event: makePoll() } });
    expect(screen.queryByTestId('poll-you-voted')).toBeNull();
  });

  it('does NOT show "You voted" badge when logged out', () => {
    managerState.active = null;
    render(PollCard, { props: { event: makePoll() } });
    expect(screen.queryByTestId('poll-you-voted')).toBeNull();
  });

  it('calls onclick when card body is clicked', async () => {
    const onclick = vi.fn();
    const { container } = render(PollCard, { props: { event: makePoll(), onclick } });
    const card = /** @type {HTMLElement} */ (container.querySelector('[role="button"]'));
    expect(card).toBeTruthy();
    await fireEvent.click(card);
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onclick when an option button is clicked (stopPropagation)', async () => {
    managerState.active = { pubkey: 'me'.padEnd(64, '0') };
    const onclick = vi.fn();
    render(PollCard, { props: { event: makePoll(), onclick } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apple' }));
    expect(onclick).not.toHaveBeenCalled();
  });

  it('does NOT call onclick when Cast vote button is clicked', async () => {
    managerState.active = {
      pubkey: 'me',
      signEvent: vi.fn().mockResolvedValue({
        id: 'voteid'.padEnd(64, '0'),
        kind: 1018,
        pubkey: 'me',
        sig: 's',
        created_at: 1,
        content: '',
        tags: [
          ['e', 'pollid'],
          ['response', 'opt-a']
        ]
      })
    };
    const onclick = vi.fn();
    const { container } = render(PollCard, { props: { event: makePoll(), onclick } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apple' }));
    // The clickable card also has role="button" and its accessible name
    // includes "Cast vote" from descendant text. Grab the actual <button> by tag.
    const castBtn = /** @type {HTMLButtonElement | null} */ (
      Array.from(container.querySelectorAll('button')).find((b) =>
        /cast vote/i.test(b.textContent ?? '')
      ) ?? null
    );
    expect(castBtn).toBeTruthy();
    await fireEvent.click(/** @type {HTMLButtonElement} */ (castBtn));
    expect(onclick).not.toHaveBeenCalled();
  });

  it('does NOT render as clickable when onclick is not provided', () => {
    const { container } = render(PollCard, { props: { event: makePoll() } });
    expect(container.querySelector('[role="button"]')).toBeNull();
  });

  it('renders the poll author header with profile + name', () => {
    const poll = makePoll();
    const { container } = render(PollCard, { props: { event: poll } });
    const authorHeader = container.querySelector('[data-testid="poll-author"]');
    expect(authorHeader).toBeTruthy();
    // Stub ProfileAvatar exposes pubkey via data-pubkey
    const avatar = authorHeader?.querySelector('[data-pubkey]');
    expect(avatar?.getAttribute('data-pubkey')).toBe(poll.pubkey);
    // Display name from the mocked useProfileMap returns "Voter <prefix>"
    expect(authorHeader?.textContent).toContain('Voter ' + poll.pubkey.slice(0, 4));
  });

  it('resets selection when event prop changes', async () => {
    managerState.active = { pubkey: 'me'.padEnd(64, '0') };
    const firstPoll = makePoll();
    const { container, rerender } = render(PollCard, { props: { event: firstPoll } });
    const buttons = /** @type {HTMLButtonElement[]} */ (
      Array.from(container.querySelectorAll('button[aria-pressed]'))
    );
    await fireEvent.click(buttons[0]);
    // Confirm selection took.
    const pressed = container.querySelectorAll('button[aria-pressed="true"]');
    expect(pressed.length).toBe(1);

    // Render with a different poll.
    const secondPoll = { ...makePoll(), id: 'poll-2'.padEnd(64, '0') };
    await rerender({ event: secondPoll });

    const stillPressed = container.querySelectorAll('button[aria-pressed="true"]');
    expect(stillPressed.length).toBe(0);
  });
});
