/**
 * Content Creation Helper Tests
 *
 * Tests CONTENT_CREATION map and navigateToCreate dispatch.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SvelteKit modules
vi.mock('$app/navigation', () => ({
  goto: vi.fn()
}));
vi.mock('$app/paths', () => ({
  resolve: vi.fn((p) => p)
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: vi.fn() }
}));

// Variant registry mock — default single-variant; tests override via __setVariants().
vi.mock('$lib/config/resource-form-variants.js', () => {
  /** @type {Array<{id: string}>} */
  let variants = [{ id: 'amb' }];
  return {
    getEnabledVariants: () => variants,
    getDefaultVariantId: () => variants[0]?.id ?? 'amb',
    __setVariants(/** @type {typeof variants} */ list) {
      variants = list;
    }
  };
});

import {
  CONTENT_CREATION,
  navigateToCreate,
  startResourceCreation,
  resourceCreatePath
} from '$lib/helpers/contentCreation.js';
import { goto } from '$app/navigation';
import { modalStore } from '$lib/stores/modal.svelte.js';
// @ts-ignore — test-only helper exported from the mock
import { __setVariants } from '$lib/config/resource-form-variants.js';

beforeEach(() => {
  vi.clearAllMocks();
  __setVariants([{ id: 'amb' }]);
});

describe('CONTENT_CREATION', () => {
  it('has entries for calendar, learning, article, wiki, form, poll, bookmark', () => {
    expect(Object.keys(CONTENT_CREATION)).toEqual([
      'calendar',
      'learning',
      'article',
      'wiki',
      'form',
      'poll',
      'bookmark'
    ]);
  });

  it('calendar, poll, and bookmark are modal targets', () => {
    expect(CONTENT_CREATION.calendar.type).toBe('modal');
    expect(CONTENT_CREATION.poll.type).toBe('modal');
    expect(CONTENT_CREATION.bookmark.type).toBe('modal');
  });

  it('article, wiki, form are route targets', () => {
    for (const key of ['article', 'wiki', 'form']) {
      expect(CONTENT_CREATION[key].type).toBe('route');
    }
  });

  it('learning is a resource target (variant-aware dispatch)', () => {
    expect(CONTENT_CREATION.learning.type).toBe('resource');
  });
});

describe('navigateToCreate', () => {
  it('opens modal for calendar', () => {
    navigateToCreate('calendar');
    expect(modalStore.openModal).toHaveBeenCalledWith(
      'calendarEvent',
      expect.objectContaining({
        communityPubkey: '',
        mode: 'create'
      })
    );
    expect(goto).not.toHaveBeenCalled();
  });

  it('navigates directly to the default variant for learning in single-variant mode', () => {
    navigateToCreate('learning');
    expect(goto).toHaveBeenCalledWith('/create/resource/amb');
    expect(modalStore.openModal).not.toHaveBeenCalled();
  });

  it('opens the variant picker modal for learning when multiple variants are enabled', () => {
    __setVariants([{ id: 'amb' }, { id: 'ekw' }]);
    navigateToCreate('learning');
    expect(modalStore.openModal).toHaveBeenCalledWith('resourceVariantPicker', {
      communityPubkey: ''
    });
    expect(goto).not.toHaveBeenCalled();
  });

  it('passes communityPubkey to the variant picker modal', () => {
    __setVariants([{ id: 'amb' }, { id: 'ekw' }]);
    navigateToCreate('learning', { communityPubkey: 'abc123' });
    expect(modalStore.openModal).toHaveBeenCalledWith('resourceVariantPicker', {
      communityPubkey: 'abc123'
    });
    expect(goto).not.toHaveBeenCalled();
  });

  it('navigates to route for article', () => {
    navigateToCreate('article');
    expect(goto).toHaveBeenCalledWith('/create/article');
  });

  it('navigates to route for wiki', () => {
    navigateToCreate('wiki');
    expect(goto).toHaveBeenCalledWith('/create/wiki');
  });

  it('navigates to route for form', () => {
    navigateToCreate('form');
    expect(goto).toHaveBeenCalledWith('/forms/new');
  });

  it('appends community query param when communityPubkey provided', () => {
    navigateToCreate('learning', { communityPubkey: 'abc123' });
    expect(goto).toHaveBeenCalledWith('/create/resource/amb?community=abc123');
  });

  it('opens modal for bookmark', () => {
    navigateToCreate('bookmark');
    expect(modalStore.openModal).toHaveBeenCalledWith(
      'addBookmark',
      expect.objectContaining({ communityPubkey: '' })
    );
    expect(goto).not.toHaveBeenCalled();
  });

  it('passes communityPubkey to modal for calendar', () => {
    navigateToCreate('calendar', { communityPubkey: 'abc123' });
    expect(modalStore.openModal).toHaveBeenCalledWith(
      'calendarEvent',
      expect.objectContaining({
        communityPubkey: 'abc123'
      })
    );
  });

  it('does nothing for unknown key', () => {
    navigateToCreate('unknown');
    expect(goto).not.toHaveBeenCalled();
    expect(modalStore.openModal).not.toHaveBeenCalled();
  });
});

describe('startResourceCreation', () => {
  it('navigates directly in single-variant mode', () => {
    startResourceCreation();
    expect(goto).toHaveBeenCalledWith('/create/resource/amb');
    expect(modalStore.openModal).not.toHaveBeenCalled();
  });

  it('opens the picker modal in multi-variant mode', () => {
    __setVariants([{ id: 'amb' }, { id: 'ekw' }]);
    startResourceCreation({ communityPubkey: 'abc123' });
    expect(modalStore.openModal).toHaveBeenCalledWith('resourceVariantPicker', {
      communityPubkey: 'abc123'
    });
    expect(goto).not.toHaveBeenCalled();
  });
});

describe('resourceCreatePath', () => {
  it('builds the variant route without community', () => {
    expect(resourceCreatePath('ekw')).toBe('/create/resource/ekw');
  });

  it('appends the community query param', () => {
    expect(resourceCreatePath('ekw', 'abc123')).toBe('/create/resource/ekw?community=abc123');
  });
});
