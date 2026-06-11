import * as nip49 from 'nostr-tools/nip49';

const PLAIN_FILENAME = 'nostr-private-key.txt';
const ENCRYPTED_FILENAME = 'nostr-encrypted-key.txt';

/**
 * Build the contents of a recovery file the user can save to disk.
 * Pure function — no DOM/IO so it can be unit-tested anywhere.
 *
 * @param {object} opts
 * @param {Uint8Array} opts.privateKey - Raw secret key bytes
 * @param {string} opts.nsec - Pre-encoded bech32 nsec (saves re-encoding)
 * @param {string} [opts.password] - If present, returns a NIP-49 ncryptsec instead of plain nsec
 * @returns {{ content: string, filename: string }}
 */
export function buildRecoveryFile({ privateKey, nsec, password }) {
  if (password === '') {
    throw new Error('Password must not be empty');
  }
  if (password) {
    const ncryptsec = nip49.encrypt(privateKey, password);
    return { content: ncryptsec, filename: ENCRYPTED_FILENAME };
  }
  return { content: nsec, filename: PLAIN_FILENAME };
}

/**
 * Trigger a browser download of a recovery file. Thin DOM wrapper around
 * {@link buildRecoveryFile}. Browser-only — calling from Node will throw.
 *
 * @param {Parameters<typeof buildRecoveryFile>[0]} opts
 */
export function downloadRecoveryFile(opts) {
  const { content, filename } = buildRecoveryFile(opts);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
