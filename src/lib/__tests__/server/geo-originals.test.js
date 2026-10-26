/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
  parseOriginalTemplates,
  originalCandidate,
  createOriginalChecker,
  resolveMirror
} from '$lib/server/geo/originals.js';

const FOERBICO = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

/** @param {number} kind @param {string} pubkey @param {string} d */
const ev = (kind, pubkey, d) => ({ kind, pubkey, tags: [['d', d]], content: '' });

describe('parseOriginalTemplates', () => {
  it('maps pubkeys (npub or hex) to URL templates with {d}', () => {
    const map = parseOriginalTemplates(
      `${nip19.npubEncode(FOERBICO)}=https://oer.community/{d}/, ${OTHER}=https://blog.example/{d}`
    );
    expect(map.get(FOERBICO)).toBe('https://oer.community/{d}/');
    expect(map.get(OTHER)).toBe('https://blog.example/{d}');
  });

  it('ignores malformed entries', () => {
    const map = parseOriginalTemplates(
      'junk, npub1x=https://a/{d}, ' + `${OTHER}=ftp://x/{d}, ${OTHER}`
    );
    expect(map.size).toBe(0);
    expect(parseOriginalTemplates(undefined).size).toBe(0);
  });
});

describe('originalCandidate', () => {
  const templates = parseOriginalTemplates(`${FOERBICO}=https://oer.community/{d}/`);

  it('treats an external URL d-tag of a learning resource as its original', () => {
    expect(originalCandidate(ev(30142, OTHER, 'https://rpi.example/m1.pdf'), templates)).toEqual({
      url: 'https://rpi.example/m1.pdf',
      verify: false
    });
  });

  it('has no original for a native learning resource', () => {
    expect(originalCandidate(ev(30142, OTHER, 'my-own-resource'), templates)).toBeNull();
  });

  it('applies the author template to learning resources with a slug d-tag', () => {
    expect(originalCandidate(ev(30142, FOERBICO, 'junia'), templates)).toEqual({
      url: 'https://oer.community/junia/',
      verify: true
    });
  });

  it('accepts multi-segment paths', () => {
    expect(originalCandidate(ev(30023, FOERBICO, 'en/our-team'), templates)).toEqual({
      url: 'https://oer.community/en/our-team/',
      verify: true
    });
  });

  it('builds the original of an article from the author template, keeping the d-tag as-is', () => {
    expect(
      originalCandidate(
        ev(30023, FOERBICO, 'offenheit-ist-kein-gegensatz-zu-qualit%C3%A4t'),
        templates
      )
    ).toEqual({
      url: 'https://oer.community/offenheit-ist-kein-gegensatz-zu-qualit%C3%A4t/',
      verify: true
    });
  });

  it('has no original for authors without a template', () => {
    expect(originalCandidate(ev(30023, OTHER, 'x'), templates)).toBeNull();
  });

  it('refuses d-tags that would break out of the path', () => {
    expect(originalCandidate(ev(30023, FOERBICO, '../evil'), templates)).toBeNull();
    expect(originalCandidate(ev(30023, FOERBICO, 'a/../../b'), templates)).toBeNull();
    expect(originalCandidate(ev(30023, FOERBICO, '/abs'), templates)).toBeNull();
    expect(originalCandidate(ev(30023, FOERBICO, 'a//b'), templates)).toBeNull();
    expect(originalCandidate(ev(30023, FOERBICO, 'x?y'), templates)).toBeNull();
    expect(originalCandidate(ev(30023, FOERBICO, 'nostr:kanban:abc'), templates)).toBeNull();
    expect(originalCandidate(ev(30023, FOERBICO, ''), templates)).toBeNull();
  });
});

describe('originalCandidate — source tag', () => {
  const templates = parseOriginalTemplates(`${FOERBICO}=https://oer.community/{d}/`);
  /** @param {number} kind @param {string} pubkey @param {string[][]} tags */
  const tagged = (kind, pubkey, tags) => ({
    kind,
    pubkey,
    tags: [['d', 'slug'], ...tags],
    content: ''
  });

  it('prefers ["source", url] over templates and needs no existence check', () => {
    expect(
      originalCandidate(
        tagged(30023, FOERBICO, [['source', 'https://oer.community/real-path/']]),
        templates
      )
    ).toEqual({ url: 'https://oer.community/real-path/', verify: false });
  });

  it('works for authors without a template and for wiki entries', () => {
    expect(
      originalCandidate(tagged(30818, OTHER, [['source', 'https://blog.example/post']]), templates)
    ).toEqual({ url: 'https://blog.example/post', verify: false });
  });

  it('ignores r tags and non-http sources', () => {
    expect(
      originalCandidate(tagged(30023, OTHER, [['r', 'https://a.example/']]), templates)
    ).toBeNull();
    expect(
      originalCandidate(tagged(30023, OTHER, [['source', 'javascript:x']]), templates)
    ).toBeNull();
    expect(originalCandidate(tagged(30023, OTHER, [['source', '']]), templates)).toBeNull();
  });
});

describe('createOriginalChecker', () => {
  it('maps HTTP status to exists / missing / unknown and caches answers', async () => {
    const statuses = /** @type {Record<string, number>} */ ({
      'https://x/a': 200,
      'https://x/b': 404,
      'https://x/c': 503
    });
    const head = vi.fn(async (/** @type {string} */ url) => statuses[url]);
    const checker = createOriginalChecker({ head, ttlMs: 1000 });
    expect(await checker.exists('https://x/a')).toBe(true);
    expect(await checker.exists('https://x/b')).toBe(false);
    expect(await checker.exists('https://x/c')).toBeNull();
    await checker.exists('https://x/a');
    expect(head).toHaveBeenCalledTimes(3);
  });

  it('treats network errors as unknown and does not cache them', async () => {
    const head = vi.fn(async () => {
      throw new Error('timeout');
    });
    const checker = createOriginalChecker({ head, ttlMs: 1000 });
    expect(await checker.exists('https://x/a')).toBeNull();
    await checker.exists('https://x/a');
    expect(head).toHaveBeenCalledTimes(2);
  });
});

describe('resolveMirror', () => {
  const templates = parseOriginalTemplates(`${FOERBICO}=https://oer.community/{d}/`);

  it('returns the original URL for mirrors, null for edufeed originals, undefined when unknown', async () => {
    const checker = {
      exists: vi.fn(async (/** @type {string} */ u) =>
        u.includes('gone') ? false : u.includes('slow') ? null : true
      )
    };
    expect(await resolveMirror(ev(30023, FOERBICO, 'here'), templates, checker)).toBe(
      'https://oer.community/here/'
    );
    expect(await resolveMirror(ev(30023, FOERBICO, 'gone'), templates, checker)).toBeNull();
    expect(await resolveMirror(ev(30023, FOERBICO, 'slow'), templates, checker)).toBeUndefined();
    expect(await resolveMirror(ev(30023, OTHER, 'x'), templates, checker)).toBeNull();
    // learning resources with an external URL are mirrors without a network check
    expect(
      await resolveMirror(ev(30142, OTHER, 'https://rpi.example/m1.pdf'), templates, checker)
    ).toBe('https://rpi.example/m1.pdf');
    expect(checker.exists).toHaveBeenCalledTimes(3);
  });
});
