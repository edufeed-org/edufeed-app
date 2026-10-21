import * as nip49 from 'nostr-tools/nip49';

// Legacy names, kept only for callers that know no identity (the file then
// carries nothing but the key, exactly as before).
const PLAIN_FILENAME = 'nostr-private-key.txt';
const ENCRYPTED_FILENAME = 'nostr-encrypted-key.txt';

/**
 * Lowercase ASCII slug for a file name: umlauts folded, everything that is
 * not a-z/0-9 collapsed to one dash.
 * @param {string | undefined} value
 * @returns {string}
 */
function slug(value) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * File name that tells two backups apart: app, account label and a short
 * npub. Two accounts backed up into the same folder used to land in the same
 * `nostr-private-key.txt`, so the second silently replaced the first (issue
 * ddce9cc0). Without an npub (legacy callers) the old names are returned.
 *
 * @param {object} opts
 * @param {string} [opts.appName]
 * @param {string} [opts.label] - account or community name
 * @param {string} [opts.npub]
 * @param {'personal' | 'community'} [opts.kind]
 * @param {boolean} [opts.encrypted]
 * @returns {string}
 */
export function recoveryFileName({
  appName,
  label,
  npub,
  kind = 'personal',
  encrypted = false
} = {}) {
  if (!npub) return encrypted ? ENCRYPTED_FILENAME : PLAIN_FILENAME;
  const parts = [
    slug(appName || 'edufeed') || 'edufeed',
    'backup',
    kind === 'community' ? 'community' : '',
    slug(label) || 'konto',
    `${npub.slice(0, 12)}-${npub.slice(-4)}`,
    encrypted ? 'encrypted' : ''
  ].filter(Boolean);
  return `${parts.join('-')}.txt`;
}

/**
 * The key token (nsec1… or ncryptsec1…) inside a pasted backup file, or the
 * trimmed input when it holds no such token. Lets the private-key login
 * accept a whole backup file pasted in, header lines and all.
 * @param {string} text
 * @returns {string}
 */
export function extractKeyToken(text) {
  const trimmed = (text ?? '').trim();
  const match = trimmed.match(/\b(?:nsec1|ncryptsec1)[02-9ac-hj-np-z]+/i);
  return match ? match[0] : trimmed;
}

/**
 * Build the contents of a recovery file the user can save to disk.
 * Pure function — no DOM/IO so it can be unit-tested anywhere.
 *
 * With an identity (`npub`) the file starts with a short bilingual header —
 * which account, which app, when — and ends with the key alone on its own
 * line, so a file found months later still says whose key it holds.
 * Without one it is the bare key, as before.
 *
 * @param {object} opts
 * @param {Uint8Array} opts.privateKey - Raw secret key bytes
 * @param {string} opts.nsec - Pre-encoded bech32 nsec (saves re-encoding)
 * @param {string} [opts.password] - If present, returns a NIP-49 ncryptsec instead of plain nsec
 * @param {string} [opts.label] - account or community name for the header + file name
 * @param {string} [opts.npub]
 * @param {string} [opts.appName]
 * @param {'personal' | 'community'} [opts.kind]
 * @param {Date} [opts.createdAt]
 * @returns {{ content: string, filename: string }}
 */
export function buildRecoveryFile({
  privateKey,
  nsec,
  password,
  label,
  npub,
  appName,
  kind = 'personal',
  createdAt
}) {
  if (password === '') {
    throw new Error('Password must not be empty');
  }
  const encrypted = !!password;
  const key = encrypted ? nip49.encrypt(privateKey, password) : nsec;
  const filename = recoveryFileName({ appName, label, npub, kind, encrypted });
  if (!npub) return { content: key, filename };

  const app = appName || 'Edufeed';
  const date = (createdAt ?? new Date()).toISOString().slice(0, 10);
  const who = kind === 'community' ? 'Community' : 'Konto / Account';
  const keyLine = encrypted
    ? 'Verschlüsselter privater Schlüssel (ncryptsec, Passwort nötig) / encrypted private key (password required):'
    : 'Privater Schlüssel (nsec) – geheim halten! / private key (nsec) – keep it secret:';
  const content = [
    `${app} – Nostr-Schlüssel-Sicherung / Nostr key backup`,
    `${who}: ${label || '-'}`,
    `npub: ${npub}`,
    `Erstellt / Created: ${date}`,
    '',
    keyLine,
    key,
    ''
  ].join('\n');
  return { content, filename };
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
