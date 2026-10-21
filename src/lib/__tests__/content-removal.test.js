/** @vitest-environment node */
// src/lib/__tests__/content-removal.test.js
//
// Removing content from a community (docs/nips/communikey-groups.md,
// "Removing content"): a NIP-32 label (kind 1985) in the
// `communikey.moderation` namespace, honoured only when its author is the
// community key or a current moderation-role holder of the root group.
import { describe, it, expect } from 'vitest';
import {
  CONTENT_REMOVAL_KIND,
  CONTENT_REMOVAL_NAMESPACE,
  CONTENT_REMOVAL_LABEL,
  eventAddress,
  buildContentRemovalTemplate,
  parseContentRemoval,
  removalAuthorities,
  isValidContentRemoval,
  validContentRemovals,
  removedTargets,
  isRemovedItem,
  filterRemoved,
  canModerateCommunity
} from '$lib/groups/content-removal.js';

const COMMUNITY = 'a'.repeat(64);
const ADMIN = 'b'.repeat(64);
const PUBLISHER = 'c'.repeat(64);
const STRANGER = 'd'.repeat(64);
const AUTHOR = 'e'.repeat(64);
const OTHER_COMMUNITY = 'f'.repeat(64);
const GROUPS_RELAY = 'wss://groups.example/';

const moderatedCommunity = {
  kind: 10222,
  pubkey: COMMUNITY,
  created_at: 1000,
  content: '',
  tags: [
    ['membership', 'root1', GROUPS_RELAY],
    ['r', 'wss://community.example/'],
    ['content', 'Articles'],
    ['k', '30023']
  ]
};
const openCommunity = {
  ...moderatedCommunity,
  tags: moderatedCommunity.tags.filter((t) => t[0] !== 'membership')
};
const admins = [
  { pubkey: ADMIN, roles: ['admin'] },
  { pubkey: PUBLISHER, roles: ['publisher'] }
];

const article = {
  kind: 30023,
  id: '1'.repeat(64),
  pubkey: AUTHOR,
  created_at: 500,
  content: 'hello',
  tags: [
    ['d', 'my-article'],
    ['title', 'My article']
  ]
};
const note = {
  kind: 11,
  id: '2'.repeat(64),
  pubkey: AUTHOR,
  created_at: 500,
  content: 'thread',
  tags: []
};

/** @param {{pubkey?: string, created_at?: number, id?: string, tags?: string[][], kind?: number}} over */
const label = (over = {}) => ({
  kind: over.kind ?? CONTENT_REMOVAL_KIND,
  pubkey: over.pubkey ?? ADMIN,
  created_at: over.created_at ?? 2000,
  id: over.id ?? '9'.repeat(64),
  content: '',
  tags: over.tags ?? [
    ['L', CONTENT_REMOVAL_NAMESPACE],
    ['l', CONTENT_REMOVAL_LABEL, CONTENT_REMOVAL_NAMESPACE],
    ['h', COMMUNITY],
    ['k', '30023'],
    ['e', article.id, ''],
    ['a', `30023:${AUTHOR}:my-article`, '']
  ]
});

describe('eventAddress', () => {
  it('is kind:pubkey:d for addressable kinds and null otherwise', () => {
    expect(eventAddress(article)).toBe(`30023:${AUTHOR}:my-article`);
    expect(eventAddress(note)).toBeNull();
    expect(eventAddress({ ...article, tags: [] })).toBeNull();
    expect(eventAddress(null)).toBeNull();
  });
});

describe('buildContentRemovalTemplate', () => {
  it('is a kind 1985 label scoped to the community with e + a targets', () => {
    const t = buildContentRemovalTemplate(COMMUNITY, article, 'wss://hint.example/');
    expect(t.kind).toBe(1985);
    expect(t.content).toBe('');
    expect(t.tags).toEqual([
      ['L', 'communikey.moderation'],
      ['l', 'remove', 'communikey.moderation'],
      ['h', COMMUNITY],
      ['k', '30023'],
      ['e', article.id, 'wss://hint.example/'],
      ['a', `30023:${AUTHOR}:my-article`, 'wss://hint.example/']
    ]);
  });

  it('carries only an e tag for non-addressable content', () => {
    const t = buildContentRemovalTemplate(COMMUNITY, note);
    expect(t.tags.filter((x) => x[0] === 'a')).toEqual([]);
    expect(t.tags.find((x) => x[0] === 'e')).toEqual(['e', note.id, '']);
    expect(t.tags.find((x) => x[0] === 'k')).toEqual(['k', '11']);
  });

  it('round-trips through parseContentRemoval', () => {
    const t = buildContentRemovalTemplate(COMMUNITY, article);
    const parsed = parseContentRemoval({ ...t, pubkey: ADMIN, id: 'x', created_at: 1 });
    expect(parsed).toEqual({
      communityPubkey: COMMUNITY,
      kind: 30023,
      ids: [article.id],
      addresses: [`30023:${AUTHOR}:my-article`]
    });
  });
});

describe('parseContentRemoval', () => {
  it('rejects other kinds, other namespaces, other labels and labels without h', () => {
    expect(parseContentRemoval(label({ kind: 1 }))).toBeNull();
    expect(
      parseContentRemoval(
        label({
          tags: [
            ['L', 'other.ns'],
            ['l', 'remove', 'other.ns'],
            ['h', COMMUNITY],
            ['e', article.id]
          ]
        })
      )
    ).toBeNull();
    expect(
      parseContentRemoval(
        label({
          tags: [
            ['L', CONTENT_REMOVAL_NAMESPACE],
            ['l', 'approve', CONTENT_REMOVAL_NAMESPACE],
            ['h', COMMUNITY],
            ['e', article.id]
          ]
        })
      )
    ).toBeNull();
    expect(
      parseContentRemoval(
        label({
          tags: [
            ['L', CONTENT_REMOVAL_NAMESPACE],
            ['l', 'remove', CONTENT_REMOVAL_NAMESPACE],
            ['e', article.id]
          ]
        })
      )
    ).toBeNull();
    expect(parseContentRemoval(null)).toBeNull();
  });

  it('rejects a label naming no target at all', () => {
    expect(
      parseContentRemoval(
        label({
          tags: [
            ['L', CONTENT_REMOVAL_NAMESPACE],
            ['l', 'remove', CONTENT_REMOVAL_NAMESPACE],
            ['h', COMMUNITY]
          ]
        })
      )
    ).toBeNull();
  });

  it('ignores malformed e/a values instead of matching garbage', () => {
    const parsed = parseContentRemoval(
      label({
        tags: [
          ['L', CONTENT_REMOVAL_NAMESPACE],
          ['l', 'remove', CONTENT_REMOVAL_NAMESPACE],
          ['h', COMMUNITY],
          ['e', 'not-an-id'],
          ['e', article.id],
          ['a', 'nope'],
          ['a', `30023:${AUTHOR}:my-article`]
        ]
      })
    );
    expect(parsed?.ids).toEqual([article.id]);
    expect(parsed?.addresses).toEqual([`30023:${AUTHOR}:my-article`]);
  });
});

describe('removalAuthorities', () => {
  it('is the community key plus the moderation roles of a moderated community', () => {
    expect(removalAuthorities(moderatedCommunity, admins)).toEqual([COMMUNITY, ADMIN]);
  });

  it('is the community key alone for an open community, whatever roster is passed', () => {
    expect(removalAuthorities(openCommunity, admins)).toEqual([COMMUNITY]);
  });

  it('is empty without a community event', () => {
    expect(removalAuthorities(null, admins)).toEqual([]);
  });
});

describe('isValidContentRemoval', () => {
  const authorities = removalAuthorities(moderatedCommunity, admins);

  it('honours the community key and a current moderator', () => {
    expect(isValidContentRemoval(label({ pubkey: COMMUNITY }), COMMUNITY, authorities)).toBe(true);
    expect(isValidContentRemoval(label({ pubkey: ADMIN }), COMMUNITY, authorities)).toBe(true);
  });

  it('rejects publisher-only roster entries and strangers', () => {
    expect(isValidContentRemoval(label({ pubkey: PUBLISHER }), COMMUNITY, authorities)).toBe(false);
    expect(isValidContentRemoval(label({ pubkey: STRANGER }), COMMUNITY, authorities)).toBe(false);
  });

  it('rejects a label scoped to another community', () => {
    const foreign = label({
      tags: [
        ['L', CONTENT_REMOVAL_NAMESPACE],
        ['l', 'remove', CONTENT_REMOVAL_NAMESPACE],
        ['h', OTHER_COMMUNITY],
        ['e', article.id]
      ]
    });
    expect(isValidContentRemoval(foreign, COMMUNITY, authorities)).toBe(false);
  });

  it('is retroactive: a demoted moderator no longer counts', () => {
    const demoted = removalAuthorities(moderatedCommunity, [
      { pubkey: ADMIN, roles: ['publisher'] }
    ]);
    expect(isValidContentRemoval(label({ pubkey: ADMIN }), COMMUNITY, demoted)).toBe(false);
  });
});

describe('validContentRemovals + removedTargets', () => {
  it('keeps valid labels newest first and unions their targets', () => {
    const authorities = removalAuthorities(moderatedCommunity, admins);
    const byAdmin = label({ pubkey: ADMIN, created_at: 2000, id: '7'.repeat(64) });
    const byOwner = label({
      pubkey: COMMUNITY,
      created_at: 3000,
      id: '8'.repeat(64),
      tags: [
        ['L', CONTENT_REMOVAL_NAMESPACE],
        ['l', 'remove', CONTENT_REMOVAL_NAMESPACE],
        ['h', COMMUNITY],
        ['e', note.id]
      ]
    });
    const byStranger = label({ pubkey: STRANGER, created_at: 4000, id: '6'.repeat(64) });
    const valid = validContentRemovals([byAdmin, byStranger, byOwner], COMMUNITY, authorities);
    expect(valid.map((l) => l.id)).toEqual([byOwner.id, byAdmin.id]);
    const removed = removedTargets(valid);
    expect([...removed.ids]).toEqual([note.id, article.id]);
    expect([...removed.addresses]).toEqual([`30023:${AUTHOR}:my-article`]);
  });

  it('is empty when nothing is valid', () => {
    const removed = removedTargets(
      validContentRemovals([label({ pubkey: STRANGER })], COMMUNITY, [])
    );
    expect(removed.ids.size).toBe(0);
    expect(removed.addresses.size).toBe(0);
  });
});

describe('isRemovedItem / filterRemoved', () => {
  const removed = removedTargets([label()]);

  it('matches a raw event by id', () => {
    expect(
      isRemovedItem(
        note,
        removedTargets([
          label({
            tags: [
              ['L', CONTENT_REMOVAL_NAMESPACE],
              ['l', 'remove', CONTENT_REMOVAL_NAMESPACE],
              ['h', COMMUNITY],
              ['e', note.id]
            ]
          })
        ])
      )
    ).toBe(true);
    expect(isRemovedItem(note, removed)).toBe(false);
  });

  it('still matches an addressable event after the author edited it (new id, same d)', () => {
    const edited = { ...article, id: '3'.repeat(64), created_at: 900 };
    expect(isRemovedItem(edited, removed)).toBe(true);
  });

  it('matches transformed items: calendar metadata (originalEvent) and AMB (tags kept)', () => {
    const calendarItem = {
      id: '4'.repeat(64),
      kind: 31923,
      pubkey: AUTHOR,
      dTag: 'meet',
      originalEvent: {
        id: '4'.repeat(64),
        kind: 31923,
        pubkey: AUTHOR,
        tags: [['d', 'meet']]
      }
    };
    const calendarRemoved = removedTargets([
      label({
        tags: [
          ['L', CONTENT_REMOVAL_NAMESPACE],
          ['l', 'remove', CONTENT_REMOVAL_NAMESPACE],
          ['h', COMMUNITY],
          ['a', `31923:${AUTHOR}:meet`]
        ]
      })
    ]);
    expect(isRemovedItem(calendarItem, calendarRemoved)).toBe(true);

    const ambItem = {
      id: '5'.repeat(64),
      kind: 30142,
      pubkey: AUTHOR,
      identifier: 'https://example.org/res',
      tags: [['d', 'https://example.org/res']]
    };
    const ambRemoved = removedTargets([
      label({
        tags: [
          ['L', CONTENT_REMOVAL_NAMESPACE],
          ['l', 'remove', CONTENT_REMOVAL_NAMESPACE],
          ['h', COMMUNITY],
          ['a', `30142:${AUTHOR}:https://example.org/res`]
        ]
      })
    ]);
    expect(isRemovedItem(ambItem, ambRemoved)).toBe(true);
    expect(isRemovedItem(ambItem, calendarRemoved)).toBe(false);
  });

  it('filterRemoved drops removed items and returns the same array when nothing matches', () => {
    const items = [article, note];
    expect(filterRemoved(items, removed)).toEqual([note]);
    const empty = removedTargets([]);
    expect(filterRemoved(items, empty)).toBe(items);
    expect(filterRemoved(items, undefined)).toBe(items);
  });
});

describe('canModerateCommunity', () => {
  it('owner always; moderation role only on a moderated community', () => {
    expect(
      canModerateCommunity({
        communityEvent: openCommunity,
        admins: [],
        pubkey: STRANGER,
        isOwner: true
      })
    ).toBe(true);
    expect(
      canModerateCommunity({
        communityEvent: moderatedCommunity,
        admins,
        pubkey: ADMIN,
        isOwner: false
      })
    ).toBe(true);
    expect(
      canModerateCommunity({
        communityEvent: moderatedCommunity,
        admins,
        pubkey: PUBLISHER,
        isOwner: false
      })
    ).toBe(false);
    expect(
      canModerateCommunity({ communityEvent: openCommunity, admins, pubkey: ADMIN, isOwner: false })
    ).toBe(false);
    expect(
      canModerateCommunity({
        communityEvent: moderatedCommunity,
        admins,
        pubkey: undefined,
        isOwner: false
      })
    ).toBe(false);
  });
});
