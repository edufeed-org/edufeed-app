/** @vitest-environment node */
/**
 * Search and type filter for the items of a NIP-51 list (issue a0838dc9):
 * a lists page with many bookmarks needs a way to find one again.
 */
import { describe, it, expect } from 'vitest';
import {
  filterListItems,
  listItemTypes,
  buildListItemRows
} from '$lib/helpers/list-items-filter.js';

const rows = [
  { id: '1', typeKey: 'amb', text: 'Das Kirchenjahr Material joerglohrer' },
  { id: '2', typeKey: 'amb', text: 'Was ist gerecht? KPH Wien' },
  { id: '3', typeKey: 'article', text: 'Nostr and Open Educational Practices' }
];

describe('filterListItems', () => {
  it('matches every word of the query, case-insensitively, in title, description or author', () => {
    expect(filterListItems(rows, { query: 'kirchen JOERG', type: '' }).map((r) => r.id)).toEqual([
      '1'
    ]);
  });

  it('narrows to one type', () => {
    expect(filterListItems(rows, { query: '', type: 'article' }).map((r) => r.id)).toEqual(['3']);
  });

  it('returns the input itself when nothing filters', () => {
    expect(filterListItems(rows, { query: '  ', type: '' })).toBe(rows);
  });
});

describe('listItemTypes', () => {
  it('lists each type once, in order of first appearance', () => {
    expect(listItemTypes(rows)).toEqual(['amb', 'article']);
  });
});

describe('buildListItemRows', () => {
  it('makes title and author name searchable', () => {
    const article = {
      id: 'x',
      kind: 30023,
      pubkey: 'a'.repeat(64),
      created_at: 1,
      tags: [
        ['d', 'k'],
        ['title', 'Kirchenjahr']
      ],
      content: '',
      sig: ''
    };
    const [row] = buildListItemRows(
      [article],
      new Map([['a'.repeat(64), { name: 'joerglohrer' }]])
    );
    expect(row.typeKey).toBe('article');
    expect(row.text).toContain('Kirchenjahr');
    expect(row.text).toContain('joerglohrer');
  });
});
