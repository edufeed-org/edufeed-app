// @ts-nocheck
/**
 * Nip05ReadyRow — the pinned "your address is ready" row shared by the bell
 * dropdown, the inbox page and the dashboard inbox card. Visibility comes from
 * the nip05-ready-alert store; the row only wires activate / dismiss.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

const store = vi.hoisted(() => ({
  alert: /** @type {any} */ (null),
  activating: false
}));
const activateMock = vi.hoisted(() => vi.fn(async () => 'activated'));
const dismissMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

function StubComponent() {}

vi.mock('$lib/stores/nip05-ready-alert.svelte.js', () => ({
  getNip05ReadyAlert: () => store.alert,
  isActivatingHandle: () => store.activating,
  activateGrantedHandle: (...args) => activateMock(...args),
  dismissNip05ReadyAlert: (...args) => dismissMock(...args)
}));
vi.mock('$lib/components/icons', () => ({ CloseIcon: StubComponent }));
vi.mock('$lib/helpers/toast', () => ({ showToast: (...args) => toastMock(...args) }));
vi.mock('$lib/paraglide/messages.js', () => ({
  inbox_nip05_ready_row_title: ({ address }) => `Your address ${address} is ready`,
  inbox_nip05_ready_row_body: () => 'Activate it',
  inbox_nip05_ready_row_action: () => 'Activate',
  inbox_nip05_ready_row_doing: () => 'Activating…',
  inbox_nip05_ready_row_dismiss_aria: () => 'Dismiss hint',
  error_generic: () => 'Something went wrong'
}));

import Nip05ReadyRow from '../inbox/Nip05ReadyRow.svelte';

beforeEach(() => {
  store.alert = { address: 'maria@edufeed.org', hasOther: false, hasProfile: true };
  store.activating = false;
  activateMock.mockClear();
  activateMock.mockImplementation(async () => 'activated');
  dismissMock.mockClear();
  toastMock.mockClear();
});

describe('Nip05ReadyRow', () => {
  it('renders nothing while there is no alert', () => {
    store.alert = null;
    render(Nip05ReadyRow);
    expect(screen.queryByTestId('inbox-nip05-ready-row')).toBeNull();
  });

  it('names the granted address and offers activation', () => {
    render(Nip05ReadyRow, { props: { class_: 'border-b' } });
    const row = screen.getByTestId('inbox-nip05-ready-row');
    expect(row.textContent).toContain('Your address maria@edufeed.org is ready');
    expect(row.className).toContain('border-b');
    expect(screen.getByTestId('inbox-nip05-ready-activate').textContent).toContain('Activate');
  });

  it('activate runs the shared one-click activation', async () => {
    render(Nip05ReadyRow);
    await fireEvent.click(screen.getByTestId('inbox-nip05-ready-activate'));
    expect(activateMock).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('surfaces a failed activation as an error toast', async () => {
    activateMock.mockImplementation(async () => 'failed');
    render(Nip05ReadyRow);
    await fireEvent.click(screen.getByTestId('inbox-nip05-ready-activate'));
    expect(toastMock).toHaveBeenCalledWith('Something went wrong', 'error');
  });

  it('shows the in-flight state and blocks a second click', () => {
    store.activating = true;
    render(Nip05ReadyRow);
    const button = screen.getByTestId('inbox-nip05-ready-activate');
    expect(button.textContent).toContain('Activating…');
    expect(button.disabled).toBe(true);
  });

  it('the x dismisses the alert everywhere', async () => {
    render(Nip05ReadyRow);
    await fireEvent.click(screen.getByTestId('inbox-nip05-ready-dismiss'));
    expect(dismissMock).toHaveBeenCalledTimes(1);
  });
});
