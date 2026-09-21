// @ts-nocheck
/**
 * Nip05ActivatedModal — the confirmation after the granted handle landed on
 * the profile: names the address, explains what it is good for, and offers
 * the concrete next step (view the profile as others see it).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

const gotoMock = vi.hoisted(() => vi.fn());
const closeModalMock = vi.hoisted(() => vi.fn());
const USER_PUBKEY = 'a'.repeat(64);

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/paths', () => ({ resolve: (path) => path }));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { closeModal: () => closeModalMock() }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: USER_PUBKEY })
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (pubkey) => `/p/${pubkey}`
}));
vi.mock('$lib/paraglide/messages', () => ({
  nip05_activated_title: () => 'Your address is active',
  nip05_activated_lead: ({ address }) => `${address} is now part of your profile.`,
  nip05_activated_point_verified: () => 'verified checkmark',
  nip05_activated_point_findable: () => 'findable',
  nip05_activated_point_trust: ({ domain }) => `belongs to ${domain}`,
  nip05_activated_next_step: () => 'Next step',
  nip05_activated_cta_profile: () => 'View profile',
  common_close: () => 'Close'
}));

import Nip05ActivatedModal from '../membership/Nip05ActivatedModal.svelte';

beforeEach(() => {
  gotoMock.mockClear();
  closeModalMock.mockClear();
});

describe('Nip05ActivatedModal', () => {
  it('names the activated address and derives the domain for the trust line', () => {
    render(Nip05ActivatedModal, { props: { address: 'maria@edufeed.org' } });
    expect(screen.getByTestId('nip05-activated-lead').textContent).toContain(
      'maria@edufeed.org is now part of your profile.'
    );
    expect(screen.getByText('belongs to edufeed.org')).toBeTruthy();
    expect(screen.getByText('verified checkmark')).toBeTruthy();
    expect(screen.getByText('findable')).toBeTruthy();
  });

  it('"View profile" closes the modal and opens the own profile', async () => {
    render(Nip05ActivatedModal, { props: { address: 'maria@edufeed.org' } });
    await fireEvent.click(screen.getByTestId('nip05-activated-view-profile'));
    expect(closeModalMock).toHaveBeenCalledTimes(1);
    expect(gotoMock).toHaveBeenCalledWith(`/p/${USER_PUBKEY}`);
  });

  it('the close button only closes', async () => {
    render(Nip05ActivatedModal, { props: { address: 'maria@edufeed.org' } });
    await fireEvent.click(screen.getByTestId('nip05-activated-close'));
    expect(closeModalMock).toHaveBeenCalledTimes(1);
    expect(gotoMock).not.toHaveBeenCalled();
  });
});
