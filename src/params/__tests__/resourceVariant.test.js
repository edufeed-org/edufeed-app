/** @vitest-environment node */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the runtime config store so the matcher can read a controllable
// `resourceFormVariants.enabled` list.
vi.mock('$lib/stores/config.svelte.js', () => {
  /** @type {{ enabled: string[] }} */
  const resourceFormVariants = { enabled: ['amb', 'ekw'] };
  return {
    runtimeConfig: {
      get resourceFormVariants() {
        return resourceFormVariants;
      }
    },
    __setEnabled(/** @type {string[]} */ list) {
      resourceFormVariants.enabled = list;
    }
  };
});

import { match } from '../resourceVariant.js';
// @ts-ignore — test-only helper exported from the mock
import { __setEnabled } from '$lib/stores/config.svelte.js';

describe('resourceVariant param matcher', () => {
  beforeEach(() => {
    __setEnabled(['amb', 'ekw']);
  });

  test('accepts an enabled variant id', () => {
    expect(match('amb')).toBe(true);
    expect(match('ekw')).toBe(true);
  });

  test('rejects a disabled variant id', () => {
    __setEnabled(['amb']); // ekw disabled
    expect(match('ekw')).toBe(false);
  });

  test('rejects an unknown variant id', () => {
    expect(match('not-a-real-variant')).toBe(false);
  });

  test('rejects the empty string', () => {
    expect(match('')).toBe(false);
  });

  test('falls back to accepting "amb" when enabled list is empty', () => {
    // Registry defaults to ['amb'] when config is empty; the matcher should
    // follow the same fallback so the default route still resolves.
    __setEnabled([]);
    expect(match('amb')).toBe(true);
    expect(match('ekw')).toBe(false);
  });
});
