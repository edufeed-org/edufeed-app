/**
 * Tests for isArticleIdentifier (kind 30023) and isAMBResourceIdentifier (kind 30142)
 * helpers in $lib/helpers/nostrUtils.js. The helpers gate which rich-preview
 * component NostrIdentifier renders for naddr references.
 *
 * Like wiki-identifier.test.js, the function logic is duplicated here so the
 * test runs under the node environment without pulling in the EventStore /
 * relay-loader transitive imports from nostrUtils.js.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

/** @param {any} decoded */
function isArticleIdentifier(decoded) {
  return decoded.success && decoded.type === 'naddr' && decoded.data.kind === 30023;
}

/** @param {any} decoded */
function isAMBResourceIdentifier(decoded) {
  return decoded.success && decoded.type === 'naddr' && decoded.data.kind === 30142;
}

describe('isArticleIdentifier', () => {
  it('returns true for decoded naddr with kind 30023', () => {
    const decoded = {
      success: true,
      type: 'naddr',
      data: { kind: 30023, pubkey: 'abc', identifier: 'test' }
    };
    expect(isArticleIdentifier(decoded)).toBe(true);
  });

  it('returns false for kind 30142 (AMB)', () => {
    const decoded = {
      success: true,
      type: 'naddr',
      data: { kind: 30142, pubkey: 'abc', identifier: 'test' }
    };
    expect(isArticleIdentifier(decoded)).toBe(false);
  });

  it('returns false for kind 30818 (wiki)', () => {
    const decoded = {
      success: true,
      type: 'naddr',
      data: { kind: 30818, pubkey: 'abc', identifier: 'test' }
    };
    expect(isArticleIdentifier(decoded)).toBe(false);
  });

  it('returns false for npub type', () => {
    const decoded = { success: true, type: 'npub', data: 'abc' };
    expect(isArticleIdentifier(decoded)).toBe(false);
  });

  it('returns false for failed decode', () => {
    const decoded = { success: false, error: 'bad', identifier: 'bad' };
    expect(isArticleIdentifier(decoded)).toBe(false);
  });
});

describe('isAMBResourceIdentifier', () => {
  it('returns true for decoded naddr with kind 30142', () => {
    const decoded = {
      success: true,
      type: 'naddr',
      data: { kind: 30142, pubkey: 'abc', identifier: 'test' }
    };
    expect(isAMBResourceIdentifier(decoded)).toBe(true);
  });

  it('returns false for kind 30023 (article)', () => {
    const decoded = {
      success: true,
      type: 'naddr',
      data: { kind: 30023, pubkey: 'abc', identifier: 'test' }
    };
    expect(isAMBResourceIdentifier(decoded)).toBe(false);
  });

  it('returns false for kind 31922 (calendar event)', () => {
    const decoded = {
      success: true,
      type: 'naddr',
      data: { kind: 31922, pubkey: 'abc', identifier: 'test' }
    };
    expect(isAMBResourceIdentifier(decoded)).toBe(false);
  });

  it('returns false for npub type', () => {
    const decoded = { success: true, type: 'npub', data: 'abc' };
    expect(isAMBResourceIdentifier(decoded)).toBe(false);
  });

  it('returns false for failed decode', () => {
    const decoded = { success: false, error: 'bad', identifier: 'bad' };
    expect(isAMBResourceIdentifier(decoded)).toBe(false);
  });
});
