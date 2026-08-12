/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { deriveDefaultFormRef, applyDefaultFormRef } from '$lib/helpers/communityFormDefaults.js';

/**
 * Helper to create contentTypes test fixtures
 * @param {Array<[string, boolean, string]>} configs
 * @returns {Record<string, import('$lib/helpers/communityFormDefaults.js').ContentTypeConfig>}
 */
function makeTypes(configs) {
  /** @type {Record<string, import('$lib/helpers/communityFormDefaults.js').ContentTypeConfig>} */
  const types = {};
  for (const [key, enabled, formRef] of configs) {
    types[key] = { name: key, enabled, formRef, badges: { read: null, write: null }, relays: [] };
  }
  return types;
}

describe('deriveDefaultFormRef', () => {
  it('returns empty string when no types are gated', () => {
    const types = makeTypes([
      ['calendar', true, ''],
      ['chat', true, '']
    ]);
    expect(deriveDefaultFormRef(types)).toBe('');
  });

  it('returns the single gated formRef', () => {
    const types = makeTypes([
      ['calendar', true, '30168:pub:formA'],
      ['chat', true, '']
    ]);
    expect(deriveDefaultFormRef(types)).toBe('30168:pub:formA');
  });

  it('returns the most common formRef', () => {
    const types = makeTypes([
      ['calendar', true, '30168:pub:formA'],
      ['chat', true, '30168:pub:formB'],
      ['articles', true, '30168:pub:formA']
    ]);
    expect(deriveDefaultFormRef(types)).toBe('30168:pub:formA');
  });

  it('ignores disabled types', () => {
    const types = makeTypes([
      ['calendar', false, '30168:pub:formA'],
      ['chat', true, '30168:pub:formB']
    ]);
    expect(deriveDefaultFormRef(types)).toBe('30168:pub:formB');
  });

  it('breaks ties by first key in iteration order', () => {
    const types = makeTypes([
      ['calendar', true, '30168:pub:formA'],
      ['chat', true, '30168:pub:formB']
    ]);
    // calendar comes first, so formA wins the tie
    expect(deriveDefaultFormRef(types)).toBe('30168:pub:formA');
  });

  it('returns empty when all types are disabled', () => {
    const types = makeTypes([
      ['calendar', false, '30168:pub:formA'],
      ['chat', false, '30168:pub:formB']
    ]);
    expect(deriveDefaultFormRef(types)).toBe('');
  });
});

describe('applyDefaultFormRef', () => {
  it('updates types matching old default to new default', () => {
    const types = makeTypes([
      ['calendar', true, '30168:pub:formA'],
      ['chat', true, '30168:pub:formA']
    ]);
    const result = applyDefaultFormRef(types, '30168:pub:formA', '30168:pub:formB');
    expect(result.calendar.formRef).toBe('30168:pub:formB');
    expect(result.chat.formRef).toBe('30168:pub:formB');
  });

  it('does not touch types with explicit overrides', () => {
    const types = makeTypes([
      ['calendar', true, '30168:pub:formA'],
      ['chat', true, '30168:pub:formC']
    ]);
    const result = applyDefaultFormRef(types, '30168:pub:formA', '30168:pub:formB');
    expect(result.calendar.formRef).toBe('30168:pub:formB');
    expect(result.chat.formRef).toBe('30168:pub:formC');
  });

  it('does not touch disabled types', () => {
    const types = makeTypes([
      ['calendar', false, '30168:pub:formA'],
      ['chat', true, '30168:pub:formA']
    ]);
    const result = applyDefaultFormRef(types, '30168:pub:formA', '30168:pub:formB');
    expect(result.calendar.formRef).toBe('30168:pub:formA');
    expect(result.chat.formRef).toBe('30168:pub:formB');
  });

  it('handles switching from open to gated', () => {
    const types = makeTypes([
      ['calendar', true, ''],
      ['chat', true, '']
    ]);
    const result = applyDefaultFormRef(types, '', '30168:pub:formA');
    expect(result.calendar.formRef).toBe('30168:pub:formA');
    expect(result.chat.formRef).toBe('30168:pub:formA');
  });

  it('handles switching from gated to open', () => {
    const types = makeTypes([
      ['calendar', true, '30168:pub:formA'],
      ['chat', true, '30168:pub:formA']
    ]);
    const result = applyDefaultFormRef(types, '30168:pub:formA', '');
    expect(result.calendar.formRef).toBe('');
    expect(result.chat.formRef).toBe('');
  });

  it('returns a new object without mutating the original', () => {
    const types = makeTypes([['calendar', true, '30168:pub:formA']]);
    const result = applyDefaultFormRef(types, '30168:pub:formA', '30168:pub:formB');
    expect(result).not.toBe(types);
    expect(types.calendar.formRef).toBe('30168:pub:formA');
  });
});

// --- getCommunityWideFormRef tests ---
import { getCommunityWideFormRef } from '$lib/helpers/communityFormDefaults.js';

/**
 * Helper to build a mock profileAccess with getFormRef
 * @param {Record<string, string | null>} formRefs - section name -> formRef
 */
function makeProfileAccess(formRefs) {
  return {
    /** @param {string} name */
    getFormRef(name) {
      return formRefs[name] ?? null;
    }
  };
}

/**
 * Helper to build a kind 10222 event with content sections
 * @param {Array<{ name: string, profileList?: string, access?: {tier: 'all'}|{tier: 'members'}|{tier: 'role', role: string} }>} sections
 */
function makeCommunityEvent(sections) {
  /** @type {string[][]} */
  const tags = [];
  for (const s of sections) {
    tags.push(['content', s.name]);
    tags.push(['k', '31922']);
    if (s.profileList) {
      tags.push(['a', s.profileList]);
    }
    if (s.access && s.access.tier !== 'all') {
      if (s.access.tier === 'members') {
        tags.push(['access', 'members']);
      } else if (s.access.tier === 'role') {
        tags.push(['access', 'role', s.access.role]);
      }
    }
  }
  return { kind: 10222, tags, pubkey: 'abc', content: '', created_at: 0, id: 'x', sig: 'x' };
}

describe('getCommunityWideFormRef', () => {
  it('returns null for open community (no profile lists)', () => {
    const access = makeProfileAccess({});
    const event = makeCommunityEvent([{ name: 'calendar' }, { name: 'chat' }]);
    expect(getCommunityWideFormRef(access, event)).toBeNull();
  });

  it('returns the shared formRef when all gated sections have the same form', () => {
    const access = makeProfileAccess({
      calendar: '30168:pub:formA',
      chat: '30168:pub:formA'
    });
    const event = makeCommunityEvent([
      { name: 'calendar', profileList: '30000:pub:cal-list' },
      { name: 'chat', profileList: '30000:pub:chat-list' }
    ]);
    expect(getCommunityWideFormRef(access, event)).toBe('30168:pub:formA');
  });

  it('returns null when gated sections have different forms', () => {
    const access = makeProfileAccess({
      calendar: '30168:pub:formA',
      chat: '30168:pub:formB'
    });
    const event = makeCommunityEvent([
      { name: 'calendar', profileList: '30000:pub:cal-list' },
      { name: 'chat', profileList: '30000:pub:chat-list' }
    ]);
    expect(getCommunityWideFormRef(access, event)).toBeNull();
  });

  it('returns the formRef for a single gated section', () => {
    const access = makeProfileAccess({
      calendar: '30168:pub:formA'
    });
    const event = makeCommunityEvent([
      { name: 'calendar', profileList: '30000:pub:cal-list' },
      { name: 'chat' }
    ]);
    expect(getCommunityWideFormRef(access, event)).toBe('30168:pub:formA');
  });

  it('returns null when a gated section has no form', () => {
    const access = makeProfileAccess({
      calendar: '30168:pub:formA',
      chat: null
    });
    const event = makeCommunityEvent([
      { name: 'calendar', profileList: '30000:pub:cal-list' },
      { name: 'chat', profileList: '30000:pub:chat-list' }
    ]);
    expect(getCommunityWideFormRef(access, event)).toBeNull();
  });

  it('returns null for null/undefined inputs', () => {
    expect(getCommunityWideFormRef(null, null)).toBeNull();
    expect(getCommunityWideFormRef(makeProfileAccess({}), null)).toBeNull();
  });

  // --- Access-tier gating tests (moderated communities) ---
  it('recognizes access-tier gated sections (members tier)', () => {
    const access = makeProfileAccess({
      chat: '30168:pub:formA'
    });
    const event = makeCommunityEvent([{ name: 'chat', access: { tier: 'members' } }]);
    expect(getCommunityWideFormRef(access, event)).toBe('30168:pub:formA');
  });

  it('recognizes access-tier gated sections (role tier)', () => {
    const access = makeProfileAccess({
      chat: '30168:pub:formA'
    });
    const event = makeCommunityEvent([
      { name: 'chat', access: { tier: 'role', role: 'moderator' } }
    ]);
    expect(getCommunityWideFormRef(access, event)).toBe('30168:pub:formA');
  });

  it('ignores open sections (tier all) and returns null when no gated sections', () => {
    const access = makeProfileAccess({
      chat: '30168:pub:formA'
    });
    const event = makeCommunityEvent([{ name: 'chat', access: { tier: 'all' } }]);
    expect(getCommunityWideFormRef(access, event)).toBeNull();
  });

  it('handles mixed legacy profileList and access-tier sections', () => {
    const access = makeProfileAccess({
      calendar: '30168:pub:formA',
      chat: '30168:pub:formA'
    });
    const event = makeCommunityEvent([
      { name: 'calendar', profileList: '30000:pub:cal-list' },
      { name: 'chat', access: { tier: 'members' } }
    ]);
    expect(getCommunityWideFormRef(access, event)).toBe('30168:pub:formA');
  });

  it('returns null when mixed gating sources have different forms', () => {
    const access = makeProfileAccess({
      calendar: '30168:pub:formA',
      chat: '30168:pub:formB'
    });
    const event = makeCommunityEvent([
      { name: 'calendar', profileList: '30000:pub:cal-list' },
      { name: 'chat', access: { tier: 'members' } }
    ]);
    expect(getCommunityWideFormRef(access, event)).toBeNull();
  });

  it('returns null for access-tier section with no form', () => {
    const access = makeProfileAccess({
      chat: null
    });
    const event = makeCommunityEvent([{ name: 'chat', access: { tier: 'members' } }]);
    expect(getCommunityWideFormRef(access, event)).toBeNull();
  });
});
