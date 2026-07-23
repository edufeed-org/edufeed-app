/** @vitest-environment jsdom */
/**
 * ChannelCreateWizard — 3-step create flow (Task 9). Covers the two
 * disablement gates (Next blocked until name; Create blocked until the
 * key-loss disclosure is acknowledged) plus the invite-loop failure
 * isolation: once createChannel succeeds, a failing grantChannelAccess must
 * neither block the other grants nor keep the wizard open — the channel
 * always surfaces via onCreated, with a partial-failure toast.
 * Founding/publish idempotency is exercised at the unit level in
 * concord-founding.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

const PUBKEY = 'a'.repeat(64);
const MEMBER_B = 'b'.repeat(64);
const MEMBER_E = 'e'.repeat(64);

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64), signer: {} },
  getAccountForPubkey: vi.fn(() => ({ signer: {} }))
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: true, relays: ['wss://concord.example'] } }
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toastSpy }));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/concord/founding.js', () => ({
  foundConcordArea: vi.fn()
}));

// Two invitable members (self is filtered out by the component).
vi.mock('$lib/helpers/contentTypes.js', () => ({
  getVerifiedMembers: () => ({
    allMembers: ['a'.repeat(64), 'b'.repeat(64), 'e'.repeat(64)],
    perSection: new Map()
  })
}));

import ChannelCreateWizard from '$lib/components/community/channels/ChannelCreateWizard.svelte';

/** Fill the name, walk to step 3, acknowledge the disclosure. */
async function walkToCreate(/** @type {string[]} */ invitees = []) {
  const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
  await fireEvent.input(nameInput, { target: { value: 'Staff room' } });

  let next = screen.getByRole('button', { name: /Next|Weiter/ });
  await fireEvent.click(next); // → step 1 (invite)

  for (const pubkey of invitees) {
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(pubkey.slice(0, 12)) }));
  }

  next = screen.getByRole('button', { name: /Next|Weiter/ });
  await fireEvent.click(next); // → step 2 (good to know)

  await fireEvent.click(screen.getByRole('checkbox'));
  return /** @type {HTMLButtonElement} */ (
    screen.getByRole('button', { name: /Create channel|Kanal erstellen/ })
  );
}

describe('ChannelCreateWizard', () => {
  const baseProps = {
    communikeyEvent: { kind: 10222, pubkey: PUBKEY, tags: [], content: '' },
    onClose: () => {},
    onCreated: () => {}
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables Next until a name is entered', async () => {
    render(ChannelCreateWizard, { props: baseProps });
    const next = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: /Next|Weiter/ })
    );
    expect(next.disabled).toBe(true);

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });
    expect(next.disabled).toBe(false);
  });

  it('disables Create until the key-loss disclosure is acknowledged', async () => {
    render(ChannelCreateWizard, { props: baseProps });

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

  it('surfaces the channel via onCreated with a partial toast when some grants fail', async () => {
    const createChannel = vi.fn(async () => 'chan-1');
    const grantChannelAccess = vi
      .fn()
      .mockRejectedValueOnce(new Error('gift wrap failed'))
      .mockResolvedValue(undefined);
    const onCreated = vi.fn();

    render(ChannelCreateWizard, {
      props: {
        ...baseProps,
        community: { createChannel, grantChannelAccess },
        onCreated
      }
    });

    const create = await walkToCreate([MEMBER_B, MEMBER_E]);
    await fireEvent.click(create);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('chan-1'));
    expect(createChannel).toHaveBeenCalledTimes(1);
    // first grant failed, loop still attempted the second
    expect(grantChannelAccess).toHaveBeenCalledTimes(2);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    const [message, type] = toastSpy.mock.calls[0];
    expect(type).toBe('warning');
    expect(message).toMatch(/1.*2|2.*1/); // "{failed} of {total}"
  });

  it('surfaces the channel with a success toast when all grants succeed', async () => {
    const createChannel = vi.fn(async () => 'chan-2');
    const grantChannelAccess = vi.fn().mockResolvedValue(undefined);
    const onCreated = vi.fn();

    render(ChannelCreateWizard, {
      props: {
        ...baseProps,
        community: { createChannel, grantChannelAccess },
        onCreated
      }
    });

    const create = await walkToCreate([MEMBER_B]);
    await fireEvent.click(create);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('chan-2'));
    expect(toastSpy.mock.calls[0][1]).toBe('success');
  });
});
