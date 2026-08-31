/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { nip44EncryptWith, nip44DecryptWith, signerHasNip44 } from '$lib/helpers/forms/crypto.js';
import { buildResponseTags } from '$lib/helpers/forms.js';

describe('nip44 signer helpers', () => {
  it('uses the nested nip44.encrypt surface when present', async () => {
    const encrypt = vi.fn().mockResolvedValue('cipher');
    expect(await nip44EncryptWith({ nip44: { encrypt } }, 'pk', 'plain')).toBe('cipher');
    expect(encrypt).toHaveBeenCalledWith('pk', 'plain');
  });
  it('falls back to the flat nip44Encrypt surface', async () => {
    const nip44Encrypt = vi.fn().mockResolvedValue('cipher');
    expect(await nip44EncryptWith({ nip44Encrypt }, 'pk', 'plain')).toBe('cipher');
  });
  it('throws without any nip44 surface', async () => {
    await expect(nip44EncryptWith({}, 'pk', 'plain')).rejects.toThrow(/NIP-44/);
  });
  it('decrypt mirrors both surfaces and signerHasNip44 detects them', async () => {
    const decrypt = vi.fn().mockResolvedValue('plain');
    expect(await nip44DecryptWith({ nip44: { decrypt } }, 'pk', 'c')).toBe('plain');
    const nip44Decrypt = vi.fn().mockResolvedValue('plain');
    expect(await nip44DecryptWith({ nip44Decrypt }, 'pk', 'c')).toBe('plain');
    expect(signerHasNip44({ nip44: { decrypt } })).toBe(true);
    expect(signerHasNip44({ nip44Decrypt })).toBe(true);
    expect(signerHasNip44({})).toBe(false);
  });
});

describe('buildResponseTags', () => {
  it('emits 4-element NIP-101 response tags', () => {
    expect(buildResponseTags({ color: 'red', name: 'Ada' })).toEqual([
      ['response', 'color', 'red', '{}'],
      ['response', 'name', 'Ada', '{}']
    ]);
  });
});
