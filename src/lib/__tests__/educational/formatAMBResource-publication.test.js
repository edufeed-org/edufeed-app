/**
 * Scientific publications (kind 30040, NKBIP-01) share the discover
 * "Lernen" tab with AMB resources, so formatAMBResource must read their
 * `title` / `summary` / `published_on` / `author` tags.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { formatAMBResource } from '$lib/helpers/educational/ambHelpers.js';

const publication = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 30040,
  created_at: 1_700_000_000,
  content: '',
  sig: '',
  tags: [
    ['d', 'pub-1'],
    ['title', 'Die Materialität analog-digitaler Schnittstellen'],
    ['summary', 'Usability-Testung stiftbasierter Eingabegeräte'],
    ['published_on', '2023-01-01'],
    ['author', 'Nadine Hahm'],
    ['author', 'Andreas Thor']
  ]
};

describe('formatAMBResource with a kind 30040 publication', () => {
  const resource = /** @type {any} */ (formatAMBResource(publication));

  it('reads title and summary', () => {
    expect(resource.name).toBe('Die Materialität analog-digitaler Schnittstellen');
    expect(resource.description).toBe('Usability-Testung stiftbasierter Eingabegeräte');
  });

  it('reads published_on as the published date', () => {
    expect(resource.publishedDate).toBe(new Date('2023-01-01').getTime() / 1000);
  });

  it('falls back to NKBIP-01 author tags for creator names', () => {
    expect(resource.creatorNames).toEqual(['Nadine Hahm', 'Andreas Thor']);
  });

  it('keeps the kind so the card can badge it', () => {
    expect(resource.kind).toBe(30040);
  });
});

describe('getAMBPublishedDate with German-format and broken dates', () => {
  /** @param {string} value */
  const withDate = (value) =>
    /** @type {any} */ (
      formatAMBResource({
        ...publication,
        tags: [
          ['d', 'x'],
          ['published_on', value]
        ]
      })
    );

  it('reads DD.MM.YYYY as day.month.year', () => {
    expect(withDate('04.07.1776').publishedDate).toBe(Date.UTC(1776, 6, 4) / 1000);
  });

  it('falls back to created_at when the date cannot be parsed', () => {
    expect(withDate('irgendwann').publishedDate).toBe(publication.created_at);
  });
});
