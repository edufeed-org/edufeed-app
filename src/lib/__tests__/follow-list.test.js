/**
 * Pure logic behind the follower / following list: sort key, initial
 * letter, search matching and the A-Z index.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  RAIL_LETTERS,
  foldText,
  profileName,
  initialOf,
  buildFollowListEntries,
  queryWords,
  matchesQuery,
  letterIndex
} from '$lib/helpers/follow-list.js';

const pk = (/** @type {number} */ i) => i.toString(16).padStart(64, '0');
const npubOf = (/** @type {string} */ hex) => `npub1${hex.slice(-6)}`;

describe('foldText', () => {
  it('lowercases and strips diacritics', () => {
    expect(foldText('Ärger Über ÖL Café')).toBe('arger uber ol cafe');
  });
  it('tolerates missing input', () => {
    expect(foldText(undefined)).toBe('');
    expect(foldText(null)).toBe('');
  });
});

describe('profileName', () => {
  it('prefers display_name, then displayName, then name, trimmed', () => {
    expect(profileName({ display_name: ' Anna ', name: 'anna' })).toBe('Anna');
    expect(profileName({ displayName: 'Ben', name: 'ben' })).toBe('Ben');
    expect(profileName({ name: 'carl' })).toBe('carl');
    expect(profileName({ display_name: '  ', name: 'dora' })).toBe('dora');
  });
  it('is empty without a usable name', () => {
    expect(profileName(undefined)).toBe('');
    expect(profileName({ display_name: 42 })).toBe('');
  });
});

describe('initialOf', () => {
  it('groups by base letter, umlauts included', () => {
    expect(initialOf('anna')).toBe('A');
    expect(initialOf('Ärger')).toBe('A');
    expect(initialOf('Öztürk')).toBe('O');
    expect(initialOf('überall')).toBe('U');
    expect(initialOf('  zoe')).toBe('Z');
  });
  it('puts everything else under #', () => {
    expect(initialOf('42 Leute')).toBe('#');
    expect(initialOf('🌻 Sonne')).toBe('#');
    expect(initialOf('')).toBe('#');
    expect(initialOf('ßeta')).toBe('#');
  });
});

describe('RAIL_LETTERS', () => {
  it('is A-Z then #', () => {
    expect(RAIL_LETTERS).toHaveLength(27);
    expect(RAIL_LETTERS[0]).toBe('A');
    expect(RAIL_LETTERS[25]).toBe('Z');
    expect(RAIL_LETTERS[26]).toBe('#');
  });
});

describe('buildFollowListEntries', () => {
  it('sorts by name, locale-aware and case-insensitive; umlauts with their base letter', () => {
    const profiles = new Map([
      [pk(1), { name: 'zoe' }],
      [pk(2), { display_name: 'Ärger' }],
      [pk(3), { name: 'anton' }],
      [pk(4), { name: 'Bernd' }],
      [pk(5), { name: 'berta' }]
    ]);
    const entries = buildFollowListEntries([pk(1), pk(2), pk(3), pk(4), pk(5)], profiles, npubOf);
    expect(entries.map((e) => e.name)).toEqual(['anton', 'Ärger', 'Bernd', 'berta', 'zoe']);
    expect(entries.map((e) => e.initial)).toEqual(['A', 'A', 'B', 'B', 'Z']);
  });

  it('puts non-letter names, then nameless people (by npub) last, all under #', () => {
    const profiles = new Map([
      [pk(1), { name: '42er' }],
      [pk(2), { name: 'Mia' }]
    ]);
    const entries = buildFollowListEntries([pk(9), pk(3), pk(1), pk(2)], profiles, (hex) =>
      hex === pk(9) ? 'npub1aaa' : 'npub1zzz'
    );
    expect(entries.map((e) => e.pubkey)).toEqual([pk(2), pk(1), pk(9), pk(3)]);
    expect(entries.map((e) => e.initial)).toEqual(['M', '#', '#', '#']);
  });

  it('builds a folded search text from display name, name, NIP-05 and npub', () => {
    const profiles = new Map([
      [pk(1), { display_name: 'Jörg Müller', name: 'joerg', nip05: 'jm@Edufeed.org' }]
    ]);
    const [entry] = buildFollowListEntries([pk(1)], profiles, npubOf);
    expect(entry.search).toContain('jorg muller');
    expect(entry.search).toContain('joerg');
    expect(entry.search).toContain('jm@edufeed.org');
    expect(entry.search).toContain(npubOf(pk(1)));
  });

  it('dedupes repeated pubkeys', () => {
    const entries = buildFollowListEntries([pk(1), pk(1)], new Map(), npubOf);
    expect(entries).toHaveLength(1);
  });
});

describe('queryWords / matchesQuery', () => {
  const [entry] = buildFollowListEntries(
    [pk(1)],
    new Map([[pk(1), { display_name: 'Jörg Müller', nip05: 'jm@edufeed.org' }]]),
    npubOf
  );

  it('splits the query into folded words', () => {
    expect(queryWords('  Jörg   MÜL ')).toEqual(['jorg', 'mul']);
    expect(queryWords('')).toEqual([]);
  });

  it('needs every word to match, ignoring case and diacritics', () => {
    expect(matchesQuery(entry, queryWords('jorg'))).toBe(true);
    expect(matchesQuery(entry, queryWords('MÜLLER jörg'))).toBe(true);
    expect(matchesQuery(entry, queryWords('edufeed.org'))).toBe(true);
    expect(matchesQuery(entry, queryWords(npubOf(pk(1))))).toBe(true);
    expect(matchesQuery(entry, queryWords('jorg schmidt'))).toBe(false);
  });

  it('matches everyone for an empty query', () => {
    expect(matchesQuery(entry, [])).toBe(true);
  });
});

describe('letterIndex', () => {
  it('maps each initial to the position of its first entry', () => {
    const index = letterIndex([
      { initial: 'A' },
      { initial: 'A' },
      { initial: 'C' },
      { initial: '#' }
    ]);
    expect(index.get('A')).toBe(0);
    expect(index.get('C')).toBe(2);
    expect(index.get('#')).toBe(3);
    expect(index.has('B')).toBe(false);
  });
});
