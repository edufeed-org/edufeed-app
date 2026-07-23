/** @vitest-environment jsdom */
/**
 * ChannelCreateWizard — 3-step create flow (Task 9). Covers the two
 * disablement gates: Next is blocked until a name is entered (step 1),
 * Create is blocked until the key-loss disclosure checkbox is ticked
 * (step 3). Founding/publish flow is exercised at the unit level in
 * concord-founding.test.js; this test never reaches `create()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

const PUBKEY = 'a'.repeat(64);

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64), signer: {} },
  getAccountForPubkey: vi.fn(() => ({ signer: {} }))
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: true, relays: ['wss://concord.example'] } }
}));

vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/concord/founding.js', () => ({
  foundConcordArea: vi.fn()
}));

import ChannelCreateWizard from '$lib/components/community/channels/ChannelCreateWizard.svelte';

describe('ChannelCreateWizard', () => {
  const props = {
    communikeyEvent: { kind: 10222, pubkey: PUBKEY, tags: [], content: '' },
    onClose: () => {},
    onCreated: () => {}
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables Next until a name is entered', async () => {
    render(ChannelCreateWizard, { props });
    const next = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: /Next|Weiter/ })
    );
    expect(next.disabled).toBe(true);

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });
    expect(next.disabled).toBe(false);
  });

  it('disables Create until the key-loss disclosure is acknowledged', async () => {
    render(ChannelCreateWizard, { props });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });

    let next = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: /Next|Weiter/ })
    );
    await fireEvent.click(next); // step 1 (invite)

    next = /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: /Next|Weiter/ }));
    await fireEvent.click(next); // step 2 (good to know)

    const create = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: /Create channel|Kanal erstellen/ })
    );
    expect(create.disabled).toBe(true);

    const checkbox = screen.getByRole('checkbox');
    await fireEvent.click(checkbox);
    expect(create.disabled).toBe(false);
  });
});
