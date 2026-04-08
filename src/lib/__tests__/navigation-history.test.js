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
