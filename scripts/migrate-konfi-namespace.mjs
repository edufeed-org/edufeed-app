#!/usr/bin/env node
// Migrate existing Konfi kind-30142 events from the illegal `ext:ekw:konfi:*`
// key shape to the conformant `ext:org.edufeed.ekw.konfi:*` namespace
// (NIP-AMB amended grammar — see docs/superpowers/specs/2026-07-28-amb-serializer-convergence-design.md).
//
// The transform is mechanical and value-preserving:
//   ext:ekw:konfi:<slug>:id            -> ext:org.edufeed.ekw.konfi:<slug>:id
//   ext:ekw:konfi:<slug>:type          -> ext:org.edufeed.ekw.konfi:<slug>:type
//   ext:ekw:konfi:<slug>:prefLabel:<l> -> ext:org.edufeed.ekw.konfi:<slug>:prefLabel:<l>
//   ext:ekw:konfi:<slug>               -> ext:org.edufeed.ekw.konfi:<slug>            (bare scalar)
//   ext:ekw:konfi:<slug>:custom        -> ext:org.edufeed.ekw.konfi:<slug>            (custom value
//        becomes a BARE tag — matches what the converged emitter now produces for
//        allowCustom fields; `:custom` is NOT a legal sub under the amended grammar)
// Every non-`ext:ekw:konfi:` tag is copied through unchanged. The `d` tag is kept,
// so the re-signed event REPLACES the old one (NIP-01 replaceable). created_at is
// bumped so it supersedes.
//
// SCOPE: the migration set is every ext-bearing event under `#l=ekw`, not only
// those carrying konfi keys — some are already conformant and are re-signed
// unchanged purely to pull them back through the fixed relay converter, which
// runs at index time. See the note in main().
//
// ORDER: deploy the relay fix (nostrlib fix/amb-ext-grammar) BEFORE running with
// --publish, or the re-published events are re-indexed by the old converter and
// the run is wasted.
//
// Usage:
//   node scripts/migrate-konfi-namespace.mjs                 # DRY RUN (read-only, no key needed)
//   node scripts/migrate-konfi-namespace.mjs --publish       # sign + publish (needs keys, see below)
//
// Publish mode signing keys (one per original author pubkey) via env, hex or nsec:
//   MIGRATE_NSEC_<pubkeyPrefix8>=nsec1...   e.g. MIGRATE_NSEC_64278b3f=nsec1...
// (Only authors whose key is supplied are published; others are listed as skipped.)

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

const hexToBytes = (hex) => Uint8Array.from(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));

const RELAYS = [
  'wss://amb-relay.edufeed.org',
  'wss://oersi.edufeed.org',
  'wss://relay.edufeed.org'
];
const OLD_PREFIX = 'ext:ekw:konfi:';
const NEW_NS = 'org.edufeed.ekw.konfi';
const NEW_PREFIX = `ext:${NEW_NS}:`;
const LEGAL_SUBS = new Set(['id', 'type', 'name']); // prefLabel:<lang> handled separately

const PUBLISH = process.argv.includes('--publish');

/** One old konfi tag -> its migrated form (value preserved). */
function migrateKonfiTag(tag) {
  const [key, ...rest] = tag;
  const tail = key.slice(OLD_PREFIX.length); // "<slug>" or "<slug>:<sub...>"
  const parts = tail.split(':');
  const slug = parts[0];
  const sub = parts.slice(1).join(':'); // '', 'id', 'type', 'prefLabel:de', 'custom', ...
  if (sub === '') return [`${NEW_PREFIX}${slug}`, ...rest]; // bare scalar
  if (sub === 'custom') return [`${NEW_PREFIX}${slug}`, ...rest]; // custom -> bare (new emit shape)
  if (LEGAL_SUBS.has(sub) || sub.startsWith('prefLabel:'))
    return [`${NEW_PREFIX}${slug}:${sub}`, ...rest];
  // Unknown sub — flag by returning null so the caller can surface it rather than
  // silently emit an illegal key.
  return null;
}

function transformEvent(ev) {
  const notes = [];
  const newTags = [];
  let changed = 0;
  for (const tag of ev.tags) {
    if (typeof tag[0] === 'string' && tag[0].indexOf(OLD_PREFIX) === 0) {
      const migrated = migrateKonfiTag(tag);
      if (!migrated) {
        notes.push(`UNKNOWN SUB in ${tag[0]} — left unmigrated, NEEDS REVIEW`);
        newTags.push(tag);
      } else {
        newTags.push(migrated);
        changed++;
      }
    } else {
      newTags.push(tag);
    }
  }
  return { newTags, changed, notes };
}

function query(url, filter, ms = 6000) {
  return new Promise((resolve) => {
    const out = [];
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return resolve({ url, error: String(e), out });
    }
    const sub = 's' + Math.floor(Math.random() * 1e6);
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // already closed / never opened — nothing to clean up
      }
      resolve({ url, out });
    }, ms);
    ws.onopen = () => ws.send(JSON.stringify(['REQ', sub, filter]));
    ws.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data);
        if (d[0] === 'EVENT' && d[1] === sub) out.push(d[2]);
        if (d[0] === 'EOSE' && d[1] === sub) {
          clearTimeout(t);
          try {
            ws.close();
          } catch {
            // already closed / never opened — nothing to clean up
          }
          resolve({ url, out });
        }
      } catch {
        // non-JSON or unexpected relay frame — ignore it and keep listening
      }
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve({ url, error: 'ws error', out });
    };
  });
}

function publish(url, ev, ms = 6000) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return resolve({ url, ok: false, reason: String(e) });
    }
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // already closed / never opened — nothing to clean up
      }
      resolve({ url, ok: false, reason: 'timeout' });
    }, ms);
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', ev]));
    ws.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data);
        if (d[0] === 'OK' && d[1] === ev.id) {
          clearTimeout(t);
          try {
            ws.close();
          } catch {
            // already closed / never opened — nothing to clean up
          }
          resolve({ url, ok: d[2], reason: d[3] || '' });
        }
      } catch {
        // non-JSON or unexpected relay frame — ignore it and keep listening
      }
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve({ url, ok: false, reason: 'ws error' });
    };
  });
}

function loadKey(pubkeyHex) {
  const envKey = `MIGRATE_NSEC_${pubkeyHex.slice(0, 8)}`;
  const raw = process.env[envKey];
  if (!raw) return null;
  let sk;
  if (raw.startsWith('nsec1')) sk = nip19.decode(raw).data;
  else sk = hexToBytes(raw);
  if (getPublicKey(sk) !== pubkeyHex)
    throw new Error(`${envKey} does not match pubkey ${pubkeyHex}`);
  return sk;
}

const isOldKonfi = (ev) =>
  (ev.tags || []).some((t) => typeof t[0] === 'string' && t[0].indexOf(OLD_PREFIX) === 0);

/** Any `ext:` tag at all — the real migration scope, see the note in main(). */
const isExtBearing = (ev) =>
  (ev.tags || []).some((t) => typeof t[0] === 'string' && t[0].startsWith('ext:'));

async function main() {
  console.log(`Konfi namespace migration — ${PUBLISH ? 'PUBLISH' : 'DRY RUN'}`);
  console.log(`  ${OLD_PREFIX}*  ->  ${NEW_PREFIX}*\n`);

  // Discover the migration set.
  //
  // SCOPE: select every ext-bearing event under `#l=ekw` — NOT only those
  // carrying old konfi keys. A konfi-keyed selector looks right and is wrong:
  // on the current corpus 8 of 25 ext-bearing events carry only bare scalars
  // (`ext:ekw:bibleReference`, `ext:ekw:methodOther`) and zero konfi keys. They
  // are already NIP-conformant; their problem is that the pre-fix relay dropped
  // 3-segment scalars from the index. Conversion runs at index time
  // (nostrlib typesense30142 replace.go), so the ONLY thing that re-indexes them
  // is a re-publish. Selecting by konfi-key presence skips them, and they stay
  // invisible after the migration is declared done.
  //
  // `#l=ekw` is a safe superset: a paginated scan of 8476 kind-30142 events
  // (2026-07-29) found 0 ext-bearing events lacking that label. `ext:*` keys are
  // multi-char and not REQ-filterable, but `l` is, so we filter server-side.
  const byId = new Map();
  for (const r of RELAYS) {
    const res = await query(r, { kinds: [30142], '#l': ['ekw'], limit: 500 });
    for (const ev of res.out) byId.set(ev.id, ev);
  }
  const old = [...byId.values()].filter(isExtBearing);
  const rewriteCount = old.filter(isOldKonfi).length;
  console.log(
    `Found ${old.length} ext-bearing event(s) under #l=ekw — ` +
      `${rewriteCount} to rewrite (${OLD_PREFIX}*), ` +
      `${old.length - rewriteCount} to re-sign unchanged (re-index only).\n`
  );

  const now = Math.floor(Date.now() / 1000);
  const byAuthor = new Map();
  for (const ev of old) {
    const { newTags, changed, notes } = transformEvent(ev);
    const dTag = (ev.tags.find((t) => t[0] === 'd') || [])[1] || '';
    const action = changed > 0 ? `${changed} konfi tags rewritten` : 're-sign only (re-index)';
    console.log(
      `• ${ev.id.slice(0, 12)}  d=${dTag.slice(0, 48)}  by ${ev.pubkey.slice(0, 8)}  (${action})`
    );
    for (const [i, tag] of ev.tags.entries()) {
      if (typeof tag[0] === 'string' && tag[0].indexOf(OLD_PREFIX) === 0) {
        const nt = newTags[i];
        console.log(`     ${tag[0]}  ->  ${nt[0]}`);
      }
    }
    for (const n of notes) console.log(`     ⚠️  ${n}`);
    if (!byAuthor.has(ev.pubkey)) byAuthor.set(ev.pubkey, []);
    byAuthor.get(ev.pubkey).push({ ev, newTags });
    console.log('');
  }

  console.log('=== Per-author summary ===');
  for (const [pub, items] of byAuthor) {
    const key = (() => {
      try {
        return loadKey(pub);
      } catch (e) {
        return e;
      }
    })();
    const keyState =
      key instanceof Error
        ? `KEY MISMATCH (${key.message})`
        : key
          ? 'key present'
          : `no key (set MIGRATE_NSEC_${pub.slice(0, 8)})`;
    console.log(`  ${pub}  — ${items.length} event(s) — ${keyState}`);
  }

  if (!PUBLISH) {
    console.log('\nDRY RUN complete. No events signed or published.');
    console.log(
      'To publish, supply MIGRATE_NSEC_<pubkey8> for each author and re-run with --publish.'
    );
    return;
  }

  console.log('\n=== PUBLISHING ===');
  for (const [pub, items] of byAuthor) {
    let sk;
    try {
      sk = loadKey(pub);
    } catch (e) {
      console.log(`  ${pub}: ${e.message} — SKIPPED`);
      continue;
    }
    if (!sk) {
      console.log(`  ${pub}: no key — SKIPPED (${items.length} events)`);
      continue;
    }
    for (const { ev, newTags } of items) {
      const unsigned = {
        kind: 30142,
        created_at: now,
        tags: newTags,
        content: ev.content,
        pubkey: pub
      };
      const signed = finalizeEvent(unsigned, sk);
      const results = await Promise.all(RELAYS.map((r) => publish(r, signed)));
      const okCount = results.filter((r) => r.ok).length;
      // Verify by REQ-ing the new event id back
      let seenBack = 0;
      for (const r of RELAYS) {
        const res = await query(r, { ids: [signed.id] }, 4000);
        if (res.out.length) seenBack++;
      }
      console.log(
        `  ${ev.id.slice(0, 12)} -> ${signed.id.slice(0, 12)}  published OK on ${okCount}/${RELAYS.length}, REQ-verified on ${seenBack}/${RELAYS.length}`
      );
    }
  }
  console.log('\nPUBLISH complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
