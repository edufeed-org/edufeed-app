/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const statusHolder = vi.hoisted(() => ({
  /** @type {() => any} */
  get: () => ({ level: 'ok', reasons: [] })
}));
const startConnectionStatus = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/connection-status.svelte.js', () => ({
  getConnectionStatus: () => statusHolder.get(),
  startConnectionStatus: () => startConnectionStatus()
}));

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
      servers: [{ host: 'dev.relay.edufeed.org', categories: ['communikey', 'longform'] }]
    }
  ]
};

beforeEach(() => {
  statusHolder.get = () => ({ level: 'ok', reasons: [] });
  startConnectionStatus.mockClear();
});

describe('ConnectionStatus', () => {
  // laoc 2026-10-05: an always-on dot was too present.
  it.each(/** @type {const} */ (['badge', 'details', 'dot', 'strip']))(
    '%s: starts the service and renders nothing while all is well',
    (variant) => {
      const { container } = render(ConnectionStatus, { props: { variant } });
      expect(startConnectionStatus).toHaveBeenCalled();
      expect(container.textContent?.trim()).toBe('');
    }
  );

  it('badge: an amber dot on a problem, red when unreachable or offline', () => {
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

  it('details: names the unreachable server and what it serves', () => {
    statusHolder.get = () => ONE_DOWN;
    render(ConnectionStatus, { props: { variant: 'details' } });
    const server = screen.getByTestId('connection-status-server');
    expect(server.textContent).toContain('dev.relay.edufeed.org');
    expect(server.textContent).toMatch(/communities|Communities/);
    expect(server.textContent).toMatch(/articles|Artikel/);
  });

  it('details: lists every reason (offline + signer)', () => {
    statusHolder.get = () => ({
      level: 'offline',
      reasons: [{ kind: 'offline' }, { kind: 'signer' }]
    });
    render(ConnectionStatus, { props: { variant: 'details' } });
    expect(screen.getAllByTestId('connection-status-item')).toHaveLength(2);
  });

  it('dot: a popover with the same explanation (logged out)', () => {
    statusHolder.get = () => ONE_DOWN;
    render(ConnectionStatus, { props: { variant: 'dot' } });
    expect(screen.getByTestId('connection-status').dataset.level).toBe('degraded');
    expect(screen.getByTestId('connection-status-server').textContent).toContain(
      'dev.relay.edufeed.org'
    );
  });

  it('strip: says the first problem in words, with the server', () => {
    statusHolder.get = () => ({
      level: 'unreachable',
      reasons: [
        {
          kind: 'relays',
          down: 2,
          total: 2,
          servers: [
            { host: 'a.example', categories: [] },
            { host: 'b.example', categories: [] }
          ]
        }
      ]
    });
    render(ConnectionStatus, { props: { variant: 'strip' } });
    const strip = screen.getByTestId('connection-status-strip');
    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.textContent).toMatch(/not reachable|nicht erreichbar/);
    expect(strip.textContent).toContain('a.example, b.example');
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
