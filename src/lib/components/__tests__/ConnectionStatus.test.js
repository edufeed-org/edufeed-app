/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const statusHolder = vi.hoisted(() => ({
  /** @type {() => any} */
  get: () => ({ level: 'ok', reasons: [] })
}));
const startConnectionStatus = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/connection-status.svelte.js', () => ({
  getConnectionStatus: () => statusHolder.get(),
  startConnectionStatus: () => startConnectionStatus()
}));
const openModal = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal } }));

const { default: ConnectionStatus } = await import(
  '$lib/components/shared/ConnectionStatus.svelte'
);

const ONE_DOWN = {
  level: 'degraded',
  reasons: [
    {
      kind: 'relays',
      down: 1,
      total: 6,
      servers: [{ host: 'dev.relay.edufeed.org', categories: ['communikey'] }]
    }
  ]
};

beforeEach(() => {
  statusHolder.get = () => ({ level: 'ok', reasons: [] });
  startConnectionStatus.mockClear();
  openModal.mockClear();
});

describe('ConnectionStatus', () => {
  // laoc 2026-10-05: an always-on dot was too present.
  it.each(/** @type {const} */ (['badge', 'dot', 'strip']))(
    '%s: starts the service and renders nothing while all is well',
    (variant) => {
      const { container } = render(ConnectionStatus, { props: { variant } });
      expect(startConnectionStatus).toHaveBeenCalled();
      expect(container.textContent?.trim()).toBe('');
    }
  );

  it('badge: amber on a partial problem, red when offline', () => {
    statusHolder.get = () => ONE_DOWN;
    const { unmount } = render(ConnectionStatus, { props: { variant: 'badge' } });
    expect(screen.getByTestId('connection-status-badge').classList.contains('bg-warning')).toBe(
      true
    );
    unmount();
    statusHolder.get = () => ({ level: 'offline', reasons: [{ kind: 'offline' }] });
    render(ConnectionStatus, { props: { variant: 'badge' } });
    expect(screen.getByTestId('connection-status-badge').classList.contains('bg-error')).toBe(true);
  });

  it('menu-item: always there, a dot only on a problem, opens the modal and closes the menu', async () => {
    const onClose = vi.fn();
    const { unmount } = render(ConnectionStatus, { props: { variant: 'menu-item', onClose } });
    expect(screen.getByTestId('connection-status-menu-item').textContent).toMatch(
      /Connection|Verbindung/
    );
    expect(screen.queryByTestId('connection-status-menu-dot')).toBeNull();
    await fireEvent.click(screen.getByTestId('connection-status-menu-item'));
    expect(onClose).toHaveBeenCalled();
    expect(openModal).toHaveBeenCalledWith('connectionStatus');
    unmount();
    statusHolder.get = () => ONE_DOWN;
    render(ConnectionStatus, { props: { variant: 'menu-item' } });
    expect(screen.getByTestId('connection-status-menu-dot').dataset.level).toBe('degraded');
  });

  it('dot and strip open the modal', async () => {
    statusHolder.get = () => ONE_DOWN;
    const { unmount } = render(ConnectionStatus, { props: { variant: 'dot' } });
    await fireEvent.click(screen.getByTestId('connection-status'));
    unmount();
    render(ConnectionStatus, { props: { variant: 'strip' } });
    const strip = screen.getByTestId('connection-status-strip');
    expect(strip.textContent).toContain('dev.relay.edufeed.org');
    await fireEvent.click(strip);
    expect(openModal).toHaveBeenCalledTimes(2);
  });

  it('never throws: a failing status read renders nothing (navbar sits outside the error boundary)', () => {
    statusHolder.get = () => {
      throw new Error('boom');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(ConnectionStatus, { props: { variant: 'badge' } });
    expect(container.textContent?.trim()).toBe('');
    warn.mockRestore();
  });
});
