// @ts-nocheck
/**
 * ScreenShareTile — one screen share on the stage: the video, who shares,
 * pin / full screen / stop. Full screen goes through groups/fullscreen.js,
 * the same path camera tiles use.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const fs = vi.hoisted(() => ({ toggleFullscreen: vi.fn(async () => {}) }));
vi.mock('$lib/groups/fullscreen.js', () => ({
  toggleFullscreen: fs.toggleFullscreen,
  isFullscreenOf: () => false
}));
function Stub() {}
vi.mock('$lib/components/icons', () => ({ PinIcon: Stub, ExpandIcon: Stub, CollapseIcon: Stub }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_pin: () => 'Pin',
  groups_call_unpin: () => 'Unpin',
  groups_call_fullscreen: () => 'Full screen',
  groups_call_exit_fullscreen: () => 'Exit full screen',
  groups_call_screen_share_stop: () => 'Stop sharing'
}));

const { default: ScreenShareTile } = await import(
  '$lib/components/groups/call/ScreenShareTile.svelte'
);
const track = () => ({ attach: vi.fn(), detach: vi.fn() });

beforeEach(() => vi.clearAllMocks());

describe('ScreenShareTile', () => {
  it('attaches the track to its video and detaches on unmount', () => {
    const t = track();
    const { container, unmount } = render(ScreenShareTile, {
      props: { track: t, label: 'Bea shares' }
    });
    expect(t.attach).toHaveBeenCalledWith(container.querySelector('video'));
    unmount();
    expect(t.detach).toHaveBeenCalled();
  });

  it('full screen asks for the tile element', async () => {
    render(ScreenShareTile, { props: { track: track(), label: 'Bea shares' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(fs.toggleFullscreen).toHaveBeenCalledWith(screen.getByTestId('call-screen-share'));
  });

  it('pin and stop are offered as given; compact keeps only the pin (a strip share can come back big)', async () => {
    const onTogglePin = vi.fn();
    const onStop = vi.fn();
    render(ScreenShareTile, {
      props: { track: track(), label: 'You share', isLocal: true, onTogglePin, onStop }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(onTogglePin).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(onStop).toHaveBeenCalled();
    render(ScreenShareTile, {
      props: { track: track(), label: 'x', compact: true, onTogglePin, onStop, isLocal: true }
    });
    expect(screen.getAllByRole('button', { name: 'Pin' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Full screen' }).length).toBe(1);
    expect(screen.getAllByRole('button', { name: 'Stop sharing' }).length).toBe(1);
  });
});
