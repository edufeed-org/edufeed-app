/**
 * NIP-89 helpers — parse handler (kind 31990) and recommendation (kind 31989)
 * events, resolve a handler's web URL for a given NIP-19 entity, and derive
 * a title for an event kind the app has no dedicated view for.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  parseHandlerEvent,
  parseRecommendationAddresses,
  resolveHandlerUrl,
  getGenericEventTitle,
  parseJsonContent
} from '$lib/helpers/nip89.js';

const APP = 'a'.repeat(64);
const USER = 'b'.repeat(64);

/**
 * @param {string[][]} tags
 * @param {Partial<{content: string, pubkey: string, created_at: number, kind: number}>} [overrides]
 */
function handler(tags, overrides = {}) {
  return {
    kind: 31990,
    id: 'h1',
    pubkey: APP,
    created_at: 100,
    content: '',
    tags,
    ...overrides
  };
}

describe('parseHandlerEvent', () => {
  it('reads kinds, web templates and inline metadata', () => {
    const event = handler(
      [
        ['d', 'zapstr'],
        ['k', '31337'],
        ['k', '30617'],
        ['web', 'https://zapstr.live/a/<bech32>', 'naddr'],
        ['web', 'https://zapstr.live/e/<bech32>', 'nevent'],
        ['web', 'https://zapstr.live/<bech32>'],
        ['ios', 'zapstr://<bech32>']
      ],
      { content: JSON.stringify({ name: 'Zapstr', picture: 'https://x/p.png', about: 'Music' }) }
    );
    expect(parseHandlerEvent(event)).toEqual({
      address: `31990:${APP}:zapstr`,
      pubkey: APP,
      identifier: 'zapstr',
      createdAt: 100,
      kinds: [31337, 30617],
      name: 'Zapstr',
      picture: 'https://x/p.png',
      about: 'Music',
      web: [
        { template: 'https://zapstr.live/a/<bech32>', type: 'naddr' },
        { template: 'https://zapstr.live/e/<bech32>', type: 'nevent' },
        { template: 'https://zapstr.live/<bech32>', type: null }
      ]
    });
  });

  it('leaves metadata null when content is empty or not JSON (caller falls back to kind 0)', () => {
    const parsed = parseHandlerEvent(
      handler([
        ['d', 'x'],
        ['k', '1'],
        ['web', 'https://a/<bech32>']
      ])
    );
    expect(parsed?.name).toBeNull();
    expect(parsed?.picture).toBeNull();
    const broken = parseHandlerEvent(
      handler(
        [
          ['d', 'x'],
          ['k', '1'],
          ['web', 'https://a/<bech32>']
        ],
        { content: '{not json' }
      )
    );
    expect(broken?.name).toBeNull();
  });

  it('prefers display_name over name and ignores non-string metadata fields', () => {
    const parsed = parseHandlerEvent(
      handler(
        [
          ['d', 'x'],
          ['k', '1'],
          ['web', 'https://a/<bech32>']
        ],
        {
          content: JSON.stringify({ name: 'raw', display_name: 'Shown', picture: 42 })
        }
      )
    );
    expect(parsed?.name).toBe('Shown');
    expect(parsed?.picture).toBeNull();
  });

  it('drops web templates that are not https or lack the <bech32> placeholder', () => {
    const parsed = parseHandlerEvent(
      handler([
        ['d', 'x'],
        ['k', '1'],
        ['web', 'http://insecure/<bech32>'],
        ['web', 'javascript:alert(1)'],
        ['web', 'https://no-placeholder.example/'],
        ['web', 'https://ok.example/<bech32>']
      ])
    );
    expect(parsed?.web).toEqual([{ template: 'https://ok.example/<bech32>', type: null }]);
  });

  it('returns null for other kinds, missing d tag, or no usable web template', () => {
    expect(
      parseHandlerEvent(
        handler(
          [
            ['d', 'x'],
            ['k', '1']
          ],
          { kind: 1 }
        )
      )
    ).toBeNull();
    expect(
      parseHandlerEvent(
        handler([
          ['k', '1'],
          ['web', 'https://a/<bech32>']
        ])
      )
    ).toBeNull();
    expect(
      parseHandlerEvent(
        handler([
          ['d', 'x'],
          ['k', '1'],
          ['ios', 'a://<bech32>']
        ])
      )
    ).toBeNull();
    expect(parseHandlerEvent(null)).toBeNull();
  });

  it('ignores malformed k tags and dedupes kinds', () => {
    const parsed = parseHandlerEvent(
      handler([
        ['d', 'x'],
        ['k', '1'],
        ['k', '1'],
        ['k', 'abc'],
        ['k'],
        ['web', 'https://a/<bech32>']
      ])
    );
    expect(parsed?.kinds).toEqual([1]);
  });
});

describe('parseRecommendationAddresses', () => {
  it('returns the 31990 coordinates with relay hint and platform', () => {
    const rec = {
      kind: 31989,
      pubkey: USER,
      created_at: 1,
      content: '',
      tags: [
        ['d', '30617'],
        ['a', `31990:${APP}:zapstr`, 'wss://relay1', 'web'],
        ['a', `31990:${'c'.repeat(64)}:other`, '', 'ios'],
        ['a', `31990:${'d'.repeat(64)}:generic`],
        ['a', `30023:${APP}:not-a-handler`],
        ['a', 'garbage']
      ]
    };
    expect(parseRecommendationAddresses(rec)).toEqual([
      {
        address: `31990:${APP}:zapstr`,
        pubkey: APP,
        identifier: 'zapstr',
        relay: 'wss://relay1',
        platform: 'web'
      },
      {
        address: `31990:${'c'.repeat(64)}:other`,
        pubkey: 'c'.repeat(64),
        identifier: 'other',
        relay: null,
        platform: 'ios'
      },
      {
        address: `31990:${'d'.repeat(64)}:generic`,
        pubkey: 'd'.repeat(64),
        identifier: 'generic',
        relay: null,
        platform: null
      }
    ]);
  });

  it('returns [] for other kinds or events without a tags', () => {
    expect(parseRecommendationAddresses({ kind: 1, tags: [] })).toEqual([]);
    expect(parseRecommendationAddresses(null)).toEqual([]);
  });
});

describe('resolveHandlerUrl', () => {
  const parsed = parseHandlerEvent(
    handler([
      ['d', 'x'],
      ['k', '30617'],
      ['web', 'https://app.example/a/<bech32>', 'naddr'],
      ['web', 'https://app.example/e/<bech32>', 'nevent'],
      ['web', 'https://app.example/any/<bech32>']
    ])
  );

  it('picks the template whose type matches the entity', () => {
    expect(resolveHandlerUrl(parsed, { type: 'naddr', bech32: 'naddr1abc' })).toBe(
      'https://app.example/a/naddr1abc'
    );
    expect(resolveHandlerUrl(parsed, { type: 'nevent', bech32: 'nevent1abc' })).toBe(
      'https://app.example/e/nevent1abc'
    );
  });

  it('falls back to the untyped template, then to null', () => {
    const onlyGeneric = parseHandlerEvent(
      handler([
        ['d', 'x'],
        ['k', '1'],
        ['web', 'https://app.example/<bech32>?x=<bech32>']
      ])
    );
    expect(resolveHandlerUrl(onlyGeneric, { type: 'nevent', bech32: 'nevent1abc' })).toBe(
      'https://app.example/nevent1abc?x=nevent1abc'
    );
    const onlyNaddr = parseHandlerEvent(
      handler([
        ['d', 'x'],
        ['k', '1'],
        ['web', 'https://app.example/a/<bech32>', 'naddr']
      ])
    );
    expect(resolveHandlerUrl(onlyNaddr, { type: 'nevent', bech32: 'nevent1abc' })).toBeNull();
    expect(resolveHandlerUrl(null, { type: 'nevent', bech32: 'nevent1abc' })).toBeNull();
  });

  it('treats a "note" template as a fallback for nevent entities', () => {
    const noteOnly = parseHandlerEvent(
      handler([
        ['d', 'x'],
        ['k', '1'],
        ['web', 'https://app.example/n/<bech32>', 'note']
      ])
    );
    expect(resolveHandlerUrl(noteOnly, { type: 'nevent', bech32: 'nevent1abc' })).toBe(
      'https://app.example/n/nevent1abc'
    );
  });
});

describe('getGenericEventTitle', () => {
  it('prefers title, then name, then subject, then the NIP-31 alt tag', () => {
    const ev = (/** @type {string[][]} */ tags) => ({ kind: 30617, tags, content: '' });
    expect(
      getGenericEventTitle(
        ev([
          ['alt', 'A repo'],
          ['name', 'repo'],
          ['title', 'Title']
        ])
      )
    ).toBe('Title');
    expect(
      getGenericEventTitle(
        ev([
          ['alt', 'A repo'],
          ['name', 'repo']
        ])
      )
    ).toBe('repo');
    expect(
      getGenericEventTitle(
        ev([
          ['alt', 'A repo'],
          ['subject', 'Subj']
        ])
      )
    ).toBe('Subj');
    expect(getGenericEventTitle(ev([['alt', 'A repo']]))).toBe('A repo');
    expect(getGenericEventTitle(ev([['title', '   ']]))).toBeNull();
    expect(getGenericEventTitle(ev([]))).toBeNull();
    expect(getGenericEventTitle(null)).toBeNull();
  });
});

describe('parseJsonContent', () => {
  it('returns parsed objects/arrays and null for everything else', () => {
    expect(parseJsonContent('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonContent('[1,2]')).toEqual([1, 2]);
    expect(parseJsonContent('"just a string"')).toBeNull();
    expect(parseJsonContent('42')).toBeNull();
    expect(parseJsonContent('hello world')).toBeNull();
    expect(parseJsonContent('')).toBeNull();
    expect(parseJsonContent(undefined)).toBeNull();
  });
});
