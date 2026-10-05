/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const holder = vi.hoisted(() => ({
  /** @type {any} */ status: { level: 'ok', reasons: [] },
  /** @type {any} */ details: { online: true, waitingForSigner: false, servers: [] }
}));
vi.mock('$lib/services/connection-status.svelte.js', () => ({
  getConnectionStatus: () => holder.status,
  getConnectionDetails: () => holder.details,
  startConnectionStatus: () => {}
}));

const { default: ConnectionStatusModal } = await import(
  '$lib/components/shared/ConnectionStatusModal.svelte'
);

beforeEach(() => {
  holder.status = { level: 'ok', reasons: [] };
  holder.details = { online: true, waitingForSigner: false, servers: [] };
});

describe('ConnectionStatusModal', () => {
  it('says all is well and lists every app server with its state', () => {
    holder.details = {
      online: true,
      waitingForSigner: false,
      servers: [
        { host: 'groups.edufeed.org', categories: ['groups'], state: 'connected' },
        { host: 'cal.edufeed.org', categories: ['calendar'], state: 'idle' }
      ]
    };
    render(ConnectionStatusModal, { props: { onClose: () => {} } });
    expect(screen.getByTestId('connection-status-summary').textContent).toMatch(
      /Connected|Verbunden/
    );
    const rows = screen.getAllByTestId('connection-status-server-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('groups.edufeed.org');
    expect(rows[0].textContent).toMatch(/connected|verbunden/);
    expect(rows[1].textContent).toMatch(/not in use|nicht in Gebrauch/);
    expect(screen.queryByTestId('connection-status-signer')).toBeNull();
  });

  it('explains an unreachable server and a waiting signer', () => {
    holder.status = {
      level: 'degraded',
      reasons: [
        {
          kind: 'relays',
          down: 1,
          total: 2,
          servers: [{ host: 'dev.relay.edufeed.org', categories: ['communikey'] }]
        },
        { kind: 'signer' }
      ]
    };
    holder.details = {
      online: true,
      waitingForSigner: true,
      servers: [{ host: 'dev.relay.edufeed.org', categories: ['communikey'], state: 'failing' }]
    };
    render(ConnectionStatusModal, { props: { onClose: () => {} } });
    expect(screen.getByTestId('connection-status-summary').textContent).toMatch(/1.*2/);
    expect(screen.getByTestId('connection-status-server-row').textContent).toMatch(
      /not reachable|nicht erreichbar/
    );
    expect(screen.getByTestId('connection-status-signer')).toBeTruthy();
  });

  it('closes via the button and Escape', async () => {
    const onClose = vi.fn();
    render(ConnectionStatusModal, { props: { onClose } });
    await fireEvent.click(screen.getByTestId('connection-status-close'));
    await fireEvent.keyDown(screen.getByTestId('connection-status-modal'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
