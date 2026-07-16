/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getResourceAttribution,
  creatorInitials,
  formatCreatorNames
} from '$lib/helpers/educational/resourceAttribution.js';

const PUBKEY = 'f0a28f62394c4fb487f1bc58fdd13c8ceaf96a2c878922cdb3ceab914c5d0744';
const OTHER_PUBKEY = '776c7bfe528c041cd1114efb6d48100b2e49d4faf27e301fb3f83c64a28694f4';

/** @param {string[][]} tags */
function makeEvent(tags, pubkey = PUBKEY) {
  return { kind: 30142, pubkey, created_at: 1784121175, tags };
}

describe('getResourceAttribution', () => {
  it('treats a resource without creators as own content', () => {
    const event = makeEvent([
      ['d', 'abc'],
      ['name', 'My resource']
    ]);
    const result = getResourceAttribution(event, null);
    expect(result.indexed).toBe(false);
    expect(result.creators).toEqual([]);
  });

  it('marks a resource with a metadata-only creator as indexed', () => {
    // Real-world shape: Colibri indexes an ÖRF journal article
    const event = makeEvent([
      ['d', 'https://oerf-journal.eu/index.php/oerf/article/view/605'],
      ['creator:name', 'Regina Polak'],
      ['creator:type', 'Person']
    ]);
    const result = getResourceAttribution(event, { name: 'Colibri' });
    expect(result.indexed).toBe(true);
    expect(result.creators).toEqual([{ name: 'Regina Polak', type: 'Person' }]);
  });

  it('returns all creators in tag order for multi-author resources', () => {
    // Real-world shape: RPI-Impulse article with an institute + two authors
    const event = makeEvent([
      ['d', 'https://www.rpi-ekkw-ekhn.de/some/article.pdf'],
      ['creator:name', 'Religionspädagogisches Institut von EKKW und EKHN'],
      ['creator:type', 'Person'],
      ['creator:name', 'Julia Gerth'],
      ['creator:type', 'Person'],
      ['creator:name', 'Nadine Hofmann-Driesch'],
      ['creator:type', 'Person']
    ]);
    const result = getResourceAttribution(event, { name: 'rpi-impulse' });
    expect(result.indexed).toBe(true);
    expect(result.creators.map((c) => c.name)).toEqual([
      'Religionspädagogisches Institut von EKKW und EKHN',
      'Julia Gerth',
      'Nadine Hofmann-Driesch'
    ]);
  });

  it('dedupes repeated creator runs and duplicate p-tags (real-world dirty events)', () => {
    // Real event shape (d=u5mfchck): the whole creator run was duplicated
    const event = makeEvent([
      ['creator:name', 'Corinna Link'],
      ['creator:type', 'Person'],
      ['creator:name', 'Corinna Link'],
      ['creator:type', 'Person'],
      ['creator:name', 'Second Author'],
      ['creator:type', 'Person'],
      ['p', OTHER_PUBKEY, '', 'creator'],
      ['p', OTHER_PUBKEY, '', 'creator']
    ]);
    const result = getResourceAttribution(event, null);
    expect(result.creators).toEqual([
      { name: 'Corinna Link', type: 'Person' },
      { name: 'Second Author', type: 'Person' },
      { pubkey: OTHER_PUBKEY }
    ]);
  });

  it('appends foreign p-tag creators after structured creators', () => {
    const event = makeEvent([
      ['creator:name', 'Regina Polak'],
      ['creator:type', 'Person'],
      ['p', OTHER_PUBKEY, '', 'creator']
    ]);
    const result = getResourceAttribution(event, null);
    expect(result.indexed).toBe(true);
    expect(result.creators).toEqual([
      { name: 'Regina Polak', type: 'Person' },
      { pubkey: OTHER_PUBKEY }
    ]);
  });

  it('treats content as own when a creator p-tag matches the event pubkey', () => {
    // Real-world shape: Colibri publishes her own slides — structured creator
    // "Corinna Link" (≠ profile name "Colibri") PLUS a self p-tag creator.
    const event = makeEvent([
      ['d', 'u5mfchck'],
      ['creator:name', 'Corinna Link'],
      ['creator:type', 'Person'],
      ['p', PUBKEY, 'wss://relay.damus.io', 'creator']
    ]);
    const result = getResourceAttribution(event, { name: 'Colibri' });
    expect(result.indexed).toBe(false);
  });

  it('treats content as own when the creator name matches the publisher profile name', () => {
    const event = makeEvent([
      ['creator:name', 'Religionspädagogisches Institut von EKKW und EKHN'],
      ['creator:type', 'Person']
    ]);
    const profile = { name: 'religionspädagogisches  institut von EKKW und EKHN' };
    expect(getResourceAttribution(event, profile).indexed).toBe(false);
  });

  it('matches the profile display_name as well', () => {
    const event = makeEvent([['creator:name', 'Jane Doe']]);
    expect(getResourceAttribution(event, { display_name: 'Jane Doe' }).indexed).toBe(false);
  });

  it('marks as indexed when a creator p-tag points to a different pubkey', () => {
    const event = makeEvent([['p', OTHER_PUBKEY, '', 'creator']]);
    const result = getResourceAttribution(event, null);
    expect(result.indexed).toBe(true);
    expect(result.creators).toEqual([{ pubkey: OTHER_PUBKEY }]);
  });

  it('ignores p-tags with non-creator markers for attribution', () => {
    const event = makeEvent([['p', OTHER_PUBKEY, '', 'mention']]);
    expect(getResourceAttribution(event, null).indexed).toBe(false);
  });

  it('ignores structured creators without a name', () => {
    const event = makeEvent([['creator:type', 'Person']]);
    expect(getResourceAttribution(event, null).indexed).toBe(false);
  });

  it('ignores invalid p-tag pubkeys', () => {
    const event = makeEvent([['p', 'nsec1notapubkey', '', 'creator']]);
    expect(getResourceAttribution(event, null).indexed).toBe(false);
  });

  it('extracts the source domain from a URL d-tag, stripping www.', () => {
    const event = makeEvent([
      ['d', 'https://www.rpi-ekkw-ekhn.de/fileadmin/some/file.pdf'],
      ['creator:name', 'Marina Schwabe']
    ]);
    expect(getResourceAttribution(event, null).sourceDomain).toBe('rpi-ekkw-ekhn.de');
  });

  it('returns null sourceDomain for non-URL d-tags', () => {
    const event = makeEvent([
      ['d', 'u5mfchck'],
      ['creator:name', 'X Y']
    ]);
    expect(getResourceAttribution(event, null).sourceDomain).toBeNull();
  });

  it('handles a null event gracefully', () => {
    const result = getResourceAttribution(null, null);
    expect(result).toEqual({ indexed: false, creators: [], sourceDomain: null });
  });
});

describe('formatCreatorNames', () => {
  it('joins up to two names with a comma', () => {
    expect(formatCreatorNames(['Julia Gerth'])).toBe('Julia Gerth');
    expect(formatCreatorNames(['Julia Gerth', 'Nadine Hofmann-Driesch'])).toBe(
      'Julia Gerth, Nadine Hofmann-Driesch'
    );
  });

  it('caps at two names and appends +N', () => {
    expect(formatCreatorNames(['A', 'B', 'C'])).toBe('A, B +1');
    expect(formatCreatorNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B +3');
  });

  it('skips empty names', () => {
    expect(formatCreatorNames(['A', '', 'B'])).toBe('A, B');
    expect(formatCreatorNames([])).toBe('');
  });
});

describe('creatorInitials', () => {
  it('takes the first letters of the first two words', () => {
    expect(creatorInitials('Regina Wildgruber')).toBe('RW');
  });

  it('handles single-word names', () => {
    expect(creatorInitials('Colibri')).toBe('C');
  });

  it('handles messy real-world creator strings', () => {
    // Real relay data: name field abused for title + email
    expect(
      creatorInitials('Marina Schwabe, Grundschullehrerin an der Friedrich-Ebert-Schule')
    ).toBe('MS');
  });

  it('falls back to ? for empty input', () => {
    expect(creatorInitials('')).toBe('?');
    expect(creatorInitials(undefined)).toBe('?');
  });
});
