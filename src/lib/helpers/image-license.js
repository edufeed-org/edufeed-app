/**
 * Builds a kind 1063 event template for an image license attestation.
 * Pure function: no I/O, no signing. Caller signs + publishes.
 *
 * NIP-94 (file metadata) provides the bones: url, x (sha256), m (mime).
 * We add application tags for the license attestation semantics:
 *   - title:   (optional) the work's title — used by TULLU as Titel
 *   - license: license URL (CC, etc.)
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
 *   title?: string,
 *   source?: string,
 *   creatorPubkey?: string,
 *   description?: string,
 *   size?: number,
 *   dim?: string
 * }} input
 * @returns {{ kind: 1063, content: string, tags: string[][] }}
 */
export function buildLicenseTemplate(input) {
  const { hash, url, mime, license, credit, title, source, creatorPubkey, description, size, dim } =
    input;
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
  if (title && title.trim()) tags.push(['title', title.trim()]);
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

/**
 * Reads the `url` tag from a kind 1063 license event — the location of the
 * already-uploaded blob it attests. Returns null when absent.
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {string | null}
 */
export function getLicenseUrl(event) {
  return event?.tags?.find((t) => t[0] === 'url')?.[1] ?? null;
}

import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { firstValueFrom, take, timeout, catchError, of } from 'rxjs';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';

/**
 * One-shot relay lookup for an existing NIP-94 kind 1063 license event
 * keyed by SHA-256 hash. Queries the full lookup-relay set (educational
 * + fallback + user NIP-65 read relays) and resolves as soon as the FIRST
 * matching event arrives. Adds the event to EventStore so reactive
 * subscribers see it. Returns null on empty hash, no relays, or 2-second
 * timeout with no events.
 *
 * Trade-off: take(1) returns the first event from any relay rather than
 * waiting to collect candidates from all relays for a newest-wins pick.
 * For "does a license exist for this hash" the first hit is sufficient;
 * if the user disagrees with the picked attestation they can click Replace.
 *
 * @param {string} hash - SHA-256 hex of the blob.
 * @returns {Promise<import('nostr-tools').NostrEvent | null>}
 */
export async function findExistingLicense(hash) {
  if (!hash) return null;
  const relays = getAllLookupRelays();
  if (!relays || relays.length === 0) return null;

  /** @type {import('nostr-tools').Filter} */
  const filter = { kinds: [1063], '#x': [hash] };

  const event = await firstValueFrom(
    pool.request(relays, [filter]).pipe(
      take(1),
      timeout({ each: 2000, with: () => of(null) }),
      catchError(() => of(null))
    ),
    { defaultValue: null }
  );

  if (!event) return null;

  // Persist to EventStore so subsequent useLicenseForHash subscribers see it.
  try {
    eventStore.add(event);
  } catch {
    /* no-op on duplicates */
  }

  return event;
}

/**
 * Build → sign → add-to-store → publish a kind-1063 license attestation.
 * The single publish path shared by the LicenseModal create-flow and the OER
 * picker's mint-on-pick. Optimistic: adds to EventStore before the relay round
 * trip so reactive `useLicenseForHash` subscribers see the badge immediately.
 *
 * @param {Parameters<typeof buildLicenseTemplate>[0]} input
 * @param {{ pubkey: string, signEvent: (e: any) => Promise<any> } | null | undefined} signer
 * @returns {Promise<import('nostr-tools').NostrEvent>}
 */
export async function publishLicenseAttestation(input, signer) {
  if (!signer) throw new Error('publishLicenseAttestation: no signer');
  const template = buildLicenseTemplate(input);
  const factory = createAppEventFactory();
  const eventTemplate = await factory.build(template);
  const signed = await signer.signEvent(eventTemplate);
  eventStore.add(signed);
  publishEventOptimistic(signed, [], {});
  return signed;
}
