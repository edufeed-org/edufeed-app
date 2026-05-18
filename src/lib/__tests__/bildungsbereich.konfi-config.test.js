/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

// Canonical key list published by Spec A — keep in sync with /api/config.
const SPEC_A_KEYS = [
  'konfiZielgruppen',
  'konfiLernformat',
  'konfiZeitstruktur',
  'konfiBeteiligte',
  'konfiThemen',
  'konfiDimensionen',
  'konfiMethode',
  'konfiMaterialaufwand',
  'konfiTechnikbedarf',
  'konfiLernorte',
  'landeskirchen'
];

const FAKE_PUBKEY = '0000000000000000000000000000000000000000000000000000000000000001';

/** Build a fake naddr per key so resolveVocabField succeeds. */
function fakeNaddr(/** @type {string} */ slug) {
  return nip19.naddrEncode({
    kind: 39737,
    pubkey: FAKE_PUBKEY,
    identifier: slug,
    relays: ['wss://relay.example']
  });
}

vi.mock('$lib/stores/config.svelte.js', () => {
  /** @type {Record<string, string>} */
  const schemeNaddrs = {};
  for (const k of SPEC_A_KEYS) schemeNaddrs[k] = fakeNaddr(k.toLowerCase());
  return {
    runtimeConfig: {
      educational: { schemeNaddrs }
    }
  };
});

describe('Konfi step4SubSteps ↔ Spec A schemeNaddrs', () => {
  let BILDUNGSBEREICHE;
  let resolveVocabField;

  beforeEach(async () => {
    ({ BILDUNGSBEREICHE } = await import('$lib/helpers/educational/bildungsbereich.js'));
    ({ resolveVocabField } = await import('$lib/helpers/educational/vocabResolver.js'));
  });

  it('every Konfi vocab schemeKey resolves to a non-null vocab field', () => {
    const missing = [];
    for (const step of BILDUNGSBEREICHE.konfi.step4SubSteps ?? []) {
      for (const f of step.fields) {
        if (f.kind !== 'vocab') continue;
        const resolved = resolveVocabField(f.schemeKey);
        if (!resolved) missing.push(f.schemeKey);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every Konfi schemeKey is one of the canonical Spec A keys', () => {
    const used = new Set();
    for (const step of BILDUNGSBEREICHE.konfi.step4SubSteps ?? []) {
      for (const f of step.fields) {
        if (f.kind === 'vocab') used.add(f.schemeKey);
      }
    }
    const unknown = [...used].filter((k) => !SPEC_A_KEYS.includes(k));
    expect(unknown).toEqual([]);
  });
});
