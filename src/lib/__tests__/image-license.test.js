/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildLicenseTemplate, getLicenseUrl } from '$lib/helpers/image-license.js';

const required = {
  hash: 'a'.repeat(64),
  url: 'https://blossom.example/aaaa.jpg',
  mime: 'image/jpeg',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  credit: 'Jane Doe'
};

describe('buildLicenseTemplate', () => {
  it('builds a kind 1063 template with all required tags', () => {
    const tpl = buildLicenseTemplate(required);
    expect(tpl.kind).toBe(1063);
    expect(tpl.content).toBe('');
    expect(tpl.tags).toEqual(
      expect.arrayContaining([
        ['url', required.url],
        ['x', required.hash],
        ['m', required.mime],
        ['license', required.license],
        ['credit', required.credit]
      ])
    );
  });

  it('omits optional tags when not supplied', () => {
    const tpl = buildLicenseTemplate(required);
    const keys = tpl.tags.map((t) => t[0]);
    expect(keys).not.toContain('size');
    expect(keys).not.toContain('dim');
    expect(keys).not.toContain('source');
    expect(keys).not.toContain('p');
    expect(keys).not.toContain('title');
  });

  it('emits a title tag when supplied', () => {
    const tpl = buildLicenseTemplate({ ...required, title: 'Mona Lisa' });
    expect(tpl.tags).toEqual(expect.arrayContaining([['title', 'Mona Lisa']]));
  });

  it('trims and omits an empty title', () => {
    const tpl = buildLicenseTemplate({ ...required, title: '   ' });
    expect(tpl.tags.map((t) => t[0])).not.toContain('title');
  });

  it('includes optional tags when supplied', () => {
    const tpl = buildLicenseTemplate({
      ...required,
      size: 12345,
      dim: '1920x1080',
      source: 'https://example.com/origin',
      creatorPubkey: 'b'.repeat(64),
      description: 'A test image'
    });
    expect(tpl.content).toBe('A test image');
    expect(tpl.tags).toEqual(
      expect.arrayContaining([
        ['size', '12345'],
        ['dim', '1920x1080'],
        ['source', 'https://example.com/origin'],
        ['p', 'b'.repeat(64)]
      ])
    );
  });

  it('throws when a required field is missing', () => {
    expect(() => buildLicenseTemplate({ ...required, hash: '' })).toThrow(/hash/);
    expect(() => buildLicenseTemplate({ ...required, license: '' })).toThrow(/license/);
    expect(() => buildLicenseTemplate({ ...required, credit: '' })).toThrow(/credit/);
  });
});

describe('buildLicenseTemplate NIP-DC extras', () => {
  const base = {
    hash: 'ab'.repeat(32),
    url: 'https://blossom/x.xdc',
    mime: 'application/x-webxdc',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    credit: 'Jane Doe'
  };

  it('emits alt and image tags when provided', () => {
    const t = buildLicenseTemplate({
      ...base,
      alt: 'Webxdc app: Quiz',
      image: 'https://blossom/icon.png'
    });
    expect(t.tags).toContainEqual(['alt', 'Webxdc app: Quiz']);
    expect(t.tags).toContainEqual(['image', 'https://blossom/icon.png']);
  });

  it('omits them when absent', () => {
    const t = buildLicenseTemplate(base);
    expect(t.tags.some(([n]) => n === 'alt' || n === 'image')).toBe(false);
  });
});

describe('getLicenseUrl', () => {
  const ev = (/** @type {string[][]} */ tags) => ({ tags, content: '' });

  it('returns the url tag value of a license event', () => {
    expect(getLicenseUrl(ev([['url', 'https://blossom.example/x.pdf']]))).toBe(
      'https://blossom.example/x.pdf'
    );
  });

  it('returns null when there is no url tag', () => {
    expect(getLicenseUrl(ev([['x', 'a'.repeat(64)]]))).toBeNull();
  });

  it('returns null for null/undefined/tagless input', () => {
    expect(getLicenseUrl(null)).toBeNull();
    expect(getLicenseUrl(undefined)).toBeNull();
    expect(getLicenseUrl({})).toBeNull();
  });
});
