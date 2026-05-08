/**
 * Reader helpers for AMB relation `a`-tags (hasPart / isPartOf).
 *
 * These exist so edit-mode prefill in the wizard can surface the relations
 * that were stored as `["a", coord, relay, marker]` tags by `ambToNostr`.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

import { getAMBHasPart, getAMBIsPartOf } from '$lib/helpers/educational/ambHelpers.js';

/**
 * @param {Array<Array<string>>} tags
 */
const evt = (tags) => ({ tags });

describe('getAMBHasPart / getAMBIsPartOf', () => {
  it('returns `hasPart` a-tags with coordinate/pubkey/dTag/relayHint', () => {
    const event = evt([
      ['d', 'course-1'],
      ['a', '30142:aa:video-1', 'wss://relay.example.com/', 'hasPart'],
      ['a', '30142:cc:slides-1', '', 'hasPart']
    ]);

    expect(getAMBHasPart(event)).toEqual([
      {
        coordinate: '30142:aa:video-1',
        pubkey: 'aa',
        dTag: 'video-1',
        relayHint: 'wss://relay.example.com/'
      },
      {
        coordinate: '30142:cc:slides-1',
        pubkey: 'cc',
        dTag: 'slides-1',
        relayHint: undefined
      }
    ]);
  });

  it('returns `isPartOf` a-tags and ignores unrelated markers', () => {
    const event = evt([
      ['a', '30142:bb:program-1', 'wss://relay.example.org/', 'isPartOf'],
      ['a', '30142:dd:unrelated', 'wss://relay.example.org/', 'isBasedOn'],
      ['a', '30023:ee:article-1', '', 'mentions']
    ]);

    expect(getAMBIsPartOf(event)).toEqual([
      {
        coordinate: '30142:bb:program-1',
        pubkey: 'bb',
        dTag: 'program-1',
        relayHint: 'wss://relay.example.org/'
      }
    ]);
  });

  it('returns an empty array when no matching a-tags exist', () => {
    expect(getAMBHasPart(evt([['d', 'course-1']]))).toEqual([]);
    expect(getAMBIsPartOf(evt([]))).toEqual([]);
    expect(getAMBHasPart(/** @type {any} */ ({}))).toEqual([]);
  });

  it('preserves full d-tag with colons when parsing a-tag (URL d-tag)', () => {
    const urlDTag = 'https://material.example.org/path/a:b/c/';
    const event = evt([['a', `30142:aa:${urlDTag}`, 'wss://relay.example.com/', 'hasPart']]);
    expect(getAMBHasPart(event)).toEqual([
      {
        coordinate: `30142:aa:${urlDTag}`,
        pubkey: 'aa',
        dTag: urlDTag,
        relayHint: 'wss://relay.example.com/'
      }
    ]);
  });

  it('skips malformed coordinates', () => {
    const event = evt([
      ['a', 'not-a-coordinate', '', 'hasPart'],
      ['a', '30142:', '', 'hasPart'],
      ['a', ':ff:missing-kind', '', 'hasPart']
    ]);
    expect(getAMBHasPart(event)).toEqual([]);
  });
});
