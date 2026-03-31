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
