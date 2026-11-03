/** @vitest-environment node */
// Dock + desktop sidebar highlight: which dashboard section a URL belongs to.
// A community route (/c/<npub>…) counts as the Communities section — inside a
// community you are in the Communities place, whatever section is open.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

const { getDashboardActiveSection: active } = await import('../dashboardNavigation.js');
const sp = (q = '') => new URLSearchParams(q);

describe('getDashboardActiveSection', () => {
  it('returns the view on /c/', () => {
    expect(active('/c/', sp())).toBe('home');
    expect(active('/c', sp('view=feed'))).toBe('feed');
    expect(active('/c/', sp('view=communities'))).toBe('communities');
    expect(active('/c/', sp('view=your-content'))).toBe('my-stuff');
  });

  it('returns communities anywhere under a community route', () => {
    expect(active('/c/npub1abc', sp())).toBe('communities');
    expect(active('/c/npub1abc', sp('view=calendar'))).toBe('communities');
    expect(active('/c/npub1abc/naddr1xyz', sp())).toBe('communities');
  });

  it('keeps the dashboard sub-routes', () => {
    expect(active('/c/inbox', sp())).toBe('inbox');
    expect(active('/c/messages/abc', sp())).toBe('messages');
    expect(active('/c/groups', sp())).toBe('groups');
    expect(active('/c/agents', sp())).toBe('agents');
    expect(active('/discover', sp('type=learning'))).toBe('discover');
    expect(active('/settings', sp())).toBeNull();
  });
});
