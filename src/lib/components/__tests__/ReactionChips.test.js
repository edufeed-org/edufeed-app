/**
 * ReactionChips — shared presentational reaction row (chips + hover-gated add
 * button) extracted from ReactionBar.svelte so it can be reused verbatim by
 * UrlReactionBar.svelte and concord's ChannelChat.svelte (full reaction
 * parity between public and private-channel chat).
 *
 * Also the regression suite for the hover-flicker fix: `addButtonOnHover`
 * used to swap `hidden` (display:none) for `inline-flex` on :hover, which
 * collapsed/expanded the footer's box and shifted every row below it in a
 * scrollable chat list. The fix reveals via opacity instead — this file
 * pins the opacity-based classes so a regression back to a display swap
 * fails the suite.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ReactionChips from '../reactions/ReactionChips.svelte';

vi.mock('../reactions/ReactionButton.svelte', () => import('./fixtures/ReactionButtonStub.svelte'));
vi.mock(
  '../reactions/AddReactionButton.svelte',
  () => import('./fixtures/AddReactionButtonStub.svelte')
);

describe('ReactionChips', () => {
  it('renders one stub ReactionButton per aggregated emoji with the summary spread as props', () => {
    const aggregated = new Map([
      [
        '👍',
        {
          count: 2,
          userReacted: true,
          userReactionEvent: { id: 'r1' },
          emojiUrl: null,
          reactors: ['a', 'b']
        }
      ],
      [
        '🎉',
        {
          count: 1,
          userReacted: false,
          userReactionEvent: null,
          emojiUrl: 'https://x/e.png',
          reactors: ['c']
        }
      ]
    ]);

    const { container } = render(ReactionChips, {
      props: { aggregated, onToggle: () => {}, onPick: () => {} }
    });

    const buttons = container.querySelectorAll('[data-testid="reaction-button-stub"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('data-emoji')).toBe('👍');
    expect(buttons[0].getAttribute('data-count')).toBe('2');
    expect(buttons[0].getAttribute('data-user-reacted')).toBe('true');
    expect(buttons[1].getAttribute('data-emoji')).toBe('🎉');
    expect(buttons[1].getAttribute('data-emoji-url')).toBe('https://x/e.png');
  });

  it('calls onToggle(emoji, summary) when a chip is clicked', async () => {
    const summary = {
      count: 1,
      userReacted: false,
      userReactionEvent: null,
      emojiUrl: null,
      reactors: ['a']
    };
    const aggregated = new Map([['❤️', summary]]);
    /** @type {any[]} */
    const calls = [];

    const { container } = render(ReactionChips, {
      props: {
        aggregated,
        onToggle: (/** @type {string} */ emoji, /** @type {any} */ s) => calls.push([emoji, s]),
        onPick: () => {}
      }
    });

    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="reaction-button-stub"]'))
    );
    expect(calls).toEqual([['❤️', summary]]);
  });

  it('renders a bare (always-visible) add button when addButtonOnHover is false (default)', () => {
    const { container } = render(ReactionChips, {
      props: { aggregated: new Map(), onToggle: () => {}, onPick: () => {} }
    });

    expect(container.querySelector('[data-testid="add-reaction-wrapper"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-reaction-btn-stub"]')).toBeTruthy();
  });

  it('wraps the add button in an opacity-revealed (not display:none) wrapper when addButtonOnHover=true', () => {
    const { container } = render(ReactionChips, {
      props: { aggregated: new Map(), addButtonOnHover: true, onToggle: () => {}, onPick: () => {} }
    });

    const wrapper = container.querySelector('[data-testid="add-reaction-wrapper"]');
    expect(wrapper).toBeTruthy();
    // Space is ALWAYS reserved — no display:none/hidden utility class.
    expect(wrapper?.className).not.toContain('hidden');
    expect(wrapper?.className).toContain('opacity-0');
    expect(wrapper?.className).toContain('group-hover:opacity-70');
    expect(wrapper?.className).toContain('group-focus-within:opacity-70');
  });

  it('forces full opacity on the wrapper once the picker opens, and reverts once it closes', async () => {
    const { container } = render(ReactionChips, {
      props: { aggregated: new Map(), addButtonOnHover: true, onToggle: () => {}, onPick: () => {} }
    });

    const wrapper = container.querySelector('[data-testid="add-reaction-wrapper"]');
    // Check for the standalone `!opacity-100` CLASS TOKEN (not a substring
    // match) — the wrapper's base classes always contain `hover:!opacity-100`,
    // which would falsely satisfy a plain .toContain() check even pre-open.
    const hasForcedOpacityClass = () =>
      (wrapper?.className ?? '').split(/\s+/).includes('!opacity-100');
    expect(hasForcedOpacityClass()).toBe(false);

    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="open-picker-stub"]'))
    );
    expect(hasForcedOpacityClass()).toBe(true);

    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="close-picker-stub"]'))
    );
    expect(hasForcedOpacityClass()).toBe(false);
  });

  it('calls onPick when the add button is used', async () => {
    /** @type {any[]} */
    const picks = [];
    const { container } = render(ReactionChips, {
      props: {
        aggregated: new Map(),
        onToggle: () => {},
        onPick: (/** @type {any} */ e) => picks.push(e)
      }
    });

    await fireEvent.click(
      /** @type {HTMLElement} */ (container.querySelector('[data-testid="add-reaction-btn-stub"]'))
    );
    expect(picks).toEqual(['😀']);
  });
});
