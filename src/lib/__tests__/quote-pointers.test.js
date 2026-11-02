/**
 * The q tags of a quoting event carry what an inline `note1…` reference
 * lacks: a relay hint and the quoted author (`["q", id, relay, pubkey]`,
 * NIP-18). Without the author the outbox fallback cannot run.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { quotePointersOf, withQuoteHint } from '$lib/helpers/quote-pointers.js';

const ID = 'd'.repeat(64);
const AUTHOR = 'a'.repeat(64);

describe('quotePointersOf', () => {
  it('maps quoted ids to their relay hint and author', () => {
    const event = {
      tags: [
        ['q', ID, 'wss://premium.primal.net/', AUTHOR],
        ['p', AUTHOR],
        ['q', '30023:' + AUTHOR + ':post'], // address quote: not an id
        ['q', 'not-hex']
      ]
    };
    const map = quotePointersOf(event);
    expect([...map.keys()]).toEqual([ID]);
    expect(map.get(ID)).toEqual({ id: ID, relays: ['wss://premium.primal.net/'], author: AUTHOR });
  });

  it('is empty for an event without q tags or no event', () => {
    expect(quotePointersOf({ tags: [] }).size).toBe(0);
    expect(quotePointersOf(null).size).toBe(0);
  });
});

describe('withQuoteHint', () => {
  const hint = { id: ID, relays: ['wss://q.example/'], author: AUTHOR };

  it('turns a note reference into an nevent with the q-tag hint and author', () => {
    expect(
      withQuoteHint({ success: true, type: 'note', data: ID, identifier: 'note1x' }, hint)
    ).toEqual({
      success: true,
      type: 'nevent',
      data: { id: ID, relays: ['wss://q.example/'], author: AUTHOR },
      identifier: 'note1x'
    });
  });

  it('adds the q-tag relay and author to an nevent that lacks them, keeping its own first', () => {
    const decoded = {
      success: true,
      type: 'nevent',
      data: { id: ID, relays: ['wss://own.example/'] },
      identifier: 'nevent1x'
    };
    expect(withQuoteHint(decoded, hint).data).toEqual({
      id: ID,
      relays: ['wss://own.example/', 'wss://q.example/'],
      author: AUTHOR
    });

    const withAuthor = { ...decoded, data: { ...decoded.data, author: 'b'.repeat(64) } };
    expect(withQuoteHint(withAuthor, hint).data.author).toBe('b'.repeat(64));
  });

  it('leaves the reference alone without a matching hint', () => {
    const decoded = { success: true, type: 'note', data: ID, identifier: 'note1x' };
    expect(withQuoteHint(decoded, undefined)).toBe(decoded);
    expect(withQuoteHint({ success: false, identifier: 'x' }, hint)).toEqual({
      success: false,
      identifier: 'x'
    });
  });
});
