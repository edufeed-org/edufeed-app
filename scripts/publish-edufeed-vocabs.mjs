#!/usr/bin/env node
/**
 * Publish edufeed default vocabularies as kind-39737 events.
 *
 * Reads vocab definitions from `scripts/data/edufeed-vocabs.json` — two
 * source types are supported:
 *   - `skohub`: fetched + parsed via nostr-vocab-skos-import
 *   - `inline`: built directly from embedded concept list (for small enums
 *     without a SkoHub source, e.g. interactivityType, conditionsOfAccess)
 *
 * Env:
 *   EDUFEED_PUBLISHER_NSEC    hex secret key
 *   EDUFEED_PUBLISH_RELAYS    comma-separated relay URLs
 *
 * Usage:
 *   pnpm run publish:vocabs
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hexToBytes } from 'nostr-tools/utils';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { RelayPool } from 'applesauce-relay';

import { fetchSkohubVocab, parseSkos, convertToDrafts } from 'nostr-vocab-skos-import';
import { buildConceptScheme, buildConcept } from 'nostr-vocab-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOCAB_DATA_PATH = resolve(__dirname, 'data/edufeed-vocabs.json');

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

/**
 * Build a skohub-sourced vocab into signed scheme + concept events.
 */
async function buildSkohubDrafts(scheme, pubkey, relayHint) {
  const raw = await fetchSkohubVocab(scheme.source.url);
  const parsed = await parseSkos(raw);
  const draftsRaw = convertToDrafts(parsed, pubkey);

  // Override the d slug with our canonical identifier + rewrite scheme refs in concepts
  const originalSchemeAddress = `39737:${pubkey}:${draftsRaw.scheme.d}`;
  const canonicalSchemeAddress = `39737:${pubkey}:${scheme.d}`;
  draftsRaw.scheme.d = scheme.d;
  const rewriteRef = (r) =>
    r && r.address === originalSchemeAddress ? { ...r, address: canonicalSchemeAddress } : r;
  draftsRaw.concepts = draftsRaw.concepts.map((c) => ({
    ...c,
    inScheme: rewriteRef(c.inScheme),
    topConceptOf: rewriteRef(c.topConceptOf)
  }));
  return applyRelayHint(draftsRaw, relayHint);
}

/**
 * Build an inline vocab into scheme + concept drafts (no network, no SKOS parse).
 */
function buildInlineDrafts(scheme, pubkey, relayHint) {
  const schemeAddress = `39737:${pubkey}:${scheme.d}`;
  const inScheme = { address: schemeAddress, relay: relayHint };
  const concepts = (scheme.source.concepts || []).map((c) => ({
    d: c.d,
    prefLabels: c.prefLabels || [],
    altLabels: c.altLabels || [],
    definitions: c.definitions || [],
    externalUri: c.externalUri,
    inScheme
  }));
  return {
    scheme: {
      d: scheme.d,
      prefLabels: scheme.source.prefLabels || [{ value: scheme.d, lang: 'en' }],
      descriptions: scheme.source.descriptions || []
    },
    concepts
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

  const { schemes } = JSON.parse(readFileSync(VOCAB_DATA_PATH, 'utf8'));

  /** @type {string[]} */
  const failed = [];

  for (const scheme of schemes) {
    console.log(`\n=== ${scheme.d} (${scheme.source.type}) ===`);
    try {
      const drafts =
        scheme.source.type === 'skohub'
          ? await buildSkohubDrafts(scheme, pubkey, relays[0])
          : buildInlineDrafts(scheme, pubkey, relays[0]);

      // Stamp `published_at` on the scheme so picker clients (which filter
      // drafts — schemes without this tag) surface it. Concepts are not
      // stamped; the draft/published distinction is scheme-level only,
      // matching the `nocabs` convention.
      const publishedAt = Math.floor(Date.now() / 1000);
      const schemeSigned = signEvent(
        buildConceptScheme({ ...drafts.scheme, publishedAt }),
        skHex
      );
      const conceptSigneds = drafts.concepts.map((c) => signEvent(buildConcept(c), skHex));

      const naddr = nip19.naddrEncode({
        kind: 39737,
        pubkey,
        identifier: scheme.d,
        relays: relays.slice(0, 2)
      });
      console.log(`  naddr: ${naddr}`);
      console.log(`  publishing ${conceptSigneds.length + 1} events to ${relays.length} relays …`);
      await publishAll(pool, relays, [schemeSigned, ...conceptSigneds]);
    } catch (err) {
      console.warn(`  ! skipped ${scheme.d}: ${err.message || err}`);
      failed.push(scheme.d);
    }
  }

  if (failed.length > 0) {
    console.log(`\nDone (with ${failed.length} skipped: ${failed.join(', ')}).`);
    process.exit(1);
  }
  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
