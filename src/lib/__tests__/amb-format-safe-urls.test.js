/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formatAMBResource } from '$lib/helpers/educational/ambHelpers.js';

// Display links come from untrusted tags: only http(s) may reach an href.
describe('formatAMBResource link safety', () => {
  const event = {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 30142,
    content: '',
    tags: [
      ['d', 'x'],
      ['name', 'X'],
      ['encoding:contentUrl', 'javascript:alert(1)//x.pdf'],
      ['encoding:encodingFormat', 'application/pdf'],
      ['encoding:contentUrl', 'https://files.example.org/ok.pdf'],
      ['encoding:encodingFormat', 'text/plain'],
      ['r', 'javascript:alert(2)'],
      ['r', 'https://example.org/ref']
    ]
  };

  /** @type {any} */
  const format = (/** @type {any} */ e) => formatAMBResource(e);

  it('keeps only http(s) encodings, with their own metadata', () => {
    const { encodings } = format(event);
    expect(encodings.map((/** @type {any} */ e) => e.url)).toEqual([
      'https://files.example.org/ok.pdf'
    ]);
    expect(encodings[0].mimeType).toBe('text/plain');
  });

  it('keeps only http(s) external references', () => {
    expect(format(event).externalUrls).toEqual(['https://example.org/ref']);
  });
});
