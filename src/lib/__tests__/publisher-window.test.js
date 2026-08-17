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
  withPublisherSectionGates,
  withoutPublisherSectionGates
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

describe('section gate wiring', () => {
  const PK = 'f'.repeat(64);
  it('inserts the gate after every ungated content section, idempotently', () => {
    const tags = [
      ['d', ''],
      ['content', 'Chat'],
      ['content', 'Articles'],
      ['a', publishersListAddress(PK), 'wss://r.example'],
      ['strict']
    ];
    const out = withPublisherSectionGates(tags, PK, 'wss://r.example');
    // Chat gains a gate; Articles keeps its existing one (no duplicate)
    expect(out.filter((t) => t[0] === 'a' && t[1] === publishersListAddress(PK))).toHaveLength(2);
    expect(out[2]).toEqual(['a', publishersListAddress(PK), 'wss://r.example']);
    // Idempotent on re-run
    expect(withPublisherSectionGates(out, PK, 'wss://r.example')).toEqual(out);
  });

  it('withoutPublisherSectionGates strips only this community gates', () => {
    const foreign = ['a', `30000:${A}:publishers`, 'wss://r'];
    const tags = [['content', 'Chat'], ['a', publishersListAddress(PK)], foreign];
    const out = withoutPublisherSectionGates(tags, PK);
    expect(out).toContainEqual(foreign);
    expect(out.some((t) => t[1] === publishersListAddress(PK))).toBe(false);
  });
});
