#!/usr/bin/env node
/**
 * NIP-09 cleanup for legacy kind-39737 concept / collection events.
 *
 * Before NIP-VOCAB v0.2 the publishing tooling emitted concepts AND
 * collections under the shared kind 39737, disambiguated by a
 * `['type', 'Concept' | 'Collection' | 'ConceptScheme']` tag.
 * Post-v0.2, concepts live on kind 39738 and collections on 39739 —
 * kind 39737 is exclusively for ConceptSchemes. This script publishes
 * NIP-09 deletions for the stale concept/collection events left behind
 * on relays by pre-split publish runs.
 *
 * Safety:
 *  - Dry-run by default: with no flags, prints what would be deleted and exits.
 *  - `--apply` is required to actually publish the kind-5 deletions.
 *  - Only targets events where `pubkey === publisherPubkey` AND the
 *    `type` tag is 'Concept' or 'Collection'. Schemes (and events
 *    without a `type` tag) are always preserved.
 *
 * Env (same as publish:vocabs):
 *   EDUFEED_PUBLISHER_NSEC    hex secret key
 *   EDUFEED_PUBLISH_RELAYS    comma-separated relay URLs
 *
 * Usage:
 *   node scripts/delete-legacy-concept-kinds.mjs          # dry-run
 *   node scripts/delete-legacy-concept-kinds.mjs --apply  # publish deletions
 */
import 'dotenv/config';
import { hexToBytes } from 'nostr-tools/utils';
import { getPublicKey } from 'nostr-tools/pure';
import { RelayPool } from 'applesauce-relay';
import { EventFactory } from 'applesauce-core/event-factory';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
// Side-effect import: registers factory.delete() (NIP-09 blueprint).
import 'applesauce-common';
import { timer, firstValueFrom, EMPTY } from 'rxjs';
import { takeUntil, toArray, catchError, tap } from 'rxjs/operators';
import { VOCAB_KIND } from 'nostr-vocab-core/constants';

const REQUEST_TIMEOUT_MS = 5_000;
const LEGACY_TYPES = new Set(['Concept', 'Collection']);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** @param {any} e */
function typeOf(e) {
  return e?.tags?.find((t) => t[0] === 'type')?.[1];
}

/** @param {any} e */
function dOf(e) {
  return e?.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
}

/**
 * Query one relay for all VOCAB_KIND events by the publisher, with a
 * bounded timeout so a hanging relay can't block the whole run.
 * @param {import('applesauce-relay').RelayPool} pool
 * @param {string} url
 * @param {string} publisherPubkey
 * @returns {Promise<any[]>}
 */
async function fetchFromRelay(pool, url, publisherPubkey) {
  const filter = { kinds: [VOCAB_KIND], authors: [publisherPubkey] };
  const events$ = pool
    .relay(url)
    .request(filter)
    .pipe(
      takeUntil(timer(REQUEST_TIMEOUT_MS)),
      toArray(),
      catchError((err) => {
        console.warn(`  ! query to ${url} failed: ${err?.message || err}`);
        return EMPTY;
      })
    );
  return (await firstValueFrom(events$, { defaultValue: [] })) || [];
}

/**
 * Publish an event to every relay, logging per-relay failures but not
 * aborting. Resolves to true iff at least one relay accepted it.
 * @param {import('applesauce-relay').RelayPool} pool
 * @param {string[]} relays
 * @param {any} event
 */
async function publishAll(pool, relays, event) {
  const results = await Promise.all(
    relays.map(async (url) => {
      try {
        await pool.relay(url).publish(event);
        return true;
      } catch (err) {
        console.warn(`    ! publish to ${url} failed: ${err?.message || err}`);
        return false;
      }
    })
  );
  return results.some(Boolean);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const skHex = requireEnv('EDUFEED_PUBLISHER_NSEC');
  const relays = requireEnv('EDUFEED_PUBLISH_RELAYS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const publisherPubkey = getPublicKey(hexToBytes(skHex));

  console.log(`Publisher pubkey: ${publisherPubkey}`);
  console.log(`Relays (${relays.length}): ${relays.join(', ')}`);
  console.log(
    `Mode: ${apply ? 'APPLY (will publish deletions)' : 'DRY-RUN (use --apply to publish)'}`
  );

  const pool = new RelayPool();

  // Fetch all kind-39737 events authored by the publisher from every relay,
  // deduping across relays by event id.
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const url of relays) {
    console.log(`\nQuerying ${url} …`);
    const events = await fetchFromRelay(pool, url, publisherPubkey);
    let newlySeen = 0;
    for (const e of events) {
      if (!e?.id) continue;
      // Belt-and-braces: authors filter should already enforce this.
      if (e.pubkey !== publisherPubkey) continue;
      if (!byId.has(e.id)) {
        byId.set(e.id, e);
        newlySeen++;
      }
    }
    console.log(`  received ${events.length} events (${newlySeen} new)`);
  }

  // Classify.
  const schemes = [];
  const legacy = [];
  const other = [];
  for (const e of byId.values()) {
    const t = typeOf(e);
    if (t && LEGACY_TYPES.has(t)) legacy.push(e);
    else if (t === 'ConceptScheme' || !t) schemes.push(e);
    else other.push(e);
  }

  console.log(`\nSummary:`);
  console.log(`  schemes preserved:      ${schemes.length}`);
  console.log(`  other/unknown type:     ${other.length} (preserved)`);
  console.log(`  legacy to delete:       ${legacy.length}`);

  if (legacy.length === 0) {
    console.log('\nNothing to delete. Exiting.');
    process.exit(0);
  }

  // Group legacy events by type tag for the summary listing.
  /** @type {Record<string, any[]>} */
  const byType = {};
  for (const e of legacy) {
    const t = typeOf(e);
    (byType[t] ||= []).push(e);
  }
  for (const [t, list] of Object.entries(byType)) {
    console.log(`\n  ${t} (${list.length}):`);
    for (const e of list) {
      const ts = new Date(e.created_at * 1000).toISOString();
      console.log(
        `    ${VOCAB_KIND}:${e.pubkey}:${dOf(e)}  created_at=${ts}  id=${e.id.slice(0, 12)}…`
      );
    }
  }

  if (!apply) {
    console.log('\nDry-run complete. Re-run with --apply to publish NIP-09 deletions.');
    process.exit(0);
  }

  // Apply: build + publish a NIP-09 deletion for every legacy event.
  const signer = new PrivateKeySigner(hexToBytes(skHex));
  const factory = new EventFactory({ signer });

  let failures = 0;
  for (const e of legacy) {
    process.stdout.write(`\nDeleting ${VOCAB_KIND}:${e.pubkey}:${dOf(e)} (${typeOf(e)}) … `);
    try {
      const deleteTemplate = await factory.delete([e]);
      const signedDelete = await factory.sign(deleteTemplate);
      const ok = await publishAll(pool, relays, signedDelete);
      if (ok) {
        console.log('ok');
      } else {
        console.log('FAILED (no relay accepted)');
        failures++;
      }
    } catch (err) {
      console.log(`FAILED (${err?.message || err})`);
      failures++;
    }
  }

  console.log(`\nDone. ${legacy.length - failures}/${legacy.length} deletions published.`);
  if (failures > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
