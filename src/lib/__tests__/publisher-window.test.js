/**
 * Publisher window (Schaufenster) pure helpers — spec:
 * docs/nips/communikey-groups.md "Publisher window". The load-bearing rule
 * under test: NOBODY reaches the public list without their own accepted
 * consent (kind 3320), regardless of what the owner granted.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  PUBLISHER_CONSENT_KIND,
  buildPublisherConsentTemplate,
  foldPublisherConsents,
  publisherRoleId,
  grantedPublishers,
  resolvePublisherListing,
  parsePublishersList,
  buildPublishersListTemplate,
  publishersListAddress,
  windowSectionKeys,
  withWindowSections,
  hasUngatedPublicSections
} from '$lib/concord/publisher-window.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

/** @param {string} pubkey @param {'accepted'|'revoked'} status @param {number} at @param {string} [id] */
const consent = (pubkey, status, at, id = 'x') => ({
  kind: PUBLISHER_CONSENT_KIND,
  pubkey,
  id,
  created_at: at,
  tags: [
    ['t', 'publisher-window'],
    ['status', status]
  ]
});

describe('buildPublisherConsentTemplate', () => {
  it('carries the marker tag and status', () => {
    const template = buildPublisherConsentTemplate('accepted');
    expect(template.kind).toBe(3320);
    expect(template.tags).toContainEqual(['t', 'publisher-window']);
    expect(template.tags).toContainEqual(['status', 'accepted']);
  });
});

describe('foldPublisherConsents', () => {
  it('latest rumor per member wins', () => {
    const folded = foldPublisherConsents([
      consent(A, 'accepted', 100),
      consent(A, 'revoked', 200),
      consent(B, 'accepted', 150)
    ]);
    expect(folded.get(A)).toBe('revoked');
    expect(folded.get(B)).toBe('accepted');
  });

  it('same-second tie resolves by lower id (deterministic)', () => {
    const folded = foldPublisherConsents([
      consent(A, 'revoked', 100, 'zz'),
      consent(A, 'accepted', 100, 'aa')
    ]);
    expect(folded.get(A)).toBe('accepted');
  });

  it('ignores malformed rumors (wrong kind, missing marker, unknown status, null)', () => {
    const folded = foldPublisherConsents(
      /** @type {any} */ ([
        null,
        { kind: 9, pubkey: A, created_at: 1, tags: [['status', 'accepted']] },
        { kind: 3320, pubkey: A, created_at: 1, tags: [['status', 'accepted']] },
        {
          kind: 3320,
          pubkey: A,
          created_at: 1,
          tags: [
            ['t', 'publisher-window'],
            ['status', 'maybe']
          ]
        }
      ])
    );
    expect(folded.size).toBe(0);
  });
});

describe('publisherRoleId / grantedPublishers', () => {
  it('finds the live Publisher role, skipping deleted ones', () => {
    expect(
      publisherRoleId([
        { role_id: 'r1', name: 'Publisher', deleted: true },
        { role_id: 'r2', name: 'Publisher' },
        { role_id: 'r3', name: 'Moderator' }
      ])
    ).toBe('r2');
    expect(publisherRoleId([])).toBeNull();
  });

  it('collects role holders from array and Map grant shapes', () => {
    const fromArray = grantedPublishers(
      [
        { member: A, role_ids: ['r2'] },
        { member: B, role_ids: ['r3'] }
      ],
      'r2'
    );
    expect([...fromArray]).toEqual([A]);
    const fromMap = grantedPublishers(
      new Map([
        [A, ['r2']],
        [B, ['r2', 'r3']]
      ]),
      'r2'
    );
    expect([...fromMap].sort()).toEqual([A, B]);
  });
});

describe('resolvePublisherListing — consent is load-bearing', () => {
  it('lists only granted AND accepted members', () => {
    const listing = resolvePublisherListing({
      granted: new Set([A, B, C]),
      consents: new Map([
        [A, 'accepted'],
        [B, 'revoked']
        // C never answered
      ])
    });
    expect(listing).toEqual([A]);
  });

  it('an acceptance without a grant lists nobody', () => {
    const listing = resolvePublisherListing({
      granted: new Set(),
      consents: new Map([[A, 'accepted']])
    });
    expect(listing).toEqual([]);
  });
});

describe('publishers list event helpers', () => {
  it('parses p-tags, deduped and hex-validated', () => {
    expect(
      parsePublishersList({
        tags: [
          ['d', 'publishers'],
          ['p', A],
          ['p', A],
          ['p', 'garbage'],
          ['p', B]
        ]
      })
    ).toEqual([A, B]);
  });

  it('builds a strictly-newer replacement', () => {
    const template = buildPublishersListTemplate([A], { created_at: 9999999999 });
    expect(template.created_at).toBe(10000000000);
    expect(template.tags[0]).toEqual(['d', 'publishers']);
    expect(template.tags).toContainEqual(['p', A]);
  });
});

describe('window sections (Privat mit Schaufenster)', () => {
  const PK = 'f'.repeat(64);
  const RELAY = 'wss://r.example';
  const gate = ['a', publishersListAddress(PK), RELAY];

  it('builds gated sections for the selected types, after the prelude', () => {
    const tags = [
      ['d', ''],
      ['r', 'wss://relay.example'],
      ['strict', 'content'],
      ['concord', 'c'.repeat(64), 'wss://concord.example']
    ];
    const out = withWindowSections(tags, PK, RELAY, ['learning', 'articles']);
    // Prelude untouched, in order
    expect(out.slice(0, 4)).toEqual(tags);
    // Each selected type: content tag + k tags + the publishers gate
    expect(out).toContainEqual(['content', 'Learning']);
    expect(out).toContainEqual(['content', 'Articles']);
    expect(out).toContainEqual(['k', '30142']);
    expect(out).toContainEqual(['k', '30023']);
    expect(out.filter((t) => t[0] === 'a' && t[1] === publishersListAddress(PK))).toHaveLength(2);
    // Round-trips through the reader
    expect(windowSectionKeys(out, PK).sort()).toEqual(['articles', 'learning']);
  });

  it('replaces the previous window selection instead of stacking', () => {
    const first = withWindowSections([['strict', 'content']], PK, RELAY, ['learning']);
    const second = withWindowSections(first, PK, RELAY, ['wikis']);
    expect(windowSectionKeys(second, PK)).toEqual(['wikis']);
    expect(second.filter((t) => t[0] === 'content')).toHaveLength(1);
    // Empty selection removes the window entirely
    expect(withWindowSections(second, PK, RELAY, []).filter((t) => t[0] === 'content')).toEqual([]);
  });

  it('keeps sections it does not own (ungated, or gated by another list)', () => {
    const foreignGate = ['a', `30000:${'b'.repeat(64)}:publishers`, RELAY];
    const tags = [
      ['strict', 'content'],
      ['content', 'Chat'],
      ['k', '9'],
      ['content', 'Forum'],
      foreignGate,
      ['content', 'Learning'],
      gate
    ];
    const out = withWindowSections(tags, PK, RELAY, []);
    expect(out.filter((t) => t[0] === 'content').map((t) => t[1])).toEqual(['Chat', 'Forum']);
    expect(out).toContainEqual(foreignGate);
    expect(hasUngatedPublicSections(tags, PK)).toBe(true);
    expect(hasUngatedPublicSections([['content', 'Learning'], gate], PK)).toBe(false);
    expect(hasUngatedPublicSections([['strict', 'content']], PK)).toBe(false);
  });
});
