// @ts-nocheck
/**
 * PinnedMessagesBar — above a NIP-29 channel's timeline: the newest pinned
 * message on one line, expandable to the full list; jump scrolls to the
 * message, unpin is offered to moderators only.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import PinnedMessagesBar from '$lib/components/groups/PinnedMessagesBar.svelte';

const pins = [
  {
    id: 'n'.repeat(64),
    displayName: 'Nina',
    content: 'Neueste Regel: https://x.y/z bitte lesen',
    timestamp: '10:00',
    missing: false
  },
  {
    id: 'o'.repeat(64),
    displayName: 'Omar',
    content: 'Ältere Ansage',
    timestamp: 'Mo',
    missing: false
  }
];

describe('PinnedMessagesBar', () => {
  it('is hidden without pins', () => {
    render(PinnedMessagesBar, { props: { pins: [], onJump: vi.fn() } });
    expect(screen.queryByTestId('pinned-bar')).toBeNull();
  });

  it('collapsed: shows the count and the newest pin without its URLs, and jumps on click', async () => {
    const onJump = vi.fn();
    render(PinnedMessagesBar, { props: { pins, onJump } });
    const bar = screen.getByTestId('pinned-bar');
    expect(bar.textContent).toContain(m.groups_pinned_count({ count: 2 }));
    expect(bar.textContent).toContain('Nina');
    expect(bar.textContent).toContain('Neueste Regel: bitte lesen');
    expect(bar.textContent).not.toContain('https://');
    expect(screen.queryAllByTestId('pinned-bar-row')).toHaveLength(0);
    await fireEvent.click(screen.getByTestId('pinned-bar-newest'));
    expect(onJump).toHaveBeenCalledWith(pins[0].id);
  });

  it('expands to every pin, newest first, each jumping to its message', async () => {
    const onJump = vi.fn();
    render(PinnedMessagesBar, { props: { pins, onJump } });
    await fireEvent.click(screen.getByTestId('pinned-bar-toggle'));
    const rows = screen.getAllByTestId('pinned-bar-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Nina');
    expect(rows[1].textContent).toContain('Omar');
    await fireEvent.click(within(rows[1]).getByTestId('pinned-bar-jump'));
    expect(onJump).toHaveBeenCalledWith(pins[1].id);
    // and back
    await fireEvent.click(screen.getByTestId('pinned-bar-toggle'));
    expect(screen.queryAllByTestId('pinned-bar-row')).toHaveLength(0);
  });

  it('offers unpin only when onUnpin is given', async () => {
    const onUnpin = vi.fn();
    const { unmount } = render(PinnedMessagesBar, { props: { pins, onJump: vi.fn(), onUnpin } });
    await fireEvent.click(screen.getByTestId('pinned-bar-toggle'));
    const rows = screen.getAllByTestId('pinned-bar-row');
    await fireEvent.click(within(rows[0]).getByTestId('pinned-bar-unpin'));
    expect(onUnpin).toHaveBeenCalledWith(pins[0].id);
    unmount();

    render(PinnedMessagesBar, { props: { pins, onJump: vi.fn() } });
    await fireEvent.click(screen.getByTestId('pinned-bar-toggle'));
    expect(screen.queryAllByTestId('pinned-bar-unpin')).toHaveLength(0);
  });

  it('a pin whose message is not loaded says so and offers no jump', async () => {
    const onJump = vi.fn();
    const missing = [
      { id: 'm'.repeat(64), displayName: '', content: '', timestamp: '', missing: true }
    ];
    render(PinnedMessagesBar, { props: { pins: missing, onJump } });
    const bar = screen.getByTestId('pinned-bar');
    expect(bar.textContent).toContain(m.groups_pinned_missing());
    await fireEvent.click(screen.getByTestId('pinned-bar-newest'));
    expect(onJump).not.toHaveBeenCalled();
  });
});
