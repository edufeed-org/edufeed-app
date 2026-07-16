/**
 * AMBResourceCard Component Tests
 *
 * Tests both default card variant and new list variant rendering.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import AMBResourceCard from '../educational/AMBResourceCard.svelte';

// Hoisted so vi.mock factory can reference it
const { BookmarkButtonStub } = vi.hoisted(() => ({
  BookmarkButtonStub: vi.fn(() => ({}))
}));

// Mock dependencies
// Mock app-settings before any imports that transitively depend on it
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));
// Stub the license-hook (used transitively by ResourceCover) so the overlay
// renders nothing (loading) and no real applesauce loader spins up.
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseForHash: () => () => null,
  useLicenseStatus: () => () => ({ event: null, status: 'loading' })
}));
vi.mock('$lib/paraglide/messages.js', () => ({
  amb_resource_free: () => 'Free',
  amb_resource_view_content: () => 'View Content',
  amb_resource_open_content: () => 'Open Content',
  event_tags_view_all_tooltip: () => '',
  event_tags_more_count: () => '',
  debug_panel_raw_nostr_event: () => '',
  common_copied: () => '',
  common_copy: () => ''
}));
vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'en'
}));
vi.mock('$app/navigation', () => ({
  goto: vi.fn()
}));
vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));
vi.mock('applesauce-core/helpers', () => ({
  getProfilePicture: (/** @type {any} */ profile) => profile?.picture || null,
  getDisplayName: (/** @type {any} */ profile, /** @type {any} */ fallback) =>
    profile?.name || fallback,
  getTagValue: (/** @type {any} */ event, /** @type {string} */ name) =>
    event?.tags?.find((/** @type {string[]} */ t) => t[0] === name)?.[1]
}));
vi.mock('$lib/helpers/calendar.js', () => ({
  formatCalendarDate: () => 'Jan 15'
}));
vi.mock('$lib/helpers/educational/ambTransform.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    getLabelsWithFallback: (/** @type {any} */ tags, /** @type {any} */ field) => {
      if (field === 'learningResourceType') return [{ id: 'hcrt/text', label: 'Text' }];
      if (field === 'about') return [{ id: 'math', label: 'Mathematik', fallbackLang: 'de' }];
      if (field === 'educationalLevel') return [{ id: 'higher', label: 'Higher Education' }];
      return [];
    },
    getLanguageDisplayName: (/** @type {string} */ code) => {
      /** @type {Record<string, string>} */
      const names = { de: 'German', en: 'English', fr: 'French' };
      return names[code] || code;
    }
  };
});
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    appRelays: { educational: ['wss://relay.example.com'] }
  },
  configReady: {
    subscribe: (/** @type {Function} */ fn) => {
      fn(true);
      return { unsubscribe: () => {} };
    }
  }
}));
vi.mock('nostr-tools', () => ({
  nip19: {
    naddrEncode: () => 'naddr1test'
  }
}));
// Mock heavy sub-components to avoid deep dependency chains
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/EventDebugPanel.svelte', () => ({ default: () => ({}) }));
vi.mock('../calendar/EventTags.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/MarkdownRenderer.svelte', () => ({ default: () => ({}) }));
vi.mock('../bookmarks/BookmarkButton.svelte', () => ({ default: BookmarkButtonStub }));

const mockResourceTags = [
  ['d', 'intro-math'],
  ['learningResourceType', 'text'],
  ['about', 'mathematics'],
  ['t', 'math']
];

const mockResource = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 30142,
  publishedDate: Math.floor(Date.now() / 1000),
  name: 'Introduction to Mathematics',
  description: 'A comprehensive guide to basic mathematics concepts.',
  image: 'https://example.com/math.jpg',
  identifier: 'https://example.com/resource',
  license: { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' },
  isFree: true,
  languages: ['en', 'de'],
  keywords: ['math', 'education'],
  tags: mockResourceTags,
  sig: 'c'.repeat(128),
  rawEvent: {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 30142,
    created_at: Math.floor(Date.now() / 1000),
    tags: mockResourceTags,
    content: '',
    sig: 'c'.repeat(128)
  }
};

const mockAuthorProfile = {
  name: 'Prof. Test',
  picture: 'https://example.com/avatar.jpg'
};

describe('AMBResourceCard', () => {
  beforeEach(() => {
    BookmarkButtonStub.mockClear();
  });

  describe('bookmarking (kind 30142)', () => {
    it('card variant renders a BookmarkButton', () => {
      render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile }
      });
      expect(BookmarkButtonStub).toHaveBeenCalled();
    });

    it('list variant renders a BookmarkButton', () => {
      render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });
      expect(BookmarkButtonStub).toHaveBeenCalled();
    });

    it('passes the kind 30142 rawEvent to BookmarkButton', () => {
      render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile }
      });
      // Find the props object across all call args (Svelte 5 mount call shape varies)
      const propsArg = /** @type {any} */ (
        BookmarkButtonStub.mock.calls
          .flat()
          .find(/** @param {any} a */ (a) => a && typeof a === 'object' && 'event' in a)
      );
      expect(propsArg).toBeTruthy();
      expect(propsArg.event?.kind).toBe(30142);
      expect(propsArg.event?.id).toBe(mockResource.id);
    });
  });

  describe('default (card) variant', () => {
    it('renders as vertical card layout by default', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile }
      });

      const card = container.querySelector('.amb-card');
      expect(card).toBeTruthy();
    });

    it('shows resource name', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile }
      });

      expect(container.textContent).toContain('Introduction to Mathematics');
    });
  });

  describe('list variant', () => {
    it('renders with list-variant class', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const listItem = container.querySelector('.amb-card-list');
      expect(listItem).toBeTruthy();
    });

    it('renders as horizontal flex row', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const listItem = /** @type {HTMLElement} */ (container.querySelector('.amb-card-list'));
      expect(listItem).toBeTruthy();
      expect(listItem.classList.contains('flex')).toBe(true);
    });

    it('shows a small square thumbnail', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      // ResourceCover renders either resource-cover-image (has image) or resource-cover-typo (no image)
      const thumbnail =
        container.querySelector('[data-testid="resource-cover-image"]') ||
        container.querySelector('[data-testid="resource-cover-typo"]');
      expect(thumbnail).toBeTruthy();
    });

    it('shows resource name', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      expect(container.textContent).toContain('Introduction to Mathematics');
    });

    it('shows author name and date', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      expect(container.textContent).toContain('Prof. Test');
      expect(container.textContent).toContain('Jan 15');
    });

    it('shows resource type badge', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      expect(container.textContent).toContain('Text');
    });

    it('does not show reaction bar', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const listItem = container.querySelector('.amb-card-list');
      // ReactionBar should not be present in list mode
      const reactionBar = listItem?.querySelector('[data-testid="reaction-bar"]');
      expect(reactionBar).toBeFalsy();
    });

    it('does not show description', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const listItem = container.querySelector('.amb-card-list');
      // Full description block should not be present
      expect(listItem?.querySelector('.line-clamp-3')).toBeFalsy();
    });

    it('does not show action button', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const btn = container.querySelector('.amb-card-list .btn');
      expect(btn).toBeFalsy();
    });

    it('is clickable', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const listItem = container.querySelector('.amb-card-list');
      expect(listItem?.getAttribute('role')).toBe('button');
      expect(listItem?.getAttribute('tabindex')).toBe('0');
    });
  });

  describe('indexed resource attribution (creator ≠ pubkey)', () => {
    // Real-world shape: Colibri indexes an ÖRF journal article — the event
    // pubkey is only the indexer, the author lives in creator:* metadata.
    const indexedTags = [
      ['d', 'https://oerf-journal.eu/index.php/oerf/article/view/605'],
      ['name', 'Aufbruch ins Unbekannte'],
      ['creator:name', 'Regina Polak'],
      ['creator:type', 'Person'],
      ['t', 'Jugendreligiosität']
    ];
    const indexedResource = {
      ...mockResource,
      name: 'Aufbruch ins Unbekannte',
      identifier: 'https://oerf-journal.eu/index.php/oerf/article/view/605',
      tags: indexedTags,
      rawEvent: { ...mockResource.rawEvent, tags: indexedTags }
    };
    const indexerProfile = { name: 'Colibri', picture: 'https://example.com/colibri.jpg' };

    it('shows the metadata creator instead of the indexer in the card header', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: indexedResource, authorProfile: indexerProfile }
      });
      expect(container.textContent).toContain('Regina Polak');
      expect(container.textContent).not.toContain('Colibri');
    });

    it('renders a dashed initials avatar for creators without a Nostr profile', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: indexedResource, authorProfile: indexerProfile }
      });
      const avatar = container.querySelector('[data-testid="metadata-avatar"]');
      expect(avatar).toBeTruthy();
      expect(avatar?.textContent?.trim()).toBe('RP');
      expect(avatar?.className).toContain('border-dashed');
    });

    it('shows the source domain and date, without hint text', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: indexedResource, authorProfile: indexerProfile }
      });
      const line = container.querySelector('[data-testid="metadata-attribution"]');
      expect(line?.textContent).toContain('oerf-journal.eu');
      expect(line?.textContent).toContain('Jan 15'); // mocked formatCalendarDate
      expect(line?.textContent).not.toContain('metadata');
    });

    it('does not link the creator name when there is no Nostr profile', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: indexedResource, authorProfile: indexerProfile }
      });
      const header = container.querySelector('.amb-card > div');
      expect(header?.querySelector('a')).toBeFalsy();
    });

    it('keeps the publisher header when the creator p-tag matches the event pubkey', () => {
      const ownTags = [...indexedTags, ['p', mockResource.pubkey, '', 'creator']];
      const ownResource = {
        ...indexedResource,
        tags: ownTags,
        rawEvent: { ...mockResource.rawEvent, tags: ownTags }
      };
      const { container } = render(AMBResourceCard, {
        props: { resource: ownResource, authorProfile: indexerProfile }
      });
      expect(container.textContent).toContain('Colibri');
      expect(container.querySelector('[data-testid="metadata-avatar"]')).toBeFalsy();
    });

    it('stacks avatars and joins names with +N for multi-author resources', () => {
      const multiTags = [
        ['d', 'https://www.rpi-ekkw-ekhn.de/some/article.pdf'],
        ['name', 'Wunder-Artikel'],
        ['creator:name', 'Institut RPI'],
        ['creator:type', 'Organization'],
        ['creator:name', 'Julia Gerth'],
        ['creator:type', 'Person'],
        ['creator:name', 'Nadine Hofmann-Driesch'],
        ['creator:type', 'Person'],
        ['creator:name', 'Vierte Person'],
        ['creator:type', 'Person']
      ];
      const multiResource = {
        ...indexedResource,
        tags: multiTags,
        rawEvent: { ...mockResource.rawEvent, tags: multiTags }
      };
      const { container } = render(AMBResourceCard, {
        props: { resource: multiResource, authorProfile: indexerProfile }
      });
      // Name line: first two names + count of the remaining two
      expect(container.textContent).toContain('Institut RPI, Julia Gerth +2');
      // Avatar stack: 4 creators > max 3 → two avatars + "+2" overflow circle
      const stack = container.querySelector('[data-testid="creator-avatar-stack"]');
      expect(stack).toBeTruthy();
      expect(stack?.querySelectorAll('[data-testid="metadata-avatar"]').length).toBe(2);
      expect(stack?.querySelector('[data-testid="creator-overflow"]')?.textContent?.trim()).toBe(
        '+2'
      );
      // Multi-author name line is plain text, not a profile link
      const header = container.querySelector('.amb-card > div');
      expect(header?.querySelector('a')).toBeFalsy();
    });

    it('shows all creator names in hover titles (name line + overflow circle)', () => {
      const multiTags = [
        ['d', 'https://example.org/x'],
        ['name', 'Multi'],
        ['creator:name', 'Judith Noa'],
        ['creator:type', 'Person'],
        ['creator:name', 'Konstantin Falahati'],
        ['creator:type', 'Person'],
        ['creator:name', 'Anna Krause'],
        ['creator:type', 'Person'],
        ['creator:name', 'Vierte Person'],
        ['creator:type', 'Person']
      ];
      const multiResource = {
        ...indexedResource,
        tags: multiTags,
        rawEvent: { ...mockResource.rawEvent, tags: multiTags }
      };
      const { container } = render(AMBResourceCard, {
        props: { resource: multiResource, authorProfile: indexerProfile }
      });
      // Full list on the (truncated) name line
      const nameEl = [...container.querySelectorAll('[title]')].find((el) =>
        el.getAttribute('title')?.startsWith('Judith Noa,')
      );
      expect(nameEl?.getAttribute('title')).toBe(
        'Judith Noa, Konstantin Falahati, Anna Krause, Vierte Person'
      );
      // The +N circle names exactly the hidden creators
      const overflow = container.querySelector('[data-testid="creator-overflow"]');
      expect(overflow?.getAttribute('title')).toBe('Anna Krause, Vierte Person');
    });

    it('shows the creator in the list variant byline', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: indexedResource, authorProfile: indexerProfile, variant: 'list' }
      });
      expect(container.textContent).toContain('Regina Polak');
      expect(container.textContent).not.toContain('Colibri');
    });
  });

  describe('navigation href', () => {
    beforeEach(() => {
      /** @type {any} */ (goto).mockClear();
    });

    it('navigates to global /<naddr> when no communityNpub is set', async () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: mockResource, authorProfile: mockAuthorProfile }
      });

      const card = /** @type {HTMLElement} */ (container.querySelector('.amb-card'));
      await fireEvent.click(card);

      expect(goto).toHaveBeenCalledWith('/naddr1test');
    });

    it('navigates to /c/<npub>/r/<naddr> when communityNpub is set', async () => {
      const npub = 'npub1communitytest';
      const { container } = render(AMBResourceCard, {
        props: {
          resource: mockResource,
          authorProfile: mockAuthorProfile,
          communityNpub: npub
        }
      });

      const card = /** @type {HTMLElement} */ (container.querySelector('.amb-card'));
      await fireEvent.click(card);

      expect(goto).toHaveBeenCalledWith(`/c/${npub}/r/naddr1test`);
    });

    it('uses community-aware href in list variant', async () => {
      const npub = 'npub1communitytest';
      const { container } = render(AMBResourceCard, {
        props: {
          resource: mockResource,
          authorProfile: mockAuthorProfile,
          variant: 'list',
          communityNpub: npub
        }
      });

      const listItem = /** @type {HTMLElement} */ (container.querySelector('.amb-card-list'));
      await fireEvent.click(listItem);

      expect(goto).toHaveBeenCalledWith(`/c/${npub}/r/naddr1test`);
    });
  });

  describe('preview mode', () => {
    /** @type {any} */
    const minimalResource = {
      pubkey: '0'.repeat(64),
      identifier: 'https://example.org/lesson',
      name: 'Test Lesson',
      description: 'A short description',
      image: '',
      publishedDate: 1_700_000_000,
      languages: ['de'],
      isFree: true,
      license: null,
      keywords: [],
      tags: [],
      rawEvent: { id: '', pubkey: '0'.repeat(64), kind: 30142, tags: [], content: '', sig: '' },
      kind: 30142
    };

    beforeEach(() => {
      vi.mocked(goto).mockClear();
    });

    it('renders without click navigation when preview=true', async () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: minimalResource, preview: true }
      });
      const card = container.querySelector('.amb-card');
      expect(card).toBeTruthy();
      expect(card?.getAttribute('role')).not.toBe('button');
      if (card) await fireEvent.click(card);
      expect(goto).not.toHaveBeenCalled();
    });

    it('hides bookmark/reactions/comments/debug when preview=true', () => {
      const { container } = render(AMBResourceCard, {
        props: { resource: minimalResource, preview: true }
      });
      expect(container.querySelector('[role="toolbar"]')).toBeNull();
      expect(container.querySelector('[data-testid="amb-debug-wrapper"]')).toBeNull();
    });

    it('still renders metadata, image area, title, and open-content button when preview=true', () => {
      const { getByText, container } = render(AMBResourceCard, {
        props: { resource: minimalResource, preview: true }
      });
      expect(getByText('Test Lesson')).toBeTruthy();
      expect(getByText('Open Content')).toBeTruthy();
      // ResourceCover should be present (no image URL provided → typo cover)
      expect(container.querySelector('[data-testid="resource-cover-typo"]')).toBeTruthy();
    });
  });
});
