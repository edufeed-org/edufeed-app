#!/usr/bin/env node
/**
 * Publish edufeed default form templates (kind 30168).
 * Depends on SCHEME_NADDR_SCHULFAECHER / SCHEME_NADDR_HCRT env vars
 * populated by running `publish:vocabs` first.
 */
import 'dotenv/config';
import { hexToBytes } from '@noble/hashes/utils';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { RelayPool } from 'applesauce-relay';

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function sign(template, skHex) {
  return finalizeEvent(
    { ...template, created_at: Math.floor(Date.now() / 1000) },
    hexToBytes(skHex)
  );
}

function naddrToCoord(naddr) {
  const { type, data } = nip19.decode(naddr);
  if (type !== 'naddr') throw new Error('expected naddr');
  return {
    address: `${data.kind}:${data.pubkey}:${data.identifier}`,
    relay: (data.relays || [])[0] || ''
  };
}

function buildAmbBasicForm({ schulfaecherNaddr, hcrtNaddr }) {
  const about = naddrToCoord(schulfaecherNaddr);
  const lrt = naddrToCoord(hcrtNaddr);

  const fields = [
    { id: 'name', type: 'text', label: 'Titel', required: true, output: 'amb:name' },
    {
      id: 'description',
      type: 'textarea',
      label: 'Beschreibung',
      required: true,
      output: 'amb:description'
    },
    {
      id: 'about',
      type: 'select',
      label: 'Fach',
      required: true,
      multiple: true,
      vocab: about,
      output: 'amb:about'
    },
    {
      id: 'learningResourceType',
      type: 'select',
      label: 'Ressourcentyp',
      required: true,
      vocab: lrt,
      output: 'amb:learningResourceType'
    },
    { id: 'inLanguage', type: 'text', label: 'Sprache (BCP47)', output: 'amb:inLanguage' },
    {
      id: 'license',
      type: 'text',
      label: 'Lizenz-URI',
      required: true,
      output: 'amb:license'
    }
  ];

  /** @type {string[][]} */
  const tags = [
    ['d', 'amb-basic'],
    ['name', 'AMB Basic (Edufeed default)'],
    [
      'description',
      'Minimale AMB-Ressource — Titel, Beschreibung, Fach, Ressourcentyp, Sprache, Lizenz.'
    ]
  ];

  for (const f of fields) {
    const options = {};
    if (f.required) options.required = true;
    if (f.multiple) options.multiple = true;
    tags.push(['field', f.id, f.type, f.label, '', JSON.stringify(options)]);
    if (f.vocab) tags.push(['field-vocab', f.id, 'a', f.vocab.address, f.vocab.relay]);
    if (f.output) tags.push(['field-output', f.id, f.output]);
  }

  return { kind: 30168, tags, content: '' };
}

async function publishAll(pool, relays, events) {
  for (const e of events) {
    await Promise.all(
      relays.map(
        (url) =>
          new Promise((resolve) => {
            pool
              .relay(url)
              .publish(e)
              .subscribe({
                next: () => resolve(),
                error: (err) => {
                  console.warn(`  ! publish to ${url} failed: ${err.message}`);
                  resolve();
                },
                complete: () => resolve()
              });
          })
      )
    );
  }
}

async function main() {
  const skHex = req('EDUFEED_PUBLISHER_NSEC');
  const relays = req('EDUFEED_PUBLISH_RELAYS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const pubkey = getPublicKey(hexToBytes(skHex));
  const pool = new RelayPool();

  const template = buildAmbBasicForm({
    schulfaecherNaddr: req('SCHEME_NADDR_SCHULFAECHER'),
    hcrtNaddr: req('SCHEME_NADDR_HCRT')
  });
  const signed = sign(template, skHex);

  console.log('publishing amb-basic to', relays.join(', '));
  await publishAll(pool, relays, [signed]);

  const naddr = nip19.naddrEncode({
    kind: 30168,
    pubkey,
    identifier: 'amb-basic',
    relays: relays.slice(0, 2)
  });
  console.log('form naddr:', naddr);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
