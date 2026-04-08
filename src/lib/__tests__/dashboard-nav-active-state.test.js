/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

// Mock $app/paths before importing the module
vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

const { getDashboardActiveSection } = await import('../helpers/dashboardNavigation.js');

describe('getDashboardActiveSection', () => {
  /**
   * @param {string} [query]
   * @returns {URLSearchParams}
   */
  function params(query = '') {
    return new URLSearchParams(query);
  }

  it('returns "feed" on /c/', () => {
    expect(getDashboardActiveSection('/c/', params())).toBe('feed');
  });

  it('returns "inbox" on /c/inbox', () => {
    expect(getDashboardActiveSection('/c/inbox', params())).toBe('inbox');
  });

  it('returns "inbox" on /c/inbox/ (trailing slash)', () => {
    expect(getDashboardActiveSection('/c/inbox/', params())).toBe('inbox');
  });

  it('returns "your-content" on /c/?view=your-content', () => {
    expect(getDashboardActiveSection('/c/', params('view=your-content'))).toBe('your-content');
  });

  it('returns "communities" on /c/?view=communities', () => {
    expect(getDashboardActiveSection('/c/', params('view=communities'))).toBe('communities');
  });

  it('returns null on /discover', () => {
    expect(getDashboardActiveSection('/discover', params())).toBeNull();
  });

  it('returns null on /calendar', () => {
    expect(getDashboardActiveSection('/calendar', params())).toBeNull();
  });

  it('returns null on /settings', () => {
    expect(getDashboardActiveSection('/settings', params())).toBeNull();
  });

  it('returns null on /p/somepubkey', () => {
    expect(getDashboardActiveSection('/p/somepubkey', params())).toBeNull();
  });
});
