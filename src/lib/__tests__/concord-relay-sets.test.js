/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { mergeRelaySets } from '$lib/concord/relay-sets.js';

describe('mergeRelaySets', () => {
  it('returns an empty array when both inputs are empty', () => {
    expect(mergeRelaySets([], [])).toEqual([]);
  });

  it('handles undefined/null inputs as empty', () => {
    expect(mergeRelaySets(undefined, null)).toEqual([]);
    expect(mergeRelaySets(['wss://a.test'], undefined)).toEqual(['wss://a.test']);
    expect(mergeRelaySets(undefined, ['wss://a.test'])).toEqual(['wss://a.test']);
  });

  it('preserves primary order, then appends new fallback relays in fallback order', () => {
    const primary = ['wss://c.test', 'wss://a.test'];
    const fallback = ['wss://b.test', 'wss://d.test'];
    expect(mergeRelaySets(primary, fallback)).toEqual([
      'wss://c.test',
      'wss://a.test',
      'wss://b.test',
      'wss://d.test'
    ]);
  });

  it('dedupes a fallback relay already present in primary, keeping the primary spelling', () => {
    const primary = ['wss://relay.example.com/'];
    const fallback = ['wss://relay.example.com', 'wss://other.test'];
    expect(mergeRelaySets(primary, fallback)).toEqual([
      'wss://relay.example.com/',
      'wss://other.test'
    ]);
  });

  it('dedupes across case variants', () => {
    const primary = ['wss://RELAY.example.com'];
    const fallback = ['wss://relay.EXAMPLE.com'];
    expect(mergeRelaySets(primary, fallback)).toEqual(['wss://RELAY.example.com']);
  });

  it('dedupes duplicates within the same list', () => {
    const primary = ['wss://a.test', 'wss://a.test/'];
    expect(mergeRelaySets(primary, [])).toEqual(['wss://a.test']);
  });

  it('drops falsy entries', () => {
    expect(mergeRelaySets(/** @type {any} */ (['wss://a.test', '', undefined, null]), [])).toEqual([
      'wss://a.test'
    ]);
  });
});
