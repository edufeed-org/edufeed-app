#!/usr/bin/env node
/**
 * Publish edufeed default vocabularies as kind-39737 events.
 * Reads EDUFEED_PUBLISHER_NSEC (hex) and EDUFEED_PUBLISH_RELAYS (comma list) from env.
 *
 * Usage:
 *   pnpm run publish:vocabs
 */
import 'dotenv/config';
import { hexToBytes } from 'nostr-tools/utils';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { RelayPool } from 'applesauce-relay';

import { fetchSkohubVocab, parseSkos, convertToDrafts } from 'nostr-vocab-skos-import';
import { buildConceptScheme, buildConcept } from 'nostr-vocab-core';

const VOCABS = [
  { d: 'schulfaecher', url: 'https://w3id.org/kim/schulfaecher/' },
  { d: 'hcrt', url: 'https://w3id.org/kim/hcrt/scheme' }
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function signEvent(template, skHex) {
  const sk = hexToBytes(skHex);
  const event = { ...template, created_at: Math.floor(Date.now() / 1000) };
  return finalizeEvent(event, sk);
}

async function publishAll(pool, relays, events) {
  for (const e of events) {
    await Promise.all(
      relays.map((url) =>
        pool
          .relay(url)
          .publish(e)
          .catch((err) => {
            console.warn(`  ! publish to ${url} failed: ${err.message}`);
          })
      )
    );
  }
}

function applyRelayHint(drafts, relayHint) {
  return {
    scheme: drafts.scheme,
    concepts: drafts.concepts.map((c) => ({
      ...c,
      inScheme: { ...c.inScheme, relay: relayHint },
      topConceptOf: c.topConceptOf ? { ...c.topConceptOf, relay: relayHint } : undefined,
      broader: (c.broader || []).map((r) => ({ ...r, relay: relayHint })),
      narrower: (c.narrower || []).map((r) => ({ ...r, relay: relayHint })),
      related: (c.related || []).map((r) => ({ ...r, relay: relayHint }))
    }))
  };
}

async function main() {
  const skHex = requireEnv('EDUFEED_PUBLISHER_NSEC');
  const relays = requireEnv('EDUFEED_PUBLISH_RELAYS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const pubkey = getPublicKey(hexToBytes(skHex));
  const pool = new RelayPool();

  for (const v of VOCABS) {
    console.log(`\n=== ${v.d} — fetching ${v.url} ===`);
    const raw = await fetchSkohubVocab(v.url);
    const parsed = await parseSkos(raw);
    const draftsRaw = convertToDrafts(parsed, pubkey);
    // Override the d slug with our canonical identifier + populate relay hints
    draftsRaw.scheme.d = v.d;
    const drafts = applyRelayHint(draftsRaw, relays[0]);

    const schemeSigned = signEvent(buildConceptScheme(drafts.scheme), skHex);
    const conceptSigneds = drafts.concepts.map((c) => signEvent(buildConcept(c), skHex));

    const naddr = nip19.naddrEncode({
      kind: 39737,
      pubkey,
      identifier: v.d,
      relays: relays.slice(0, 2)
    });
    console.log(`  published scheme naddr: ${naddr}`);
    console.log(`  publishing ${conceptSigneds.length + 1} events to ${relays.length} relays …`);
    await publishAll(pool, relays, [schemeSigned, ...conceptSigneds]);
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
