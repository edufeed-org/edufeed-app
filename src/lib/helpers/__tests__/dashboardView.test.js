/** @vitest-environment node */
// Which dashboard view the /c/ page renders: on phones the root ("home")
// is the feed — there is no greeting page below lg (mobile nav round 2).
import { describe, it, expect } from 'vitest';
import { resolveDashboardView } from '../dashboardView.js';

describe('resolveDashboardView', () => {
  it('desktop keeps the home view for the root', () => {
    expect(resolveDashboardView(null, true)).toBe('home');
    expect(resolveDashboardView('', true)).toBe('home');
    expect(resolveDashboardView('home', true)).toBe('home');
  });

  it('phone renders the feed for the root', () => {
    expect(resolveDashboardView(null, false)).toBe('feed');
    expect(resolveDashboardView('home', false)).toBe('feed');
  });

  it('explicit views pass through on both', () => {
    expect(resolveDashboardView('feed', true)).toBe('feed');
    expect(resolveDashboardView('communities', false)).toBe('communities');
    expect(resolveDashboardView('my-stuff', true)).toBe('my-stuff');
  });

  it('maps the legacy your-content view to my-stuff', () => {
    expect(resolveDashboardView('your-content', false)).toBe('my-stuff');
    expect(resolveDashboardView('your-content', true)).toBe('my-stuff');
  });
});
