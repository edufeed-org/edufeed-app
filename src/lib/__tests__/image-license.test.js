/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildLicenseTemplate } from '$lib/helpers/image-license.js';

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
