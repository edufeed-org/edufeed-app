/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  parseCommunityContentTypes,
  getPreferredFormForKind,
  hasStrictContentMarker,
  sectionIsGated
} from '../helpers/communityRelays.js';

/**
 * Minimal community event fixture with a single content section that
 * advertises a preferred form via ["a","30168:<pub>:<d>",relay,"form"].
 */
function buildCommunityEventWithForm() {
  const formPubkey = 'b'.repeat(64);
  const formAddress = `30168:${formPubkey}:amb-full`;
  const formRelay = 'wss://forms.example';

  return {
    kind: 10222,
    pubkey: 'a'.repeat(64),
    tags: [
      ['r', 'wss://community.example'],
      ['content', 'Resources'],
      ['k', '30142'],
      ['a', formAddress, formRelay, 'form'],
      // A badge a-tag should NOT be treated as a form ref
      ['a', '30009:cccc:badge-x', 'write'],
      ['content', 'Calendar'],
      ['k', '31923']
    ]
  };
}

describe('parseCommunityContentTypes: form-marked a-tag', () => {
  it('captures formRef and formRefRelay for the content section that declares it', () => {
    const event = buildCommunityEventWithForm();
    const sections = parseCommunityContentTypes(event);

    const resources = /** @type {any} */ (sections.find((s) => s.name === 'Resources'));
    expect(resources, 'expected Resources section').toBeTruthy();
    expect(resources.formRef).toBe(`30168:${'b'.repeat(64)}:amb-full`);
    expect(resources.formRefRelay).toBe('wss://forms.example');

    // Other sections should have null formRef
    const calendar = /** @type {any} */ (sections.find((s) => s.name === 'Calendar'));
    expect(calendar.formRef).toBeNull();
    expect(calendar.formRefRelay).toBeNull();
  });

  it('ignores 30168 a-tags without the "form" qualifier', () => {
    const event = {
      kind: 10222,
      pubkey: 'a'.repeat(64),
      tags: [
        ['content', 'Resources'],
        ['k', '30142'],
        // Missing the "form" marker in position 3
        ['a', `30168:${'b'.repeat(64)}:amb-full`, 'wss://forms.example']
      ]
    };
    const sections = parseCommunityContentTypes(event);
    expect(sections[0].formRef).toBeNull();
  });
});

describe('getPreferredFormForKind', () => {
  it('returns { address, relay } when the kind has a preferred form', () => {
    const event = buildCommunityEventWithForm();
    const pref = getPreferredFormForKind(event, 30142);
    expect(pref).toEqual({
      address: `30168:${'b'.repeat(64)}:amb-full`,
      relay: 'wss://forms.example'
    });
  });

  it('returns null when the kind is not covered by any content section', () => {
    const event = buildCommunityEventWithForm();
    expect(getPreferredFormForKind(event, 1)).toBeNull();
  });

  it('returns null when the content section has no form declared', () => {
    const event = buildCommunityEventWithForm();
    expect(getPreferredFormForKind(event, 31923)).toBeNull();
  });

  it('returns null when the community event is null', () => {
    expect(getPreferredFormForKind(null, 30142)).toBeNull();
  });
});

describe('hasStrictContentMarker', () => {
  it('returns true when the event carries ["strict", "content"]', () => {
    const event = { kind: 10222, tags: [['strict', 'content']] };
    expect(hasStrictContentMarker(event)).toBe(true);
  });

  it('returns false for legacy events without the marker', () => {
    const event = {
      kind: 10222,
      tags: [
        ['content', 'Chat'],
        ['k', '9']
      ]
    };
    expect(hasStrictContentMarker(event)).toBe(false);
  });

  it('returns false for other strict scopes', () => {
    const event = { kind: 10222, tags: [['strict', 'relays']] };
    expect(hasStrictContentMarker(event)).toBe(false);
  });

  it('returns false for null/undefined events', () => {
    expect(hasStrictContentMarker(null)).toBe(false);
    expect(hasStrictContentMarker(undefined)).toBe(false);
  });
});

describe('access section tiers (communikey-groups NIP draft)', () => {
  const base = (extra) => ({
    kind: 10222,
    tags: [['content', 'Learning'], ['k', '30142'], ...extra, ['content', 'Chat'], ['k', '9']]
  });

  it('defaults to tier "all" when no access tag is present', () => {
    const [learning, chat] = parseCommunityContentTypes(base([]));
    expect(learning.access).toEqual({ tier: 'all' });
    expect(chat.access).toEqual({ tier: 'all' });
  });

  it('parses ["access","members"] scoped to its section only', () => {
    const [learning, chat] = parseCommunityContentTypes(base([['access', 'members']]));
    expect(learning.access).toEqual({ tier: 'members' });
    expect(chat.access).toEqual({ tier: 'all' });
  });

  it('parses ["access","role",<name>]', () => {
    const [learning] = parseCommunityContentTypes(base([['access', 'role', 'lehrkraft']]));
    expect(learning.access).toEqual({ tier: 'role', role: 'lehrkraft' });
  });

  it('fails open on malformed access tags; first valid tag wins', () => {
    expect(parseCommunityContentTypes(base([['access', 'bogus']]))[0].access).toEqual({
      tier: 'all'
    });
    expect(parseCommunityContentTypes(base([['access', 'role', '  ']]))[0].access).toEqual({
      tier: 'all'
    });
    expect(
      parseCommunityContentTypes(
        base([
          ['access', 'members'],
          ['access', 'role', 'x']
        ])
      )[0].access
    ).toEqual({ tier: 'members' });
  });

  it('ignores access tags before any content section', () => {
    const sections = parseCommunityContentTypes({
      kind: 10222,
      tags: [
        ['access', 'members'],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    });
    expect(sections[0].access).toEqual({ tier: 'all' });
  });
});

describe('sectionIsGated', () => {
  it('true for legacy profile-list sections and for non-all access tiers', () => {
    expect(sectionIsGated({ profileList: '30000:x:y', access: { tier: 'all' } })).toBe(true);
    expect(sectionIsGated({ profileList: null, access: { tier: 'members' } })).toBe(true);
    expect(sectionIsGated({ profileList: null, access: { tier: 'role', role: 'r' } })).toBe(true);
  });
  it('false for open sections and robust against missing access field', () => {
    expect(sectionIsGated({ profileList: null, access: { tier: 'all' } })).toBe(false);
    expect(sectionIsGated({ profileList: null })).toBe(false);
    expect(sectionIsGated(null)).toBe(false);
  });
});
