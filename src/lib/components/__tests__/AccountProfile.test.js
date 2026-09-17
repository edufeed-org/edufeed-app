// @ts-nocheck
/**
 * AccountProfile — the saved-account row in the login modal.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';

const mockManager = vi.hoisted(() => ({
  active: null,
  active$: null,
  setActive: vi.fn()
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => undefined
}));
vi.mock('$lib/paraglide/messages', () => ({
  auth_bunker_account_type: () => 'bunker',
  auth_readonly_account_type: () => 'read-only',
  auth_google_account_badge: () => 'google',
  account_profile_active_status: () => '(active)',
  account_profile_active_button: () => 'Active',
  account_profile_set_active_button: () => 'Use'
}));

import AccountProfile from '../AccountProfile.svelte';

const other = { id: 'a1', pubkey: 'a'.repeat(64), type: 'nsec' };

describe('AccountProfile', () => {
  beforeEach(() => {
    mockManager.setActive.mockReset();
    mockManager.active = null;
    mockManager.active$ = new BehaviorSubject(null);
  });

  it('activates the account and then reports the switch via onSwitch', async () => {
    const onSwitch = vi.fn();
    const { getByText } = render(AccountProfile, { props: { account: other, onSwitch } });
    await fireEvent.click(getByText('Use'));
    expect(mockManager.setActive).toHaveBeenCalledWith(other);
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive.mock.invocationCallOrder[0]).toBeLessThan(
      onSwitch.mock.invocationCallOrder[0]
    );
  });

  it('works without an onSwitch callback', async () => {
    const { getByText } = render(AccountProfile, { props: { account: other } });
    await fireEvent.click(getByText('Use'));
    expect(mockManager.setActive).toHaveBeenCalledWith(other);
  });
});
