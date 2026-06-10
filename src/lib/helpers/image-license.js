/**
 * Builds a kind 1063 event template for an image license attestation.
 * Pure function: no I/O, no signing. Caller signs + publishes.
 *
 * NIP-94 (file metadata) provides the bones: url, x (sha256), m (mime).
 * We add three application tags for the license attestation semantics:
 *   - license: license URL (CC, MIT, etc.)
 *   - credit:  human-readable attribution
 *   - source:  (optional) where the image was originally found
 *   - p:       (optional) attribution to a Nostr pubkey
 *
 * @param {{
 *   hash: string,
 *   url: string,
 *   mime: string,
 *   license: string,
 *   credit: string,
 *   source?: string,
 *   creatorPubkey?: string,
 *   description?: string,
 *   size?: number,
 *   dim?: string
 * }} input
 * @returns {{ kind: 1063, content: string, tags: string[][] }}
 */
export function buildLicenseTemplate(input) {
  const { hash, url, mime, license, credit, source, creatorPubkey, description, size, dim } = input;
  if (!hash) throw new Error('buildLicenseTemplate: hash is required');
  if (!url) throw new Error('buildLicenseTemplate: url is required');
  if (!mime) throw new Error('buildLicenseTemplate: mime is required');
  if (!license) throw new Error('buildLicenseTemplate: license is required');
  if (!credit) throw new Error('buildLicenseTemplate: credit is required');

  /** @type {string[][]} */
  const tags = [
    ['url', url],
    ['x', hash],
    ['m', mime]
  ];
  if (typeof size === 'number') tags.push(['size', String(size)]);
  if (dim) tags.push(['dim', dim]);
  tags.push(['license', license]);
  tags.push(['credit', credit]);
  if (source) tags.push(['source', source]);
  if (creatorPubkey) tags.push(['p', creatorPubkey]);

  return {
    kind: 1063,
    content: description ?? '',
    tags
  };
}

import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
import { firstValueFrom, toArray, takeUntil, timer, catchError, of } from 'rxjs';

/**
 * One-shot relay lookup for an existing NIP-94 kind 1063 license event
 * keyed by SHA-256 hash. Queries the educational relays with a 2-second
 * timeout, adds received events to EventStore, and returns the newest
 * (tie-break by lex id). Returns null on empty hash, no relays, no events,
 * or timeout.
 *
 * @param {string} hash - SHA-256 hex of the blob.
 * @returns {Promise<import('nostr-tools').NostrEvent | null>}
 */
export async function findExistingLicense(hash) {
  if (!hash) return null;
  const relays = getEducationalRelays();
  if (!relays || relays.length === 0) return null;

  /** @type {import('nostr-tools').Filter} */
  const filter = { kinds: [1063], '#x': [hash] };

  const events = await firstValueFrom(
    pool.request(relays, [filter]).pipe(
      takeUntil(timer(2000)), // force-complete upstream at 2s so toArray emits
      toArray(),
      catchError(() => of(/** @type {any[]} */ ([])))
    )
  );

  if (!events || events.length === 0) return null;

  // Persist to EventStore so subsequent useLicenseForHash subscribers see them.
  for (const ev of events) {
    try {
      eventStore.add(ev);
    } catch {
      /* no-op on duplicates */
    }
  }

  // Newest by created_at; tie-break by lex id (smaller wins).
  const sorted = [...events].sort((a, b) => {
    if (b.created_at !== a.created_at) return b.created_at - a.created_at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted[0] ?? null;
}
