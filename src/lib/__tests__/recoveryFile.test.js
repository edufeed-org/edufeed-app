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

// --- Issue ddce9cc0: identical file names + bare key content in every flow
// made two backups indistinguishable; the second overwrote the first.
import { recoveryFileName, extractKeyToken } from '../helpers/recoveryFile.js';

const NPUB = 'npub1xn34lppmdua2ft2qljhm59pm83xpfmsx4j9ctkx67suxh2us05js5zhftc';

describe('recoveryFileName', () => {
  it('names the file after app, account and a short npub so two backups never collide', () => {
    expect(recoveryFileName({ appName: 'Edufeed', label: 'Testkonto A', npub: NPUB })).toBe(
      'edufeed-backup-testkonto-a-npub1xn34lpp-hftc.txt'
    );
  });

  it('marks community keys and encrypted files, and survives odd labels', () => {
    expect(
      recoveryFileName({
        appName: 'Edufeed',
        label: 'Lehrer:innen/Café!',
        npub: NPUB,
        kind: 'community'
      })
    ).toBe('edufeed-backup-community-lehrer-innen-cafe-npub1xn34lpp-hftc.txt');
    expect(recoveryFileName({ label: '', npub: NPUB, encrypted: true })).toBe(
      'edufeed-backup-konto-npub1xn34lpp-hftc-encrypted.txt'
    );
  });

  it('falls back to the legacy names without an npub', () => {
    expect(recoveryFileName({})).toBe('nostr-private-key.txt');
    expect(recoveryFileName({ encrypted: true })).toBe('nostr-encrypted-key.txt');
  });
});

describe('buildRecoveryFile with identity header', () => {
  it('writes a header naming account, npub and date, with the key alone on the last line', () => {
    const privateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(privateKey);
    const file = buildRecoveryFile({
      privateKey,
      nsec,
      label: 'Testkonto A',
      npub: NPUB,
      appName: 'Edufeed',
      createdAt: new Date('2026-10-14T08:00:00Z')
    });
    const lines = file.content.trimEnd().split('\n');
    expect(lines[0]).toContain('Edufeed');
    expect(file.content).toContain('Testkonto A');
    expect(file.content).toContain(NPUB);
    expect(file.content).toContain('2026-10-14');
    expect(lines[lines.length - 1]).toBe(nsec);
    expect(file.filename).toBe('edufeed-backup-testkonto-a-npub1xn34lpp-hftc.txt');
  });

  it('keeps the ncryptsec decryptable and labels the file as encrypted', () => {
    const privateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(privateKey);
    const file = buildRecoveryFile({
      privateKey,
      nsec,
      password: 'correct horse battery staple',
      label: 'Testkonto A',
      npub: NPUB,
      appName: 'Edufeed'
    });
    const token = extractKeyToken(file.content);
    expect(token).toMatch(/^ncryptsec1/);
    expect(nip49.decrypt(token, 'correct horse battery staple')).toEqual(privateKey);
    expect(file.filename).toMatch(/-encrypted\.txt$/);
  });
});

describe('extractKeyToken', () => {
  it('pulls the key out of a pasted backup file, and leaves a bare key alone', () => {
    const privateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(privateKey);
    const file = buildRecoveryFile({
      privateKey,
      nsec,
      label: 'x',
      npub: NPUB,
      appName: 'Edufeed'
    });
    expect(extractKeyToken(file.content)).toBe(nsec);
    expect(extractKeyToken(`  ${nsec}\n`)).toBe(nsec);
    expect(
      extractKeyToken(
        'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk'
      )
    ).toMatch(/^ncryptsec1/);
    expect(extractKeyToken('nothing here')).toBe('nothing here');
    expect(extractKeyToken('')).toBe('');
  });
});
