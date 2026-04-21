/**
 * Tests for isWikiIdentifier helper
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

// Test the function logic directly (avoids transitive imports needing window/DOM)
// Same implementation as in nostrUtils.js
/** @param {any} decoded */
function isWikiIdentifier(decoded) {
  return decoded.success && decoded.type === 'naddr' && decoded.data.kind === 30818;
}

describe('isWikiIdentifier', () => {
  it('returns true for decoded naddr with kind 30818', () => {
    const decoded = {
      success: true,
      type: 'naddr',
      data: { kind: 30818, pubkey: 'abc', identifier: 'test' }
    };
    expect(isWikiIdentifier(decoded)).toBe(true);
  });

  it('returns false for kind 30023 (article)', () => {
    const decoded = {
      success: true,
      type: 'naddr',
      data: { kind: 30023, pubkey: 'abc', identifier: 'test' }
    };
    expect(isWikiIdentifier(decoded)).toBe(false);
  });

  it('returns false for kind 31922 (calendar event)', () => {
    const decoded = {
      success: true,
      type: 'naddr',
      data: { kind: 31922, pubkey: 'abc', identifier: 'test' }
    };
    expect(isWikiIdentifier(decoded)).toBe(false);
  });

  it('returns false for npub type', () => {
    const decoded = {
      success: true,
      type: 'npub',
      data: 'abc123'
    };
    expect(isWikiIdentifier(decoded)).toBe(false);
  });

  it('returns false for nevent type', () => {
    const decoded = {
      success: true,
      type: 'nevent',
      data: { id: 'abc123' }
    };
    expect(isWikiIdentifier(decoded)).toBe(false);
  });

  it('returns false for failed decode', () => {
    const decoded = {
      success: false,
      error: 'Invalid identifier',
      identifier: 'bad'
    };
    expect(isWikiIdentifier(decoded)).toBe(false);
  });
});
