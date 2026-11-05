/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { groupPublicationChapters } from '$lib/helpers/publication-tree.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** @param {string} d @param {string[][]} [tags] @param {string} [pubkey] @param {number} [at] */
function pub(d, tags = [], pubkey = A, at = 100) {
  return {
    id: `${pubkey.slice(0, 4)}-${d}`.padEnd(64, '0'),
    kind: 30040,
    pubkey,
    created_at: at,
    content: '',
    tags: [['d', d], ['title', d], ...tags]
  };
}
const ref = (/** @type {string} */ d, pubkey = A) => ['a', `30040:${pubkey}:${d}`];

describe('groupPublicationChapters', () => {
  it('lists unrelated publications as they are, in input order', () => {
    const list = [pub('x'), pub('y')];
    expect(
      groupPublicationChapters(list).map((e) => [e.event.tags[0][1], e.chapters.length])
    ).toEqual([
      ['x', 0],
      ['y', 0]
    ]);
  });

  // NKBIP-01: an index references its sections (sub-indexes) by `a` tag.
  it('nests chapters under the book in the book’s a-tag order', () => {
    const book = pub('book', [ref('ch2'), ref('ch1')]);
    const list = [pub('ch1'), book, pub('ch2')];
    const grouped = groupPublicationChapters(list);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].event).toBe(book);
    expect(grouped[0].chapters.map((c) => c.tags[0][1])).toEqual(['ch2', 'ch1']);
  });

  it('ignores references to another author’s publication', () => {
    const book = pub('book', [ref('ch1', B)]);
    const foreign = pub('ch1', [], B);
    const grouped = groupPublicationChapters([book, foreign]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].chapters).toEqual([]);
  });

  it('keeps a chapter whose book is not loaded at top level', () => {
    expect(groupPublicationChapters([pub('ch1')])).toHaveLength(1);
  });

  it('shows a nested chapter only under its direct parent', () => {
    // book → part → section: the part sits under the book, the section under the part
    const book = pub('book', [ref('part')]);
    const part = pub('part', [ref('section')]);
    const section = pub('section');
    const grouped = groupPublicationChapters([book, part, section]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].chapters).toEqual([part]);
  });

  it('survives cycles and self-references without dropping everything', () => {
    const x = pub('x', [ref('y'), ref('x')]);
    const y = pub('y', [ref('x')]);
    const grouped = groupPublicationChapters([x, y]);
    // every event is still reachable from the top level
    const shown = grouped.flatMap((e) => [e.event, ...e.chapters]);
    expect(new Set(shown.map((e) => e.id))).toEqual(new Set([x.id, y.id]));
    expect(grouped.length).toBeGreaterThan(0);
    for (const e of grouped) expect(e.chapters).not.toContain(e.event);
  });

  it('lists a chapter referenced twice only once', () => {
    const book = pub('book', [ref('ch1'), ref('ch1')]);
    const grouped = groupPublicationChapters([book, pub('ch1')]);
    expect(grouped[0].chapters).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(groupPublicationChapters([])).toEqual([]);
    expect(groupPublicationChapters(null)).toEqual([]);
  });
});
