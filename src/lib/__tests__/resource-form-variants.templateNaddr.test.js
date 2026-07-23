/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('variant templateNaddr', () => {
  beforeEach(() => vi.resetModules());
  it('reads templateNaddr for a variant from runtime config', async () => {
    vi.doMock('$lib/stores/config.svelte.js', () => ({
      runtimeConfig: {
        resourceFormVariants: { enabled: ['amb'], templateNaddrs: { amb: 'naddr1abc' } }
      },
      configReady: { subscribe: () => () => {} }
    }));
    const { getVariantById } = await import('$lib/config/resource-form-variants.js');
    expect(getVariantById('amb')?.templateNaddr).toBe('naddr1abc');
  });
  it('templateNaddr is undefined when unset', async () => {
    vi.doMock('$lib/stores/config.svelte.js', () => ({
      runtimeConfig: { resourceFormVariants: { enabled: ['amb'] } },
      configReady: { subscribe: () => () => {} }
    }));
    const { getVariantById } = await import('$lib/config/resource-form-variants.js');
    expect(getVariantById('amb')?.templateNaddr).toBeUndefined();
  });
});
