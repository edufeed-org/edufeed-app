/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildCommunityPath } from '../helpers/communityNavigation.js';

describe('buildCommunityPath', () => {
  const npub = 'npub1abc123';

  it('returns /c/<npub> when no view param', () => {
    const params = new URLSearchParams();
    expect(buildCommunityPath(npub, params)).toBe('/c/npub1abc123');
  });

  it('preserves view=chat query param', () => {
    const params = new URLSearchParams('view=chat');
    expect(buildCommunityPath(npub, params)).toBe('/c/npub1abc123?view=chat');
  });

  it('preserves view=members query param', () => {
    const params = new URLSearchParams('view=members');
    expect(buildCommunityPath(npub, params)).toBe('/c/npub1abc123?view=members');
  });

  it('ignores other query params (only preserves view)', () => {
    const params = new URLSearchParams('tab=foo&view=chat&other=bar');
    expect(buildCommunityPath(npub, params)).toBe('/c/npub1abc123?view=chat');
  });

  it('handles null searchParams gracefully', () => {
    expect(buildCommunityPath(npub, null)).toBe('/c/npub1abc123');
  });

  it('handles undefined searchParams gracefully', () => {
    expect(buildCommunityPath(npub)).toBe('/c/npub1abc123');
  });
});
