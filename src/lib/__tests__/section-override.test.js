/** @vitest-environment node */
// src/lib/__tests__/section-override.test.js
//
// The kind-30223 content-section override: how a moderated community's root
// group admins reshape its public surface without holding the community key.
import { describe, it, expect } from 'vitest';
import {
  SECTION_OVERRIDE_KIND,
  buildSectionOverrideTemplate,
  isValidSectionOverride,
  resolveCommunitySections,
  applySectionOverride
} from '$lib/groups/section-override.js';
import {
  parseCommunityContentTypes,
  parseCommunityMetadata,
  hasStrictContentMarker
} from '$lib/helpers/communityRelays.js';
import { parseMembershipPointer, deriveCommunityType } from '$lib/groups/community-membership.js';

const COMMUNITY = 'a'.repeat(64);
const ADMIN = 'b'.repeat(64);
const OTHER_ADMIN = 'c'.repeat(64);
const STRANGER = 'd'.repeat(64);
const GROUPS_RELAY = 'wss://groups.example/';

/** @param {string[][]} extraTags */
const communityEvent = (extraTags = [], created_at = 1000) => ({
  kind: 10222,
  pubkey: COMMUNITY,
  created_at,
  content: '',
  tags: [
    ['membership', 'root1', GROUPS_RELAY],
    ['content', 'Learning'],
    ['k', '30142'],
    ['content', 'Calendar'],
    ['k', '31923'],
    ...extraTags
  ]
});

/** @param {{pubkey?: string, created_at?: number, id?: string, tags?: string[][]}} over */
const overrideEvent = (over = {}) => ({
  kind: SECTION_OVERRIDE_KIND,
  pubkey: over.pubkey ?? ADMIN,
  created_at: over.created_at ?? 2000,
  id: over.id ?? 'e'.repeat(64),
  content: '',
  tags: over.tags ?? [
    ['d', COMMUNITY],
    ['h', COMMUNITY],
    ['content', 'Materialien'],
    ['k', '30142'],
    ['access', 'role', 'publisher']
  ]
});

const admins = new Set([ADMIN, OTHER_ADMIN]);

describe('buildSectionOverrideTemplate', () => {
  it('addresses the override at the community and carries content/k/access verbatim', () => {
    const template = buildSectionOverrideTemplate(COMMUNITY, [
      { name: 'Materialien', kinds: [30142], access: { tier: 'role', role: 'publisher' } },
      { name: 'Kalender', kinds: [31922, 31923], access: { tier: 'members' } },
      { name: 'Forum', kinds: [11], access: { tier: 'all' } }
    ]);

    expect(template.kind).toBe(SECTION_OVERRIDE_KIND);
    expect(template.tags).toEqual([
      ['d', COMMUNITY],
      ['h', COMMUNITY],
      ['content', 'Materialien'],
      ['k', '30142'],
      ['access', 'role', 'publisher'],
      ['content', 'Kalender'],
      ['k', '31922'],
      ['k', '31923'],
      ['access', 'members'],
      ['content', 'Forum'],
      ['k', '11']
    ]);
  });

  it('drops per-section relays, profile lists, badges and form refs', () => {
    // Infrastructure and legacy gating stay owner-owned on the 10222 — an
    // admin editing content types must not be able to redirect a section's
    // relays or re-introduce a profile-list gate.
    const template = buildSectionOverrideTemplate(COMMUNITY, [
      {
        name: 'Materialien',
        kinds: [30142],
        access: { tier: 'members' },
        relays: ['wss://evil.example/'],
        profileList: `30000:${STRANGER}:Materialien`,
        profileListRelay: 'wss://evil.example/',
        badges: { read: '30009:x:y', write: '30009:x:z' },
        formRef: '30168:x:y',
        roles: ['lehrkraft'],
        fee: { amount: '100', unit: 'sat' },
        exclusive: true
      }
    ]);

    const keys = template.tags.map((t) => t[0]);
    expect(keys).toEqual(['d', 'h', 'content', 'k', 'access']);
  });

  it('omits a role-tier access tag with a blank role rather than emitting a broken gate', () => {
    // withSectionAccess has the same rule: a role tier with no role would
    // parse back as tier 'all', i.e. silently open the section.
    const template = buildSectionOverrideTemplate(COMMUNITY, [
      { name: 'Materialien', kinds: [30142], access: { tier: 'role', role: '  ' } }
    ]);
    expect(template.tags.some((t) => t[0] === 'access')).toBe(false);
  });

  it('skips sections with no usable name', () => {
    const template = buildSectionOverrideTemplate(COMMUNITY, [
      { name: '  ', kinds: [30142], access: { tier: 'all' } },
      { name: 'Materialien', kinds: [30142], access: { tier: 'all' } }
    ]);
    expect(template.tags.filter((t) => t[0] === 'content')).toEqual([['content', 'Materialien']]);
  });
});

describe('isValidSectionOverride', () => {
  it('accepts an override signed by a current root-group admin', () => {
    expect(isValidSectionOverride(overrideEvent(), { communityPubkey: COMMUNITY, admins })).toBe(
      true
    );
  });

  it('accepts one signed by the community key itself', () => {
    expect(
      isValidSectionOverride(overrideEvent({ pubkey: COMMUNITY }), {
        communityPubkey: COMMUNITY,
        admins: new Set()
      })
    ).toBe(true);
  });

  it('rejects a non-admin author — anyone can publish a 30223 to a relay', () => {
    expect(
      isValidSectionOverride(overrideEvent({ pubkey: STRANGER }), {
        communityPubkey: COMMUNITY,
        admins
      })
    ).toBe(false);
  });

  it('rejects a demoted admin: validity is judged against the CURRENT roster', () => {
    // Same retroactive rule as roster-access.js — losing the role loses the
    // authority, without anyone having to delete the old event.
    expect(
      isValidSectionOverride(overrideEvent({ pubkey: ADMIN }), {
        communityPubkey: COMMUNITY,
        admins: new Set([OTHER_ADMIN])
      })
    ).toBe(false);
  });

  it('rejects the wrong kind or an override addressed at another community', () => {
    expect(
      isValidSectionOverride(
        { ...overrideEvent(), kind: 30222 },
        {
          communityPubkey: COMMUNITY,
          admins
        }
      )
    ).toBe(false);
    expect(
      isValidSectionOverride(
        overrideEvent({
          tags: [
            ['d', STRANGER],
            ['content', 'X']
          ]
        }),
        {
          communityPubkey: COMMUNITY,
          admins
        }
      )
    ).toBe(false);
    expect(isValidSectionOverride(null, { communityPubkey: COMMUNITY, admins })).toBe(false);
  });
});

describe('resolveCommunitySections', () => {
  it('uses the 10222 sections when there is no override', () => {
    const resolved = resolveCommunitySections(communityEvent(), [], admins);
    expect(resolved.source).toBe('community');
    expect(resolved.sections.map((s) => s.name)).toEqual(['Learning', 'Calendar']);
    expect(resolved.author).toBe(null);
  });

  it('a newer valid override replaces the whole section block', () => {
    const resolved = resolveCommunitySections(communityEvent(), [overrideEvent()], admins);
    expect(resolved.source).toBe('override');
    expect(resolved.author).toBe(ADMIN);
    expect(resolved.sections.map((s) => s.name)).toEqual(['Materialien']);
    expect(resolved.sections[0].access).toEqual({ tier: 'role', role: 'publisher' });
  });

  it('the newest valid override wins, tie-broken by the lower event id', () => {
    const older = overrideEvent({ created_at: 2000, id: '1'.repeat(64) });
    const newer = overrideEvent({
      pubkey: OTHER_ADMIN,
      created_at: 3000,
      id: '9'.repeat(64),
      tags: [
        ['d', COMMUNITY],
        ['content', 'Neuer Bereich'],
        ['k', '11']
      ]
    });
    expect(resolveCommunitySections(communityEvent(), [older, newer], admins).author).toBe(
      OTHER_ADMIN
    );

    // Same timestamp → lower id wins, so the choice is stable across clients.
    const tieLow = overrideEvent({ created_at: 3000, id: '1'.repeat(64), pubkey: ADMIN });
    const tieHigh = overrideEvent({ created_at: 3000, id: '9'.repeat(64), pubkey: OTHER_ADMIN });
    expect(resolveCommunitySections(communityEvent(), [tieHigh, tieLow], admins).author).toBe(
      ADMIN
    );
  });

  it('ignores invalid overrides entirely, falling back to the community event', () => {
    const byStranger = overrideEvent({ pubkey: STRANGER, created_at: 9000 });
    const resolved = resolveCommunitySections(communityEvent(), [byStranger], admins);
    expect(resolved.source).toBe('community');
    expect(resolved.sections.map((s) => s.name)).toEqual(['Learning', 'Calendar']);
  });

  it('an override older than the 10222 loses: the owner editing reasserts control', () => {
    const stale = overrideEvent({ created_at: 500 });
    const resolved = resolveCommunitySections(communityEvent([], 1000), [stale], admins);
    expect(resolved.source).toBe('community');
  });

  it('ignores overrides on open and closed communities', () => {
    // No membership pointer → open; there is no roster to judge authorship
    // against, so a 30223 has no standing.
    const open = {
      kind: 10222,
      pubkey: COMMUNITY,
      created_at: 1000,
      tags: [
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };
    expect(resolveCommunitySections(open, [overrideEvent()], admins).source).toBe('community');

    const closed = {
      kind: 10222,
      pubkey: COMMUNITY,
      created_at: 1000,
      tags: [
        ['concord', 'area1', GROUPS_RELAY],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };
    expect(resolveCommunitySections(closed, [overrideEvent()], admins).source).toBe('community');
  });

  it('an override ignores relay/profile-list tags even if one reaches a relay', () => {
    const smuggled = overrideEvent({
      created_at: 5000,
      tags: [
        ['d', COMMUNITY],
        ['content', 'Materialien'],
        ['k', '30142'],
        ['r', 'wss://evil.example/', 'content'],
        ['a', `30000:${STRANGER}:Materialien`, 'wss://evil.example/']
      ]
    });
    const section = resolveCommunitySections(communityEvent(), [smuggled], admins).sections[0];
    expect(section.relays).toEqual([]);
    expect(section.profileList).toBe(null);
  });

  it('a null community event resolves to no sections rather than throwing', () => {
    const resolved = resolveCommunitySections(null, [overrideEvent()], admins);
    expect(resolved.sections).toEqual([]);
    expect(resolved.source).toBe('community');
  });
});

// applySectionOverride swaps the section block inside the 10222 instead of
// changing every consumer's signature: tabs, gating, share pickers and the
// FAB all keep taking one community event and pick the override up for free.
// So what it must NOT disturb is everything else on that event.
describe('applySectionOverride', () => {
  it('yields an event whose sections are the override, without mutating the original', () => {
    const original = communityEvent();
    const originalTags = JSON.parse(JSON.stringify(original.tags));

    const { event, source, author } = applySectionOverride(original, [overrideEvent()], admins);

    expect(source).toBe('override');
    expect(author).toBe(ADMIN);
    expect(parseCommunityContentTypes(event).map((s) => s.name)).toEqual(['Materialien']);
    expect(original.tags).toEqual(originalTags);
    // Identity is untouched — this is still the community's own event.
    expect(event.pubkey).toBe(COMMUNITY);
    expect(event.kind).toBe(10222);
  });

  it('keeps pointer tags, so community type and roster still resolve', () => {
    // withMembershipPointer appends, so the pointer can sit AFTER the section
    // block — truncating at the first `content` tag would silently turn a
    // moderated community back into an open one.
    const trailingPointer = {
      kind: 10222,
      pubkey: COMMUNITY,
      created_at: 1000,
      tags: [
        ['content', 'Learning'],
        ['k', '30142'],
        ['membership', 'root1', GROUPS_RELAY]
      ]
    };
    const { event } = applySectionOverride(trailingPointer, [overrideEvent()], admins);

    expect(parseMembershipPointer(event)).toEqual({ id: 'root1', relay: GROUPS_RELAY });
    expect(deriveCommunityType(event)).toBe('moderated');
  });

  it('keeps community-level metadata: relays, blossom and the strict marker', () => {
    const rich = {
      kind: 10222,
      pubkey: COMMUNITY,
      created_at: 1000,
      tags: [
        ['membership', 'root1', GROUPS_RELAY],
        ['r', 'wss://community.example/'],
        ['r', 'wss://enforced.example/', 'enforced'],
        ['blossom', 'https://blossom.example/'],
        ['strict', 'content'],
        ['content', 'Learning'],
        ['k', '30142'],
        ['r', 'wss://section.example/', 'content']
      ]
    };
    const { event } = applySectionOverride(rich, [overrideEvent()], admins);

    const metadata = parseCommunityMetadata(event);
    expect(metadata.relays.map((/** @type {any} */ r) => r.url)).toEqual([
      'wss://community.example/',
      'wss://enforced.example/'
    ]);
    expect(metadata.blossomServers).toEqual(['https://blossom.example/']);
    expect(hasStrictContentMarker(event)).toBe(true);
    // The section-scoped relay went with the section block it belonged to.
    expect(parseCommunityContentTypes(event)[0].relays).toEqual([]);
  });

  it('returns the original event untouched when no override applies', () => {
    const original = communityEvent();
    const { event, source } = applySectionOverride(original, [], admins);
    expect(source).toBe('community');
    expect(event).toBe(original);
  });

  it('survives a null community event', () => {
    expect(applySectionOverride(null, [overrideEvent()], admins).event).toBe(null);
  });
});
