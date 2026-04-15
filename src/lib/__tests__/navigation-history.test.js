/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';

describe('navigationHistory', () => {
  /** @type {import('../helpers/navigationHistory.js').recordNavigation} */
  let recordNavigation;
  /** @type {import('../helpers/navigationHistory.js').getHasHistory} */
  let getHasHistory;
  /** @type {import('../helpers/navigationHistory.js')._reset} */
  let _reset;

  beforeEach(async () => {
    const mod = await import('../helpers/navigationHistory.js');
    recordNavigation = mod.recordNavigation;
    getHasHistory = mod.getHasHistory;
    _reset = mod._reset;
    _reset();
  });

  it('returns false when no navigation recorded', () => {
    expect(getHasHistory()).toBe(false);
  });

  it('returns true after recording a navigation', () => {
    recordNavigation({ url: new URL('http://localhost/c/') });
    expect(getHasHistory()).toBe(true);
  });

  it('stays false when from is null', () => {
    recordNavigation(null);
    expect(getHasHistory()).toBe(false);
  });

  it('stays false when from is undefined', () => {
    recordNavigation(undefined);
    expect(getHasHistory()).toBe(false);
  });

  it('stays true after multiple navigations', () => {
    recordNavigation({ url: new URL('http://localhost/first') });
    recordNavigation({ url: new URL('http://localhost/second') });
    expect(getHasHistory()).toBe(true);
  });

  it('resets to false with _reset()', () => {
    recordNavigation({ url: new URL('http://localhost/c/') });
    expect(getHasHistory()).toBe(true);
    _reset();
    expect(getHasHistory()).toBe(false);
  });
});

describe('getFallbackRoute', () => {
  /** @type {import('../helpers/navigationHistory.js').getFallbackRoute} */
  let getFallbackRoute;

  beforeEach(async () => {
    const mod = await import('../helpers/navigationHistory.js');
    getFallbackRoute = mod.getFallbackRoute;
  });

  it('returns / for null event', () => {
    expect(getFallbackRoute(null)).toBe('/');
  });

  it('returns / for undefined event', () => {
    expect(getFallbackRoute(undefined)).toBe('/');
  });

  it('returns community route for event with h-tag', () => {
    const event = {
      kind: 1,
      tags: [['h', 'a'.repeat(64)]],
      id: '',
      pubkey: '',
      created_at: 0,
      content: '',
      sig: ''
    };
    const route = getFallbackRoute(event);
    expect(route).toMatch(/^\/c\/npub1/);
  });

  it('returns /calendar for kind 31922', () => {
    const event = {
      kind: 31922,
      tags: [],
      id: '',
      pubkey: '',
      created_at: 0,
      content: '',
      sig: ''
    };
    expect(getFallbackRoute(event)).toBe('/calendar');
  });

  it('returns /calendar for kind 31923', () => {
    const event = {
      kind: 31923,
      tags: [],
      id: '',
      pubkey: '',
      created_at: 0,
      content: '',
      sig: ''
    };
    expect(getFallbackRoute(event)).toBe('/calendar');
  });

  it('returns /discover for kind 30142 (educational)', () => {
    const event = {
      kind: 30142,
      tags: [],
      id: '',
      pubkey: '',
      created_at: 0,
      content: '',
      sig: ''
    };
    expect(getFallbackRoute(event)).toBe('/discover');
  });

  it('returns /discover for kind 30023 (article)', () => {
    const event = {
      kind: 30023,
      tags: [],
      id: '',
      pubkey: '',
      created_at: 0,
      content: '',
      sig: ''
    };
    expect(getFallbackRoute(event)).toBe('/discover');
  });

  it('returns /wiki for kind 30818', () => {
    const event = {
      kind: 30818,
      tags: [],
      id: '',
      pubkey: '',
      created_at: 0,
      content: '',
      sig: ''
    };
    expect(getFallbackRoute(event)).toBe('/wiki');
  });

  it('returns /bookmarks for kind 39701', () => {
    const event = {
      kind: 39701,
      tags: [],
      id: '',
      pubkey: '',
      created_at: 0,
      content: '',
      sig: ''
    };
    expect(getFallbackRoute(event)).toBe('/bookmarks');
  });

  it('returns / for unknown kind', () => {
    const event = {
      kind: 9999,
      tags: [],
      id: '',
      pubkey: '',
      created_at: 0,
      content: '',
      sig: ''
    };
    expect(getFallbackRoute(event)).toBe('/');
  });

  it('h-tag takes priority over kind-based fallback', () => {
    const event = {
      kind: 31922,
      tags: [['h', 'b'.repeat(64)]],
      id: '',
      pubkey: '',
      created_at: 0,
      content: '',
      sig: ''
    };
    const route = getFallbackRoute(event);
    expect(route).toMatch(/^\/c\/npub1/);
  });
});
