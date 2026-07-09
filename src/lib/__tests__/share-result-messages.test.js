// @ts-nocheck
/**
 * Share-result message tests (edufeed-app#4)
 *
 * Applying share changes can CREATE shares and DELETE shares in one action.
 * The feedback must say which happened — reporting an un-share as
 * "Successfully shared" makes users think their share silently vanished.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildShareResultMessages } from '$lib/helpers/shareMessages.js';

describe('buildShareResultMessages', () => {
  it('reports pure shares', () => {
    const { success, error } = buildShareResultMessages({ shared: 2, unshared: 0, failed: 0 });
    expect(success).toBe('Shared with 2 communities');
    expect(error).toBe('');
  });

  it('reports pure un-shares as removals, never as shares', () => {
    const { success } = buildShareResultMessages({ shared: 0, unshared: 1, failed: 0 });
    expect(success).toBe('Removed from 1 community');
    expect(success).not.toContain('Shared');
  });

  it('reports mixed share + un-share actions', () => {
    const { success } = buildShareResultMessages({ shared: 1, unshared: 2, failed: 0 });
    expect(success).toBe('Shared with 1 community, removed from 2 communities');
  });

  it('reports failures separately', () => {
    const { success, error } = buildShareResultMessages({ shared: 1, unshared: 0, failed: 2 });
    expect(success).toBe('Shared with 1 community');
    expect(error).toBe('Failed to update sharing for 2 communities');
  });

  it('returns empty strings when nothing happened', () => {
    expect(buildShareResultMessages({ shared: 0, unshared: 0, failed: 0 })).toEqual({
      success: '',
      error: ''
    });
  });
});
