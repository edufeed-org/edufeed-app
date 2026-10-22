// @ts-nocheck
/**
 * "Meine Uploads" helpers — pure functions over kind-1063 attestations.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { latestPerHash, blossomServersForLicense } from '$lib/helpers/my-uploads.js';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

function lic(id, hash, created_at, url = `https://blossom.example/${hash}.png`) {
  return {
    id,
    kind: 1063,
    pubkey: 'p'.repeat(64),
    created_at,
    content: '',
    tags: [
      ['url', url],
      ['x', hash],
      ['m', 'image/png'],
      ['license', 'https://creativecommons.org/licenses/by/4.0/'],
      ['credit', 'Jane']
    ]
  };
}

describe('latestPerHash', () => {
  it('keeps one entry per hash, the newest created_at', () => {
    const old = lic('1'.repeat(64), H1, 100);
    const newer = lic('2'.repeat(64), H1, 200);
    const other = lic('3'.repeat(64), H2, 150);
    const result = latestPerHash([old, newer, other]);
    expect(result.map((e) => e.id)).toEqual([newer.id, other.id]);
  });

  it('breaks created_at ties by ascending id, like useLicenseStatus', () => {
    const a = lic('1'.repeat(64), H1, 100);
    const b = lic('2'.repeat(64), H1, 100);
    expect(latestPerHash([b, a])[0].id).toBe(a.id);
  });

  it('sorts the result newest first and skips events without an x tag', () => {
    const noHash = { ...lic('4'.repeat(64), H1, 999), tags: [['url', 'https://x/y.png']] };
    const older = lic('5'.repeat(64), H2, 10);
    const newer = lic('6'.repeat(64), H1, 20);
    expect(latestPerHash([older, noHash, newer]).map((e) => e.id)).toEqual([newer.id, older.id]);
  });

  it('returns an empty list for empty/invalid input', () => {
    expect(latestPerHash([])).toEqual([]);
    expect(latestPerHash(null)).toEqual([]);
  });
});

describe('blossomServersForLicense', () => {
  it('returns the origin of every url tag that carries the blob hash', () => {
    const ev = lic('1'.repeat(64), H1, 1, `https://blossom.edufeed.org/${H1}.png`);
    ev.tags.push(['url', `https://cdn.example.org/${H1}`]);
    expect(blossomServersForLicense(ev, ['https://user.example'])).toEqual([
      'https://blossom.edufeed.org',
      'https://cdn.example.org'
    ]);
  });

  it('falls back to the given server list when no url carries the hash', () => {
    const ev = lic('1'.repeat(64), H1, 1, 'https://pics.example.org/some/path.png');
    expect(blossomServersForLicense(ev, ['https://user.example/', 'https://user.example'])).toEqual(
      ['https://user.example']
    );
  });

  it('dedupes servers by host', () => {
    const ev = lic('1'.repeat(64), H1, 1, `https://blossom.edufeed.org/${H1}.png`);
    ev.tags.push(['url', `HTTPS://blossom.edufeed.org:443/${H1}`]);
    expect(blossomServersForLicense(ev, [])).toEqual(['https://blossom.edufeed.org']);
  });
});
