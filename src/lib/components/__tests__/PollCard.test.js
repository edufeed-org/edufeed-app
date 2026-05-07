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

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ create: factoryCreate })
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => publishEventSpy(...args)
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
    // Title is built from voter profile name (mocked).
    const titles = Array.from(avatars).map((a) => a.getAttribute('title'));
    expect(titles.some((t) => t && t.startsWith('Voter '))).toBe(true);
    // a11y: aria-label exposes voter name to screen readers.
    const ariaLabels = Array.from(avatars).map((a) => a.getAttribute('aria-label'));
    expect(ariaLabels.every((l) => l && l.startsWith('Voter '))).toBe(true);
    // a11y: wrapper announces as image even when no <img> is rendered.
    expect(avatars[0].getAttribute('role')).toBe('img');
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
