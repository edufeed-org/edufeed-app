/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import {
  buildCommunityDefinitionTags,
  createDefaultContentTypes,
  preservePointerTags,
  applyParsedAccessTiers,
  contentTypesFromEvent,
  sectionsFromContentTypes,
  mergeSectionProfileListTags
} from '$lib/helpers/communityTagBuilder.js';

describe('buildCommunityDefinitionTags', () => {
  const baseCommunityData = {
    relays: ['wss://relay.example.com'],
    blossomServers: [],
    location: '',
    description: '',
    contentTypes: {
      calendar: {
        name: 'Calendar',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      },
      chat: {
        name: 'Chat',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: ''
      }
    }
  };

  describe('new-spec mode (communityPubkey set)', () => {
    const communityPubkey = 'abc123';

    test('emits profile list a-tag when formRef is set', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: '30168:abc123:my-form'
          },
          chat: {
            name: 'Chat',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      // Calendar has formRef → should get profile list a-tag
      const calendarATags = tags.filter(
        (t) => t[0] === 'a' && t[1] === `30000:${communityPubkey}:Calendar`
      );
      expect(calendarATags).toHaveLength(1);
    });

    test('omits profile list a-tag when formRef is empty', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          },
          chat: {
            name: 'Chat',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      // No formRef → no profile list a-tags
      const aTags = tags.filter((t) => t[0] === 'a');
      expect(aTags).toHaveLength(0);
    });

    test('omits profile list a-tag when formRef is null/undefined', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: []
            // formRef not set at all
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      const aTags = tags.filter((t) => t[0] === 'a');
      expect(aTags).toHaveLength(0);
    });

    test('emits form-marked a-tag with relay hint when formRef and formRefRelay are set', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: '30168:abc123:my-form',
            formRefRelay: 'wss://forms.example'
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      const formMarked = tags.filter((t) => t[0] === 'a' && t[3] === 'form');
      expect(formMarked).toHaveLength(1);
      expect(formMarked[0]).toEqual(['a', '30168:abc123:my-form', 'wss://forms.example', 'form']);
    });

    test('form-marked a-tag falls back to empty relay hint when formRefRelay is absent', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: '30168:abc123:my-form'
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });
      const formMarked = tags.filter((t) => t[0] === 'a' && t[3] === 'form');
      expect(formMarked).toHaveLength(1);
      expect(formMarked[0]).toEqual(['a', '30168:abc123:my-form', '', 'form']);
    });

    test('does not emit form-marked a-tag when formRef is empty', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });
      const formMarked = tags.filter((t) => t[0] === 'a' && t[3] === 'form');
      expect(formMarked).toHaveLength(0);
    });

    test('emits profile list a-tag only for sections with formRef', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: '30168:abc123:apply-form'
          },
          chat: {
            name: 'Chat',
            enabled: true,
            badges: { read: null, write: null },
            relays: [],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, { communityPubkey });

      const profileListATags = tags.filter((t) => t[0] === 'a' && t[1]?.startsWith('30000:'));
      expect(profileListATags).toHaveLength(1);
      expect(profileListATags[0][1]).toBe(`30000:${communityPubkey}:Calendar`);
    });
  });

  describe('old-spec mode (no communityPubkey)', () => {
    test('emits badge a-tags for old-spec communities', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: '30009:issuer:read-badge', write: '30009:issuer:write-badge' },
            relays: ['wss://content-relay.example.com'],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, {});

      // Old-spec: badge a-tags with read/write qualifiers
      const aTags = tags.filter((t) => t[0] === 'a');
      expect(aTags).toHaveLength(2);
      expect(aTags).toContainEqual(['a', '30009:issuer:write-badge', 'write']);
      expect(aTags).toContainEqual(['a', '30009:issuer:read-badge', 'read']);
    });

    test('emits per-section relays in old-spec mode', () => {
      const data = {
        ...baseCommunityData,
        contentTypes: {
          calendar: {
            name: 'Calendar',
            enabled: true,
            badges: { read: null, write: null },
            relays: ['wss://content-relay.example.com'],
            formRef: ''
          }
        }
      };

      const tags = buildCommunityDefinitionTags(data, {});

      const rTags = tags.filter((t) => t[0] === 'r' && t[2] === 'content');
      expect(rTags).toHaveLength(1);
      expect(rTags[0][1]).toBe('wss://content-relay.example.com');
    });
  });

  describe('access tier emission', () => {
    /**
     * @param {{tier: 'all'}|{tier: 'members'}|{tier: 'role', role: string}|undefined} access
     */
    const data = (access) => ({
      relays: [],
      blossomServers: [],
      location: '',
      description: '',
      contentTypes: {
        learning: {
          name: 'Learning',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: '',
          access
        }
      }
    });
    const PK = 'a'.repeat(64);

    test('emits ["access","members"] inside the section (new-spec only)', () => {
      const tags = buildCommunityDefinitionTags(data({ tier: 'members' }), { communityPubkey: PK });
      const ci = tags.findIndex((t) => t[0] === 'content' && t[1] === 'Learning');
      const section = tags.slice(ci + 1);
      expect(section).toContainEqual(['access', 'members']);
    });

    test('emits ["access","role",<name>]', () => {
      const tags = buildCommunityDefinitionTags(data({ tier: 'role', role: 'lehrkraft' }), {
        communityPubkey: PK
      });
      expect(tags).toContainEqual(['access', 'role', 'lehrkraft']);
    });

    test('emits nothing for tier "all", missing access, or old-spec mode', () => {
      const all = buildCommunityDefinitionTags(data({ tier: 'all' }), { communityPubkey: PK });
      expect(all.some((t) => t[0] === 'access')).toBe(false);
      const missing = buildCommunityDefinitionTags(data(undefined), { communityPubkey: PK });
      expect(missing.some((t) => t[0] === 'access')).toBe(false);
      const oldSpec = buildCommunityDefinitionTags(data({ tier: 'members' }), {});
      expect(oldSpec.some((t) => t[0] === 'access')).toBe(false);
    });

    test('createDefaultContentTypes seeds access tier "all"', () => {
      const cts = createDefaultContentTypes(['learning']);
      expect(cts.learning.access).toEqual({ tier: 'all' });
    });

    test('never emits access role tags with empty/missing role (fail open)', () => {
      // Deliberately off-type: role missing on purpose to exercise fail-open
      // behavior. Cast at the fixture rather than widening the production type.
      const missingRole = buildCommunityDefinitionTags(
        data(/** @type {any} */ ({ tier: 'role' })),
        { communityPubkey: PK }
      );
      expect(missingRole.some((t) => t[0] === 'access')).toBe(false);

      const emptyRole = buildCommunityDefinitionTags(data({ tier: 'role', role: '  ' }), {
        communityPubkey: PK
      });
      expect(emptyRole.some((t) => t[0] === 'access')).toBe(false);
    });
  });
});

describe('membership pointer emission', () => {
  const PK = 'a'.repeat(64);
  const RELAY = 'wss://groups.example.com';
  /** @type {import('$lib/helpers/communityTagBuilder').CommunityFormData} */
  const data = {
    relays: ['wss://relay.example.com'],
    blossomServers: [],
    location: '',
    description: '',
    contentTypes: {
      learning: {
        name: 'Learning',
        enabled: true,
        badges: { read: null, write: null },
        relays: [],
        formRef: '',
        access: { tier: 'members' }
      }
    }
  };

  // The `application` build opt is gone with the Beitrittsformular layer
  // (2026-08-18) — the builder only ever emits the membership pointer now.
  // Legacy `application` tags on existing events round-trip via
  // preservePointerTags (covered below), never via this builder.
  test('emits the membership pointer before the strict marker and all content sections', () => {
    const tags = buildCommunityDefinitionTags(data, {
      communityPubkey: PK,
      membership: { id: 'root1', relay: RELAY }
    });
    const membershipIdx = tags.findIndex((t) => t[0] === 'membership');
    const strictIdx = tags.findIndex((t) => t[0] === 'strict');
    const contentIdx = tags.findIndex((t) => t[0] === 'content');
    expect(tags[membershipIdx]).toEqual(['membership', 'root1', RELAY]);
    expect(membershipIdx).toBeLessThan(strictIdx);
    expect(strictIdx).toBeLessThan(contentIdx);
    expect(tags.some((t) => t[0] === 'application')).toBe(false);
  });

  test('omitted opts emit no pointers', () => {
    const none = buildCommunityDefinitionTags(data, { communityPubkey: PK });
    expect(none.some((t) => t[0] === 'membership' || t[0] === 'application')).toBe(false);
  });

  test('never emits pointers in old-spec mode', () => {
    const tags = buildCommunityDefinitionTags(data, {
      membership: { id: 'root1', relay: RELAY }
    });
    expect(tags.some((t) => t[0] === 'membership')).toBe(false);
  });
});

describe('preservePointerTags', () => {
  const RELAY = 'wss://groups.example.com';
  const source = [
    ['r', 'wss://relay.example.com'],
    ['membership', 'root1', RELAY],
    ['application', '30168:aa:beitritt', RELAY],
    ['concord', 'c'.repeat(64), RELAY],
    ['group', 'chan1', RELAY, 'Kanal', 'members'],
    ['content', 'Learning'],
    ['k', '30142']
  ];
  const rebuilt = [
    ['r', 'wss://relay.example.com'],
    ['strict', 'content'],
    ['content', 'Learning'],
    ['k', '30142']
  ];

  test('prepends every pointer tag from the source, before all rebuilt tags', () => {
    const out = preservePointerTags(source, rebuilt);
    expect(out.slice(0, 4)).toEqual([
      ['membership', 'root1', RELAY],
      ['application', '30168:aa:beitritt', RELAY],
      ['concord', 'c'.repeat(64), RELAY],
      ['group', 'chan1', RELAY, 'Kanal', 'members']
    ]);
    expect(out.slice(4)).toEqual(rebuilt);
    expect(rebuilt).toHaveLength(4); // inputs untouched
  });

  test('is a no-op prepend when the source has no pointer tags', () => {
    expect(preservePointerTags([['r', 'wss://x.example.com']], rebuilt)).toEqual(rebuilt);
  });

  test('tolerates malformed source entries without throwing', () => {
    const out = preservePointerTags(
      /** @type {any} */ ([null, ['membership', 'x', RELAY]]),
      rebuilt
    );
    expect(out[0]).toEqual(['membership', 'x', RELAY]);
  });
});

describe('applyParsedAccessTiers', () => {
  const PK = 'b'.repeat(64);

  test('round-trips access tiers through build → parse → copy, matched by section name', () => {
    // Build a moderated community's tags with two gated sections.
    /** @type {import('$lib/helpers/communityTagBuilder').CommunityFormData} */
    const data = {
      relays: ['wss://relay.example.com'],
      blossomServers: [],
      location: '',
      description: '',
      contentTypes: {
        learning: {
          name: 'Learning',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: '',
          access: { tier: 'role', role: 'lehrkraft' }
        },
        chat: {
          name: 'Chat',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: '',
          access: { tier: 'members' }
        },
        articles: {
          name: 'Articles',
          enabled: true,
          badges: { read: null, write: null },
          relays: [],
          formRef: ''
          // no access set → defaults to 'all' below via createDefaultContentTypes
        }
      }
    };
    const tags = buildCommunityDefinitionTags(data, {
      communityPubkey: PK,
      membership: { id: 'root1', relay: 'wss://groups.example.com' }
    });
    const communityEvent = { tags };

    // Simulate the edit modal's load effect: it starts from fresh defaults
    // (as its own parse loop does) and copies the parsed tiers on top.
    const freshContentTypes = createDefaultContentTypes(['learning', 'chat', 'articles']);
    const withAccess = applyParsedAccessTiers(freshContentTypes, communityEvent);

    expect(withAccess.learning.access).toEqual({ tier: 'role', role: 'lehrkraft' });
    expect(withAccess.chat.access).toEqual({ tier: 'members' });
    expect(withAccess.articles.access).toEqual({ tier: 'all' });
  });

  test('ignores content-type keys whose display name has no matching section', () => {
    const contentTypes = createDefaultContentTypes(['learning']);
    contentTypes.learning.name = 'Renamed Section';
    const communityEvent = {
      tags: [
        ['content', 'Learning'],
        ['access', 'members'],
        ['k', '30142']
      ]
    };

    const out = applyParsedAccessTiers(contentTypes, communityEvent);
    // Name mismatch ('Renamed Section' vs 'Learning') → untouched default.
    expect(out.learning.access).toEqual({ tier: 'all' });
  });

  test('event with no access tags leaves every entry at the default "all" tier', () => {
    const contentTypes = createDefaultContentTypes(['learning', 'chat']);
    const communityEvent = {
      tags: [
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };

    const out = applyParsedAccessTiers(contentTypes, communityEvent);
    expect(out.learning.access).toEqual({ tier: 'all' });
    expect(out.chat.access).toEqual({ tier: 'all' });
  });

  test('does not mutate the input contentTypes record', () => {
    const contentTypes = createDefaultContentTypes(['learning']);
    const communityEvent = {
      tags: [
        ['content', 'Learning'],
        ['access', 'members']
      ]
    };

    applyParsedAccessTiers(contentTypes, communityEvent);
    expect(contentTypes.learning.access).toEqual({ tier: 'all' });
  });
});

// contentTypesFromEvent is the read half of the chip picker, extracted from
// CommunityBasicsForm so the owner form and the admins' section-override pane
// seed from ONE implementation.
describe('contentTypesFromEvent', () => {
  test('enables the sections the event declares and keeps their display names', () => {
    const event = {
      kind: 10222,
      tags: [
        ['strict', 'content'],
        ['content', 'Materialien'],
        ['k', '30142'],
        ['access', 'role', 'publisher'],
        ['content', 'Termine'],
        ['k', '31923']
      ]
    };

    const result = contentTypesFromEvent(event);
    expect(result.learning.enabled).toBe(true);
    expect(result.learning.name).toBe('Materialien');
    expect(result.learning.access).toEqual({ tier: 'role', role: 'publisher' });
    expect(result.calendar.enabled).toBe(true);
    expect(result.calendar.name).toBe('Termine');
    expect(result.chat.enabled).toBe(false);
  });

  test('a legacy event without the strict marker fails open — everything enabled', () => {
    // Matches the long-standing rule in hasStrictContentMarker: declarations
    // on a pre-strict community are advisory, so saving must preserve the
    // status quo rather than silently switching sections off.
    const legacy = {
      kind: 10222,
      tags: [
        ['content', 'Chat'],
        ['k', '9']
      ]
    };
    const result = contentTypesFromEvent(legacy);
    expect(result.chat.enabled).toBe(true);
    expect(result.learning.enabled).toBe(true);
    // Meet is the exception: no LiveKit URL, no Meet.
    expect(result.meet.enabled).toBe(false);
  });

  test('meet fails open only when the community declares a livekit url', () => {
    const withLivekit = {
      kind: 10222,
      tags: [
        ['livekit', 'wss://live.example/'],
        ['content', 'Chat'],
        ['k', '9']
      ]
    };
    expect(contentTypesFromEvent(withLivekit).meet.enabled).toBe(true);
  });

  test('a null event yields the defaults with nothing enabled', () => {
    const result = contentTypesFromEvent(null);
    expect(Object.values(result).every((ct) => !ct.enabled)).toBe(true);
  });
});

// sectionsFromContentTypes is the write half: the chip record back into the
// {name, kinds, access} shape buildSectionOverrideTemplate consumes.
describe('sectionsFromContentTypes', () => {
  test('emits only enabled sections, with their canonical kinds and tier', () => {
    const contentTypes = createDefaultContentTypes(['learning', 'chat']);
    contentTypes.learning.name = 'Materialien';
    contentTypes.learning.access = { tier: 'role', role: 'publisher' };

    expect(sectionsFromContentTypes(contentTypes)).toEqual([
      { name: 'Chat', kinds: [9], access: { tier: 'all' } },
      { name: 'Materialien', kinds: [30142], access: { tier: 'role', role: 'publisher' } }
    ]);
  });

  test('round-trips through contentTypesFromEvent', () => {
    const event = {
      kind: 10222,
      tags: [
        ['strict', 'content'],
        ['content', 'Materialien'],
        ['k', '30142'],
        ['access', 'members']
      ]
    };
    const sections = sectionsFromContentTypes(contentTypesFromEvent(event));
    expect(sections).toEqual([
      { name: 'Materialien', kinds: [30142], access: { tier: 'members' } }
    ]);
  });
});

// mergeSectionProfileListTags — save() republishes each form-gated section's
// kind-30000 profile list; the merge must preserve every approved member's
// p-tag (and any other tags) instead of rebuilding from just d + form.
describe('mergeSectionProfileListTags', () => {
  test('preserves existing p-tags and foreign tags, replacing only d and form', () => {
    const existing = [
      ['d', 'Materialien'],
      ['p', 'aaaa'],
      ['p', 'bbbb', 'wss://relay.example.com'],
      ['form', '30168:pk:old-form'],
      ['title', 'Publisher']
    ];
    expect(mergeSectionProfileListTags(existing, 'Materialien', '30168:pk:new-form')).toEqual([
      ['d', 'Materialien'],
      ['p', 'aaaa'],
      ['p', 'bbbb', 'wss://relay.example.com'],
      ['title', 'Publisher'],
      ['form', '30168:pk:new-form']
    ]);
  });

  test('builds the minimal list when there is no existing event', () => {
    expect(mergeSectionProfileListTags(undefined, 'Chat', '30168:pk:f')).toEqual([
      ['d', 'Chat'],
      ['form', '30168:pk:f']
    ]);
  });

  test('ignores malformed tag entries from the network', () => {
    const existing = [['d', 'X'], 'garbage', null, ['p', 'cccc']];
    expect(mergeSectionProfileListTags(/** @type {any} */ (existing), 'X', '30168:pk:f')).toEqual([
      ['d', 'X'],
      ['p', 'cccc'],
      ['form', '30168:pk:f']
    ]);
  });
});
