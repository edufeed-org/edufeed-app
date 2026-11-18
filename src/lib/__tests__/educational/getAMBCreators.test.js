/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  getAMBCreators,
  getAMBContributors,
  getRunPubkeys
} from '$lib/helpers/educational/ambHelpers.js';

/** @param {string[][]} tags */
const ev = (tags) => ({ kind: 30142, tags, content: '', pubkey: 'pk' });

describe('getAMBCreators', () => {
  it('parses a single creator with all fields', () => {
    const event = ev([
      ['d', 'r1'],
      ['creator:type', 'Person'],
      ['creator:name', 'Ada Lovelace'],
      ['creator:honorificPrefix', 'Dr.'],
      ['creator:affiliation:name', 'Analytical Engines Inc.'],
      ['creator:id', 'https://orcid.org/0000-0002-1825-0097']
    ]);
    expect(getAMBCreators(event)).toEqual([
      {
        type: 'Person',
        name: 'Ada Lovelace',
        honorificPrefix: 'Dr.',
        affiliationName: 'Analytical Engines Inc.',
        id: 'https://orcid.org/0000-0002-1825-0097'
      }
    ]);
  });

  it('splits consecutive runs into separate creators (heterogeneous optional fields)', () => {
    // creator 1 has no ORCID, creator 2 does — positional grouping by key
    // would misattribute the single creator:id to creator 1; run-based
    // grouping must not.
    const event = ev([
      ['creator:type', 'Person'],
      ['creator:name', 'No Orcid'],
      ['creator:type', 'Person'],
      ['creator:name', 'Has Orcid'],
      ['creator:id', 'https://orcid.org/0000-0002-1694-233X']
    ]);
    expect(getAMBCreators(event)).toEqual([
      { type: 'Person', name: 'No Orcid' },
      { type: 'Person', name: 'Has Orcid', id: 'https://orcid.org/0000-0002-1694-233X' }
    ]);
  });

  it('starts a new creator when a field repeats even without type tag', () => {
    const event = ev([
      ['creator:name', 'One'],
      ['creator:name', 'Two']
    ]);
    expect(getAMBCreators(event)).toEqual([{ name: 'One' }, { name: 'Two' }]);
  });

  it('returns [] when there are no creator tags', () => {
    expect(getAMBCreators(ev([['d', 'r1']]))).toEqual([]);
    expect(getAMBCreators({})).toEqual([]);
  });

  it('defaults missing type to undefined and ignores unknown creator subkeys gracefully', () => {
    const event = ev([
      ['creator:name', 'X'],
      ['creator:somefuture:key', 'val']
    ]);
    expect(getAMBCreators(event)).toEqual([{ name: 'X' }]);
  });
});

describe('getAMBContributors', () => {
  it('parses contributor:* runs and ignores creator:* runs', () => {
    const event = ev([
      ['creator:type', 'Person'],
      ['creator:name', 'Ada Lovelace'],
      ['contributor:type', 'Person'],
      ['contributor:name', 'Charles Babbage'],
      ['contributor:affiliation:name', 'Analytical Engines Inc.'],
      ['contributor:type', 'Organization'],
      ['contributor:name', 'Royal Society']
    ]);
    expect(getAMBContributors(event)).toEqual([
      { type: 'Person', name: 'Charles Babbage', affiliationName: 'Analytical Engines Inc.' },
      { type: 'Organization', name: 'Royal Society' }
    ]);
    expect(getAMBCreators(event)).toEqual([{ type: 'Person', name: 'Ada Lovelace' }]);
  });

  it('returns [] when there are no contributor tags', () => {
    expect(getAMBContributors(ev([['creator:name', 'Solo']]))).toEqual([]);
  });
});

// NIP-AMB: a run whose id is a nostr: URI is the credit record of a person
// with a Nostr identity; the p tag of that pubkey and role is its companion.
describe('runs with a Nostr identity', () => {
  const JANE = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const npub = nip19.npubEncode(JANE);

  it('sets the pubkey of a named run whose id is a nostr:npub URI', () => {
    const event = ev([
      ['creator:id', `nostr:${npub}`],
      ['creator:name', 'Jane Roe'],
      ['creator:type', 'Person'],
      ['p', JANE, 'wss://relay.example.com', 'creator']
    ]);
    expect(getAMBCreators(event)).toEqual([
      { id: `nostr:${npub}`, name: 'Jane Roe', type: 'Person', pubkey: JANE }
    ]);
  });

  it('decodes an nprofile id too', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: JANE, relays: ['wss://r.example'] });
    const event = ev([
      ['contributor:name', 'Jane Roe'],
      ['contributor:id', `nostr:${nprofile}`]
    ]);
    expect(getAMBContributors(event)[0].pubkey).toBe(JANE);
  });

  it('sets no pubkey for other ids, undecodable nostr: ids or a run without a name', () => {
    const event = ev([
      ['creator:name', 'A'],
      ['creator:id', 'https://orcid.org/0000-0002-1825-0097'],
      ['creator:name', 'B'],
      ['creator:id', 'nostr:npub1garbage'],
      ['creator:type', 'Person'],
      ['creator:id', `nostr:${npub}`]
    ]);
    expect(getAMBCreators(event).map((c) => c.pubkey)).toEqual([undefined, undefined, undefined]);
  });

  it('getRunPubkeys returns the pubkeys the runs of one prefix carry', () => {
    const event = ev([
      ['creator:name', 'Jane Roe'],
      ['creator:id', `nostr:${npub}`],
      ['creator:name', 'No Nostr'],
      ['p', 'b'.repeat(64), '', 'contributor']
    ]);
    expect([...getRunPubkeys(event, 'creator')]).toEqual([JANE]);
    expect(getRunPubkeys(event, 'contributor').size).toBe(0);
  });
});
