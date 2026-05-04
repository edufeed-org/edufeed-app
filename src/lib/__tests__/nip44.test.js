/**
 * NIP-44 capability helper tests
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { hasNip44 } from '../helpers/nip44.js';

describe('hasNip44', () => {
  it('returns false for undefined signer', () => {
    expect(hasNip44(undefined)).toBe(false);
  });

  it('returns false for null signer', () => {
    expect(hasNip44(null)).toBe(false);
  });

  it('returns false when signer has no nip44 namespace', () => {
    expect(hasNip44({})).toBe(false);
  });

  it('returns false when nip44 namespace is undefined (ExtensionSigner without window.nostr.nip44)', () => {
    expect(hasNip44({ nip44: undefined })).toBe(false);
  });

  it('returns false when only encrypt is defined', () => {
    expect(hasNip44({ nip44: { encrypt: () => Promise.resolve('') } })).toBe(false);
  });

  it('returns false when only decrypt is defined', () => {
    expect(hasNip44({ nip44: { decrypt: () => Promise.resolve('') } })).toBe(false);
  });

  it('returns true when both encrypt and decrypt are functions', () => {
    expect(
      hasNip44({
        nip44: {
          encrypt: () => Promise.resolve(''),
          decrypt: () => Promise.resolve('')
        }
      })
    ).toBe(true);
  });
});
