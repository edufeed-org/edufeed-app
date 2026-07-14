#!/usr/bin/env node
/**
 * End-to-end smoke test for the /api/nip05 proxy.
 *
 * Reads EDUFEED_PUBLISHER_NSEC + MEMBERSHIP_ADMIN_PUBKEYS from .env in the
 * worktree root, signs a NIP-98 request as the admin, and POSTs a fresh
 * timestamped handle to localhost. Then curls the upstream .well-known to
 * confirm the entry was provisioned.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, '')
      ];
    })
);

const rawKey = env.EDUFEED_PUBLISHER_NSEC;
const adminAllow = (env.MEMBERSHIP_ADMIN_PUBKEYS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const upstream = (env.NIP05_SERVICE_URL || '').replace(/\/$/, '');

if (!rawKey) throw new Error('EDUFEED_PUBLISHER_NSEC missing');

/** @type {Uint8Array} */
let sk;
if (rawKey.startsWith('nsec')) {
  const { type, data } = nip19.decode(rawKey);
  if (type !== 'nsec') throw new Error('Not an nsec');
  sk = /** @type {Uint8Array} */ (data);
} else if (/^[0-9a-f]{64}$/i.test(rawKey)) {
  sk = Uint8Array.from(Buffer.from(rawKey, 'hex'));
} else {
  throw new Error('EDUFEED_PUBLISHER_NSEC is neither nsec nor 64-char hex');
}
const pubkey = getPublicKey(sk);
console.log('admin pubkey:', pubkey);
console.log('allow-listed:', adminAllow.includes(pubkey));

// Fresh handle and a throwaway applicant pubkey
const name = `smoketest-${Date.now()}`;
const applicantPubkey = 'b'.repeat(64);

const url = 'http://localhost:5174/api/nip05';
const body = JSON.stringify({ name, pubkey: applicantPubkey });

// Build NIP-98 event — payload tag = sha256 of raw body string
const payloadHash = createHash('sha256').update(body).digest('hex');
const draft = {
  kind: 27235,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['u', url],
    ['method', 'POST'],
    ['payload', payloadHash]
  ],
  content: ''
};
const signed = finalizeEvent(draft, sk);
const authHeader = `Nostr ${Buffer.from(JSON.stringify(signed)).toString('base64')}`;

console.log('\nPOST', url);
console.log('body:', body);
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: authHeader },
  body
});
const text = await res.text();
console.log('status:', res.status);
console.log('body:', text);

if (!res.ok) {
  console.error('\nFAIL: proxy did not 2xx');
  process.exit(1);
}

// Confirm upstream resolves the handle
console.log(`\nGET ${upstream}/.well-known/nostr.json?name=${name}`);
const verify = await fetch(`${upstream}/.well-known/nostr.json?name=${name}`);
const verifyJson = await verify.json();
console.log('status:', verify.status);
console.log('body:', JSON.stringify(verifyJson));

const resolved = verifyJson?.names?.[name];
if (resolved === applicantPubkey) {
  console.log('\nOK: handle provisioned and resolves');
} else {
  console.error('\nFAIL: handle not present in .well-known');
  process.exit(1);
}
