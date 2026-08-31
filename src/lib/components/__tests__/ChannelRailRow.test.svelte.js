/**
 * ChannelRailRow — the shared row of every channel rail. The presentation
 * contract under test (Armada-style, laoc 2026-08-17): every row leads with
 * '#', and access rides as trailing badges — globe for world-readable, lock
 * for invite-only. The lock must never replace the channel glyph.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ChannelRailRow from '$lib/components/community/channels/ChannelRailRow.svelte';

vi.mock('$lib/paraglide/messages', () => ({
  concord_legend_public: () => 'public',
  concord_legend_private: () => 'private',
  channel_lock_tooltip: () => 'private channel tooltip',
  groups_channel_world_readable: () => 'world-readable'
}));

describe('ChannelRailRow', () => {
  it('draws a locked row with the # glyph AND a trailing lock badge', () => {
    render(ChannelRailRow, { props: { symbol: '#', name: 'leitung', locked: true } });
    const badge = screen.getByTestId('locked-badge');
    expect(badge.querySelector('svg')).toBeTruthy(); // LockIcon, not an emoji
    expect(screen.getByText('#')).toBeTruthy();
  });

  it('shows no lock badge on an open row', () => {
    render(ChannelRailRow, { props: { symbol: '#', name: 'allgemein' } });
    expect(screen.queryByTestId('locked-badge')).toBeNull();
  });

  it('keeps the globe badge for world-readable rows, without a lock', () => {
    render(ChannelRailRow, { props: { symbol: '#', name: 'offen', worldReadable: true } });
    expect(screen.getByTestId('world-readable-badge')).toBeTruthy();
    expect(screen.queryByTestId('locked-badge')).toBeNull();
  });
});
