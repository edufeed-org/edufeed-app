/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const showToast = vi.fn();
vi.mock('$lib/helpers/toast.js', () => ({ showToast: (...args) => showToast(...args) }));
vi.mock('$lib/paraglide/messages', () => ({
  readonly_sign_prompt: () => 'read-only prompt'
}));

describe('signing-guard', () => {
  beforeEach(() => showToast.mockClear());

  it('canSign is true for signing account types', async () => {
    const { canSign } = await import('../helpers/signing-guard.js');
    expect(canSign({ type: 'extension' })).toBe(true);
    expect(canSign({ type: 'nostr-connect' })).toBe(true);
    expect(canSign({ type: 'nsec' })).toBe(true);
  });

  it('canSign is false for readonly and missing accounts', async () => {
    const { canSign } = await import('../helpers/signing-guard.js');
    expect(canSign({ type: 'readonly' })).toBe(false);
    expect(canSign(null)).toBe(false);
    expect(canSign(undefined)).toBe(false);
  });

  it('requireSigningOrToast toasts only for readonly accounts', async () => {
    const { requireSigningOrToast } = await import('../helpers/signing-guard.js');
    expect(requireSigningOrToast({ type: 'readonly' })).toBe(false);
    expect(showToast).toHaveBeenCalledWith('read-only prompt', 'warning');
    showToast.mockClear();
    expect(requireSigningOrToast(null)).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    expect(requireSigningOrToast({ type: 'extension' })).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('wrapReadonlySigner via hardenExtensionAccounts', () => {
  it('readonly signer signEvent toasts and rejects', async () => {
    const { hardenExtensionAccounts } = await import('../stores/accounts.svelte.js');
    const throwingSigner = {
      getPublicKey: () => 'ab'.repeat(32),
      signEvent: () => {
        throw new Error('Cant sign events with readonly signer');
      }
    };
    const account = { type: 'readonly', signer: throwingSigner };
    hardenExtensionAccounts([account]);
    expect(account.signer).not.toBe(throwingSigner);
    await expect(account.signer.signEvent({ kind: 1 })).rejects.toThrow(/read-only/);
    expect(showToast).toHaveBeenCalledWith('read-only prompt', 'warning');
    // Idempotent — re-running must not double-wrap.
    const wrapped = account.signer;
    hardenExtensionAccounts([account]);
    expect(account.signer).toBe(wrapped);
  });
});
