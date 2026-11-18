/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  CLAIM_KIND,
  buildClaimTemplate,
  parseClaim,
  claimStatus,
  acceptClaimTags
} from '$lib/helpers/attribution-claims.js';

const PUBLISHER = 'aa'.repeat(32);
const PAULA = 'bb'.repeat(32);
const PAULA_ID = `nostr:${nip19.npubEncode(PAULA)}`;

const content = (/** @type {string[][]} */ extra = []) => ({
  kind: 30142,
  pubkey: PUBLISHER,
  tags: [
    ['d', 'open-ist-eine-haltung'],
    ['creator:type', 'Person'],
    ['creator:name', 'Laura Mößle'],
    ['creator:type', 'Person'],
    ['creator:name', 'Paula Gregorio Rodrigo'],
    ['license:id', 'https://creativecommons.org/licenses/by/4.0/'],
    ...extra
  ]
});

const claimEvent = (overrides = {}) => ({
  ...buildClaimTemplate(content(), { role: 'creator', name: 'Paula Gregorio Rodrigo' }),
  pubkey: PAULA,
  ...overrides
});

describe('buildClaimTemplate / parseClaim', () => {
  it('builds a NIP-32 label that names content, publisher, role and credited name', () => {
    const t = buildClaimTemplate(content(), {
      role: 'creator',
      name: 'Paula Gregorio Rodrigo',
      relayHint: 'wss://relay.example'
    });
    expect(t.kind).toBe(CLAIM_KIND);
    expect(t.tags).toEqual([
      ['L', 'org.edufeed.attribution'],
      ['l', 'creator', 'org.edufeed.attribution'],
      ['a', `30142:${PUBLISHER}:open-ist-eine-haltung`, 'wss://relay.example'],
      ['p', PUBLISHER, 'wss://relay.example'],
      ['name', 'Paula Gregorio Rodrigo']
    ]);
  });

  it('round-trips through parseClaim', () => {
    expect(parseClaim(claimEvent())).toEqual({
      pubkey: PAULA,
      role: 'creator',
      address: `30142:${PUBLISHER}:open-ist-eine-haltung`,
      name: 'Paula Gregorio Rodrigo'
    });
  });

  it('rejects other labels, unknown roles and missing fields', () => {
    expect(parseClaim({ ...claimEvent(), kind: 1 })).toBeNull();
    expect(
      parseClaim({
        ...claimEvent(),
        tags: [
          ['L', 'other'],
          ['l', 'creator', 'other']
        ]
      })
    ).toBeNull();
    const t = claimEvent();
    expect(
      parseClaim({ ...t, tags: t.tags.map((x) => (x[0] === 'l' ? ['l', 'owner', x[2]] : x)) })
    ).toBeNull();
    expect(parseClaim({ ...t, tags: t.tags.filter((x) => x[0] !== 'name') })).toBeNull();
  });
});

describe('claimStatus', () => {
  const claim = /** @type {any} */ (parseClaim(claimEvent()));

  it('is open while the name is a name-only credit', () => {
    expect(claimStatus(claim, content())).toBe('open');
  });

  it('is accepted once the claimant has the p tag with that role', () => {
    expect(claimStatus(claim, content([['p', PAULA, '', 'creator']]))).toBe('accepted');
  });

  it('is outdated when the name is gone or belongs to someone else', () => {
    expect(claimStatus(claim, { ...content(), tags: [['d', 'x']] })).toBe('outdated');
    const other = `nostr:${nip19.npubEncode('cc'.repeat(32))}`;
    const taken = content();
    taken.tags.splice(5, 0, ['creator:id', other]);
    expect(claimStatus(claim, taken)).toBe('outdated');
  });

  it('is outdated for a claim on another event or by the wrong role', () => {
    expect(claimStatus({ ...claim, address: `30142:${PUBLISHER}:other` }, content())).toBe(
      'outdated'
    );
    expect(claimStatus({ ...claim, role: 'contributor' }, content())).toBe('outdated');
  });
});

describe('acceptClaimTags', () => {
  const claim = /** @type {any} */ (parseClaim(claimEvent()));

  it('adds the id to the claimed run and the companion p tag, keeps everything else', () => {
    const tags = acceptClaimTags(content().tags, claim, 'wss://relay.example');
    expect(tags).toEqual([
      ['d', 'open-ist-eine-haltung'],
      ['creator:type', 'Person'],
      ['creator:name', 'Laura Mößle'],
      ['creator:type', 'Person'],
      ['creator:name', 'Paula Gregorio Rodrigo'],
      ['creator:id', PAULA_ID],
      ['license:id', 'https://creativecommons.org/licenses/by/4.0/'],
      ['p', PAULA, 'wss://relay.example', 'creator']
    ]);
    expect(claimStatus(claim, { ...content(), tags })).toBe('accepted');
  });

  it('replaces an existing id of that run (one id per credit), not a neighbour’s', () => {
    const base = content().tags;
    base.splice(3, 0, ['creator:id', 'https://orcid.org/0000-0001-0000-0001']); // Laura's
    base.splice(6, 0, ['creator:id', 'https://orcid.org/0000-0002-0000-0002']); // Paula's
    const tags = /** @type {string[][]} */ (acceptClaimTags(base, claim, ''));
    expect(tags.filter((t) => t[0] === 'creator:id').map((t) => t[1])).toEqual([
      'https://orcid.org/0000-0001-0000-0001',
      PAULA_ID
    ]);
  });

  it('does not mutate its input and returns null when the claim is not open', () => {
    const base = content().tags;
    const copy = JSON.parse(JSON.stringify(base));
    acceptClaimTags(base, claim, '');
    expect(base).toEqual(copy);
    expect(acceptClaimTags([['d', 'x']], claim, '')).toBeNull();
  });
});
