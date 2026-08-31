/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the runtime config store so registry functions can read
// a controllable `resourceFormVariants.enabled` list.
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

import {
  ALL_VARIANTS,
  filterVariantsByIds,
  getEnabledVariants,
  getVariantById,
  getDefaultVariantId,
  getBildungsbereichKeysForVariant
} from '$lib/config/resource-form-variants.js';
// @ts-ignore — test-only helper exported from the mock
import { __setEnabled } from '$lib/stores/config.svelte.js';

import { resolveVariantIdFromEvent } from '$lib/helpers/educational/resolveVariantFromEvent.js';
import { BILDUNGSBEREICH_KEYS } from '$lib/helpers/educational/bildungsbereich.js';

describe('resource-form-variants registry', () => {
  beforeEach(() => {
    // Default: both variants enabled
    __setEnabled(['amb', 'ekw']);
  });

  it('registers amb and ekw in ALL_VARIANTS', () => {
    const ids = ALL_VARIANTS.map((v) => v.id);
    expect(ids).toContain('amb');
    expect(ids).toContain('ekw');
  });

  it('no longer registers the interactive variant (merged into the normal upload flow)', () => {
    expect(ALL_VARIANTS.map((v) => v.id)).not.toContain('interactive');
  });

  it('every registered variant has required i18n keys', () => {
    for (const v of ALL_VARIANTS) {
      expect(typeof v.labelKey).toBe('string');
      expect(typeof v.descriptionKey).toBe('string');
      expect(v.labelKey.length).toBeGreaterThan(0);
      expect(v.descriptionKey.length).toBeGreaterThan(0);
    }
  });

  describe('filterVariantsByIds (pure)', () => {
    it('returns only variants whose id is in the enabled list, in registry order', () => {
      const result = filterVariantsByIds(['ekw', 'amb']); // input order ignored
      expect(result.map((v) => v.id)).toEqual(['amb', 'ekw']); // registry order preserved
    });

    it('filters out ids not in the registry', () => {
      const result = filterVariantsByIds(['amb', 'unknown']);
      expect(result.map((v) => v.id)).toEqual(['amb']);
    });

    it('returns [] when the enabled list is empty', () => {
      expect(filterVariantsByIds([])).toEqual([]);
    });

    it('returns [] when the enabled list is null/undefined', () => {
      expect(filterVariantsByIds(null)).toEqual([]);
      expect(filterVariantsByIds(undefined)).toEqual([]);
    });
  });

  describe('getEnabledVariants (reads runtimeConfig)', () => {
    it('returns both variants when both are enabled', () => {
      __setEnabled(['amb', 'ekw']);
      expect(getEnabledVariants().map((v) => v.id)).toEqual(['amb', 'ekw']);
    });

    it('returns only amb when only amb is enabled', () => {
      __setEnabled(['amb']);
      expect(getEnabledVariants().map((v) => v.id)).toEqual(['amb']);
    });

    it('falls back to [amb] when enabled list is empty (safe default)', () => {
      __setEnabled([]);
      expect(getEnabledVariants().map((v) => v.id)).toEqual(['amb']);
    });
  });

  describe('getVariantById', () => {
    it('returns the variant object for an enabled id', () => {
      __setEnabled(['amb', 'ekw']);
      expect(getVariantById('ekw')?.id).toBe('ekw');
    });

    it('returns undefined for a disabled id', () => {
      __setEnabled(['amb']);
      expect(getVariantById('ekw')).toBeUndefined();
    });

    it('returns undefined for an unknown id', () => {
      __setEnabled(['amb', 'ekw']);
      expect(getVariantById('nonexistent')).toBeUndefined();
    });
  });

  describe('getDefaultVariantId', () => {
    it('returns the first enabled variant id', () => {
      __setEnabled(['amb', 'ekw']);
      expect(getDefaultVariantId()).toBe('amb');
    });

    it('returns ekw when only ekw is enabled', () => {
      __setEnabled(['ekw']);
      expect(getDefaultVariantId()).toBe('ekw');
    });

    it('falls back to amb when no variants are enabled', () => {
      __setEnabled([]);
      expect(getDefaultVariantId()).toBe('amb');
    });
  });

  describe('getBildungsbereichKeysForVariant', () => {
    it('returns AMB keys (schule, hochschule, extra)', () => {
      expect(getBildungsbereichKeysForVariant('amb')).toEqual(['schule', 'hochschule', 'extra']);
    });

    it('returns EKW keys (schule, konfi)', () => {
      expect(getBildungsbereichKeysForVariant('ekw')).toEqual(['schule', 'konfi']);
    });

    it('falls back to the full BILDUNGSBEREICH_KEYS list for an unknown variant id', () => {
      expect(getBildungsbereichKeysForVariant('nonexistent')).toEqual(BILDUNGSBEREICH_KEYS);
    });

    it('does not depend on runtime-enabled gating (static metadata)', () => {
      // Even when EKW is disabled on this deployment, looking up its bildungsbereich
      // keys must still work — the variant still exists in the registry.
      __setEnabled(['amb']);
      expect(getBildungsbereichKeysForVariant('ekw')).toEqual(['schule', 'konfi']);
    });
  });
});

describe('resolveVariantIdFromEvent', () => {
  beforeEach(() => {
    __setEnabled(['amb', 'ekw']);
  });

  /** @returns {import('nostr-tools').NostrEvent} */
  function makeEvent(/** @type {string[][]} */ tags = []) {
    return /** @type {any} */ ({
      id: 'x',
      pubkey: 'p',
      created_at: 0,
      kind: 30142,
      content: '',
      sig: '',
      tags
    });
  }

  it('returns "amb" when the event has no l-tag', () => {
    expect(resolveVariantIdFromEvent(makeEvent())).toBe('amb');
  });

  it('returns the variant id when l-tag is scoped to metadata-form', () => {
    expect(resolveVariantIdFromEvent(makeEvent([['l', 'ekw', 'metadata-form']]))).toBe('ekw');
  });

  it('falls back to amb for events labeled with the removed interactive variant', () => {
    expect(resolveVariantIdFromEvent(makeEvent([['l', 'interactive', 'metadata-form']]))).toBe(
      'amb'
    );
  });

  it('ignores l-tags with a different namespace', () => {
    expect(resolveVariantIdFromEvent(makeEvent([['l', 'ekw', 'other-namespace']]))).toBe('amb');
  });

  it('falls back to "amb" when the tagged variant is not enabled', () => {
    __setEnabled(['amb']); // ekw disabled on this deployment
    expect(resolveVariantIdFromEvent(makeEvent([['l', 'ekw', 'metadata-form']]))).toBe('amb');
  });

  it('falls back to "amb" when the tagged variant is unknown', () => {
    expect(
      resolveVariantIdFromEvent(makeEvent([['l', 'not-a-real-variant', 'metadata-form']]))
    ).toBe('amb');
  });

  it('picks the metadata-form-scoped l-tag even when other l-tags are present', () => {
    const event = makeEvent([
      ['l', 'foo', 'other-namespace'],
      ['l', 'ekw', 'metadata-form'],
      ['l', 'bar', 'yet-another']
    ]);
    expect(resolveVariantIdFromEvent(event)).toBe('ekw');
  });
});
