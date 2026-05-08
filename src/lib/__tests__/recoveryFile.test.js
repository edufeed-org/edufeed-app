/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { generateSecretKey, nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';

import { buildRecoveryFile } from '../helpers/recoveryFile.js';

describe('buildRecoveryFile', () => {
  it('returns a plain nsec file when no password is given', () => {
    const privateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(privateKey);

    const file = buildRecoveryFile({ privateKey, nsec });

    expect(file.content).toBe(nsec);
    expect(file.filename).toMatch(/\.txt$/);
    expect(file.filename).toContain('nostr');
  });

  it('returns an ncryptsec file that decrypts back to the original key when given a password', () => {
    const privateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(privateKey);

    const file = buildRecoveryFile({ privateKey, nsec, password: 'correct horse battery staple' });

    expect(file.content).toMatch(/^ncryptsec1/);
    expect(file.filename).toMatch(/\.txt$/);

    const decrypted = nip49.decrypt(file.content, 'correct horse battery staple');
    expect(decrypted).toEqual(privateKey);
  });

  it('uses different filenames for plain vs encrypted so users can tell them apart', () => {
    const privateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(privateKey);

    const plain = buildRecoveryFile({ privateKey, nsec });
    const encrypted = buildRecoveryFile({ privateKey, nsec, password: 'pw1234567' });

    expect(plain.filename).not.toBe(encrypted.filename);
  });

  it('throws if password is an empty string (defensive — empty pw is almost certainly a UI bug)', () => {
    const privateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(privateKey);

    expect(() => buildRecoveryFile({ privateKey, nsec, password: '' })).toThrow();
  });
});
