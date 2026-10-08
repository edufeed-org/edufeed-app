/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getMessageAttachments, classifyAttachment } from '$lib/helpers/imeta.js';

const xdcTag = [
  'imeta',
  'url https://blossom.example/abc.xdc',
  'm application/x-webxdc',
  'x ' + 'a'.repeat(64),
  'image https://blossom.example/icon.png',
  'webxdc 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
];

describe('shared imeta parser', () => {
  it('parses the webxdc session property', () => {
    const [att] = getMessageAttachments({ tags: [xdcTag] });
    expect(att.url).toBe('https://blossom.example/abc.xdc');
    expect(att.type).toBe('application/x-webxdc');
    expect(att.sha256).toBe('a'.repeat(64));
    expect(att.image).toBe('https://blossom.example/icon.png');
    expect(att.webxdc).toBe('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
  });
  it('classifies x-webxdc as file', () => {
    expect(classifyAttachment({ type: 'application/x-webxdc' })).toBe('file');
  });
  it('is null-safe', () => {
    expect(getMessageAttachments(null)).toEqual([]);
  });
  // MessageAttachments keys its {#each} by att.url; a rumor repeating an
  // imeta tag (untrusted network input) must not crash every viewer with
  // each_key_duplicate. First occurrence wins.
  it('dedupes attachments sharing a url', () => {
    const tag = ['imeta', 'url https://blossom.example/a.png', 'm image/png'];
    const atts = getMessageAttachments({ tags: [tag, [...tag]] });
    expect(atts).toHaveLength(1);
    expect(atts[0].url).toBe('https://blossom.example/a.png');
  });
});

describe('buildImetaTag', () => {
  it('carries the original filename as `name`, so a pasted screenshot keeps it', async () => {
    const { buildImetaTag } = await import('$lib/helpers/imeta.js');
    expect(
      buildImetaTag({ url: 'https://blossom.example/abc.png', type: 'image/png', name: 'shot.png' })
    ).toEqual(['imeta', 'url https://blossom.example/abc.png', 'm image/png', 'name shot.png']);
  });

  it('writes the NIP-94 fields that are present, url first', async () => {
    const { buildImetaTag } = await import('$lib/helpers/imeta.js');
    expect(
      buildImetaTag({
        url: 'https://blossom.example/abc.jpg',
        type: 'image/jpeg',
        sha256: 'a'.repeat(64),
        size: 1234,
        dimensions: '640x480',
        alt: 'A cat'
      })
    ).toEqual([
      'imeta',
      'url https://blossom.example/abc.jpg',
      'm image/jpeg',
      'x ' + 'a'.repeat(64),
      'size 1234',
      'dim 640x480',
      'alt A cat'
    ]);
  });
  it('returns null without a url or without a second field (NIP-92 minimum)', async () => {
    const { buildImetaTag } = await import('$lib/helpers/imeta.js');
    expect(buildImetaTag({ type: 'image/png' })).toBeNull();
    expect(buildImetaTag({ url: 'https://blossom.example/abc.jpg' })).toBeNull();
  });
  it('round-trips through the parser', async () => {
    const { buildImetaTag } = await import('$lib/helpers/imeta.js');
    const tag = buildImetaTag({
      url: 'https://b.example/x.png',
      type: 'image/png',
      dimensions: '10x20'
    });
    const [att] = getMessageAttachments({ tags: [/** @type {string[]} */ (tag)] });
    expect(att).toMatchObject({
      url: 'https://b.example/x.png',
      type: 'image/png',
      dimensions: '10x20'
    });
  });
});

describe('collectImetaTags', () => {
  const uploaded = {
    url: 'https://blossom.example/new.png',
    type: 'image/png',
    sha256: 'b'.repeat(64),
    size: 10,
    dimensions: '100x50',
    alt: 'new.png'
  };
  const previous = ['imeta', 'url https://blossom.example/old.jpg', 'm image/jpeg', 'dim 1x1'];

  it('emits one tag per uploaded image still referenced in the content', async () => {
    const { collectImetaTags } = await import('$lib/helpers/imeta.js');
    const tags = collectImetaTags('Intro\n\n![new.png](https://blossom.example/new.png)\n', [
      uploaded
    ]);
    expect(tags).toEqual([
      [
        'imeta',
        'url https://blossom.example/new.png',
        'm image/png',
        'x ' + 'b'.repeat(64),
        'size 10',
        'dim 100x50',
        'alt new.png'
      ]
    ]);
  });
  it('skips uploads whose url the author removed from the text', async () => {
    const { collectImetaTags } = await import('$lib/helpers/imeta.js');
    expect(collectImetaTags('no images here', [uploaded])).toEqual([]);
  });
  it('carries over previous imeta tags while their url is still in the body, drops the rest', async () => {
    const { collectImetaTags } = await import('$lib/helpers/imeta.js');
    const kept = collectImetaTags(
      '![](https://blossom.example/old.jpg)',
      [],
      [previous, ['d', 'x']]
    );
    expect(kept).toEqual([previous]);
    expect(collectImetaTags('old image gone', [], [previous])).toEqual([]);
  });
  it('a fresh attachment replaces a carried-over tag for the same url, no duplicates', async () => {
    const { collectImetaTags } = await import('$lib/helpers/imeta.js');
    const fresh = {
      ...uploaded,
      url: 'https://blossom.example/old.jpg',
      type: 'image/jpeg',
      dimensions: '2x2'
    };
    const tags = collectImetaTags('![](https://blossom.example/old.jpg)', [fresh], [previous]);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('dim 2x2');
  });
});

describe('imetaByUrl', () => {
  it('maps raw urls to parsed attachments, first tag wins, null-safe', async () => {
    const { imetaByUrl } = await import('$lib/helpers/imeta.js');
    const map = imetaByUrl([
      ['title', 't'],
      ['imeta', 'url https://b.example/a.png', 'dim 3x4', 'alt first'],
      ['imeta', 'url https://b.example/a.png', 'alt second']
    ]);
    expect(map.get('https://b.example/a.png')).toMatchObject({ dimensions: '3x4', alt: 'first' });
    expect(imetaByUrl(undefined).size).toBe(0);
  });
});
