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
