/**
 * bookmark-tag helper tests
 *
 * Verifies that the kind-agnostic bookmark tag operations:
 * - emit `a` tags for parameterized-replaceable kinds (e.g. 30142 AMB resources)
 * - emit `e` tags for non-replaceable kinds (e.g. kind 1 notes)
 * - support symmetric add/remove
 *
 * Underlying applesauce v6 ops (`addAddressPointerTag`, `addEventPointerTag`)
 * are async, single-argument tag operations: `(tags) => tags`.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { addAnyKindBookmarkTag, removeAnyKindBookmarkTag } from '../helpers/bookmark-tag.js';

const kind1Note = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 1,
  created_at: 1000,
  tags: [],
  content: 'hi',
  sig: 'c'.repeat(128)
};

const kind30142Resource = {
  id: 'd'.repeat(64),
  pubkey: 'e'.repeat(64),
  kind: 30142,
  created_at: 1001,
  tags: [['d', 'intro-math']],
  content: '',
  sig: 'f'.repeat(128)
};

const kind30023Article = {
  id: '1'.repeat(64),
  pubkey: '2'.repeat(64),
  kind: 30023,
  created_at: 1002,
  tags: [['d', 'my-article']],
  content: '',
  sig: '3'.repeat(128)
};

describe('addAnyKindBookmarkTag', () => {
  it('adds an `e` tag for a kind 1 note', async () => {
    const op = addAnyKindBookmarkTag(kind1Note);
    const result = await op([]);
    expect(result.some((/** @type {string[]} */ t) => t[0] === 'e' && t[1] === kind1Note.id)).toBe(
      true
    );
  });

  it('adds an `a` tag for a kind 30142 resource', async () => {
    const op = addAnyKindBookmarkTag(kind30142Resource);
    const result = await op([]);
    const aTag = result.find((/** @type {string[]} */ t) => t[0] === 'a');
    expect(aTag).toBeTruthy();
    expect(aTag?.[1]).toBe(`30142:${kind30142Resource.pubkey}:intro-math`);
  });

  it('adds an `a` tag for a kind 30023 article', async () => {
    const op = addAnyKindBookmarkTag(kind30023Article);
    const result = await op([]);
    const aTag = result.find((/** @type {string[]} */ t) => t[0] === 'a');
    expect(aTag).toBeTruthy();
    expect(aTag?.[1]).toBe(`30023:${kind30023Article.pubkey}:my-article`);
  });
});

describe('removeAnyKindBookmarkTag', () => {
  it('removes the `e` tag for a kind 1 note', async () => {
    const tags = [['e', kind1Note.id, '']];
    const op = removeAnyKindBookmarkTag(kind1Note);
    const result = await op(tags);
    expect(result.some((/** @type {string[]} */ t) => t[0] === 'e' && t[1] === kind1Note.id)).toBe(
      false
    );
  });

  it('removes the `a` tag for a kind 30142 resource', async () => {
    const tags = [['a', `30142:${kind30142Resource.pubkey}:intro-math`, '']];
    const op = removeAnyKindBookmarkTag(kind30142Resource);
    const result = await op(tags);
    expect(result.some((/** @type {string[]} */ t) => t[0] === 'a')).toBe(false);
  });

  it('add then remove returns to empty for a kind 30142 resource', async () => {
    const addOp = addAnyKindBookmarkTag(kind30142Resource);
    const removeOp = removeAnyKindBookmarkTag(kind30142Resource);
    const after = await removeOp(await addOp([]));
    expect(after.some((/** @type {string[]} */ t) => t[0] === 'a')).toBe(false);
  });
});
