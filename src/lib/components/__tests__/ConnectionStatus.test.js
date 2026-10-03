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

beforeEach(() => {
  statusHolder.get = () => ({ level: 'ok', reasons: [] });
  startConnectionStatus.mockClear();
});

describe('ConnectionStatus', () => {
  it('starts the status service and shows a green dot when all is well', () => {
    render(ConnectionStatus);
    expect(startConnectionStatus).toHaveBeenCalled();
    expect(screen.getByTestId('connection-status').dataset.level).toBe('ok');
    expect(screen.getByTestId('connection-status-dot').classList.contains('bg-success')).toBe(true);
    expect(screen.getByTestId('connection-status-details').textContent).toMatch(
      /Connected|Verbunden/
    );
  });

  it('turns amber and explains partly unreachable servers', () => {
    statusHolder.get = () => ({
      level: 'degraded',
      reasons: [{ kind: 'relays', down: 1, total: 3, hosts: ['a'] }]
    });
    render(ConnectionStatus);
    expect(screen.getByTestId('connection-status-dot').classList.contains('bg-warning')).toBe(true);
    expect(screen.getByTestId('connection-status-details').textContent).toMatch(/1.*3/);
  });

  it('turns red when offline and lists every reason (offline + signer)', () => {
    statusHolder.get = () => ({
      level: 'offline',
      reasons: [{ kind: 'offline' }, { kind: 'signer' }]
    });
    render(ConnectionStatus);
    expect(screen.getByTestId('connection-status-dot').classList.contains('bg-error')).toBe(true);
    expect(screen.getByTestId('connection-status-details').querySelectorAll('li')).toHaveLength(2);
  });

  it('strip: renders nothing while all is well', () => {
    render(ConnectionStatus, { props: { variant: 'strip' } });
    expect(screen.queryByTestId('connection-status-strip')).toBeNull();
  });

  it('strip: says the first problem in words', () => {
    statusHolder.get = () => ({
      level: 'unreachable',
      reasons: [{ kind: 'relays', down: 2, total: 2, hosts: ['a', 'b'] }]
    });
    render(ConnectionStatus, { props: { variant: 'strip' } });
    const strip = screen.getByTestId('connection-status-strip');
    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.textContent).toMatch(/not reachable|nicht erreichbar/);
  });

  it('never throws: a failing status read falls back to ok (navbar sits outside the error boundary)', () => {
    statusHolder.get = () => {
      throw new Error('boom');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(ConnectionStatus);
    expect(screen.getByTestId('connection-status').dataset.level).toBe('ok');
    warn.mockRestore();
  });
});
