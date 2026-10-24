/**
 * ArticleCard Component Tests
 *
 * Tests both default card variant and new list variant rendering.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import ArticleCard from '../article/ArticleCard.svelte';

// Mock dependencies
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));
// Mock heavy sub-components to avoid deep dependency chains
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/EventDebugPanel.svelte', () => ({ default: () => ({}) }));
vi.mock('../calendar/EventTags.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/paraglide/messages', () => ({
  article_card_draft: () => 'Entwurf',
  event_tags_view_all_tooltip: () => '',
  event_tags_more_count: () => '',
  debug_panel_raw_nostr_event: () => '',
  common_copied: () => '',
  common_copy: () => '',
  article_card_read_article: () => 'Read Article'
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
    profile?.name || fallback
}));
vi.mock('applesauce-common/helpers', () => ({
  getArticleTitle: (/** @type {any} */ event) =>
    event.tags?.find((/** @type {string[]} */ t) => t[0] === 'title')?.[1] || 'Untitled',
  getArticleImage: (/** @type {any} */ event) =>
    event.tags?.find((/** @type {string[]} */ t) => t[0] === 'image')?.[1] || null,
  getSha256FromURL: () => null
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map([['d'.repeat(64), { name: 'Corinna Profil' }]])
}));
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseForHash: () => () => null,
  useLicenseStatus: () => () => ({ event: null, status: 'loading' })
}));
vi.mock('../shared/ImageLicenseOverlay.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/helpers/calendar.js', () => ({
  formatCalendarDate: () => 'Jan 15'
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  encodeEventToNaddr: () => 'naddr1test',
  profileLink: (/** @type {string} */ pubkey) => (pubkey ? `/p/${pubkey}` : '#')
}));
vi.mock('$lib/loaders/comments.js', () => ({
  createCommentLoaderForEvent: () => () => ({
    subscribe: () => ({ unsubscribe: vi.fn() })
  })
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    reactions: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    remove$: {
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
    }
  }
}));
vi.mock('applesauce-common/models', () => ({
  RepliesModel: class RepliesModel {}
}));

const mockArticle = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 30023,
  created_at: Math.floor(Date.now() / 1000),
  content: 'This is a test article with some content for testing purposes.',
  tags: [
    ['title', 'Test Article Title'],
    ['image', 'https://example.com/image.jpg'],
    ['summary', 'A short summary of the article'],
    ['t', 'svelte'],
    ['t', 'nostr']
  ],
  sig: 'c'.repeat(128)
};

const mockAuthorProfile = {
  name: 'Test Author',
  picture: 'https://example.com/avatar.jpg'
};

describe('ArticleCard', () => {
  describe('default (card) variant', () => {
    it('renders as vertical card layout by default', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile }
      });

      const card = container.querySelector('.article-card');
      expect(card).toBeTruthy();
    });

    it('shows article title', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile }
      });

      expect(container.textContent).toContain('Test Article Title');
    });

    it('uses an adaptive cover frame instead of a fixed 2:1 crop', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile }
      });

      const frame = /** @type {HTMLElement} */ (
        container.querySelector('[data-testid="article-cover-frame"]')
      );
      expect(frame).toBeTruthy();
      expect(frame.className).toMatch(/aspect-video/);
      expect(frame.className).not.toMatch(/aspect-\[2\/1\]/);
    });
  });

  describe('list variant', () => {
    it('renders with list-variant class', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const listItem = container.querySelector('.article-card-list');
      expect(listItem).toBeTruthy();
    });

    it('renders as horizontal flex row', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const listItem = /** @type {HTMLElement} */ (container.querySelector('.article-card-list'));
      expect(listItem).toBeTruthy();
      // Should have flex row layout
      expect(listItem.classList.contains('flex')).toBe(true);
    });

    it('shows a small square thumbnail', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const thumbnail = container.querySelector('.article-card-list .list-thumbnail');
      expect(thumbnail).toBeTruthy();
    });

    it('shows title text', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      expect(container.textContent).toContain('Test Article Title');
    });

    it('shows author name and date', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      expect(container.textContent).toContain('Test Author');
      expect(container.textContent).toContain('Jan 15');
    });

    it('does not show reaction bar', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const reactionBar = container.querySelector(
        '.article-card-list [data-testid="reaction-bar"]'
      );
      expect(reactionBar).toBeFalsy();
    });

    it('shows hashtag badges inline', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      // List mode shows inline hashtag badges (not EventTags component)
      const listItem = container.querySelector('.article-card-list');
      const tagElements = listItem?.querySelectorAll('.badge');
      expect(tagElements?.length).toBe(2); // 'svelte' and 'nostr'
    });

    it('does not show Read Article button', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const btn = container.querySelector('.article-card-list .btn');
      expect(btn).toBeFalsy();
    });

    it('is clickable', () => {
      const { container } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile, variant: 'list' }
      });

      const listItem = container.querySelector('.article-card-list');
      expect(listItem?.getAttribute('role')).toBe('button');
      expect(listItem?.getAttribute('tabindex')).toBe('0');
    });
  });

  describe('credited author byline', () => {
    const CORINNA = 'd'.repeat(64);

    it('shows the publisher when nobody else is credited', () => {
      const { getByTestId } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile }
      });
      expect(getByTestId('article-byline').textContent).toContain('Test Author');
    });

    it('shows a linked creator instead of the publisher (card variant)', () => {
      const credited = {
        ...mockArticle,
        tags: [...mockArticle.tags, ['p', CORINNA, '', 'creator']]
      };
      const { getByTestId } = render(ArticleCard, {
        props: { article: credited, authorProfile: mockAuthorProfile }
      });
      const byline = getByTestId('article-byline');
      expect(byline.textContent).toContain('Corinna Profil');
      expect(byline.textContent).not.toContain('Test Author');
      expect(byline.querySelector(`a[href="/p/${CORINNA}"]`)).toBeTruthy();
    });

    it('shows a name-only creator without a profile link (list variant)', () => {
      const credited = {
        ...mockArticle,
        tags: [...mockArticle.tags, ['creator:name', 'Corinna Beispiel']]
      };
      const { getByTestId } = render(ArticleCard, {
        props: { article: credited, authorProfile: mockAuthorProfile, variant: 'list' }
      });
      const byline = getByTestId('article-byline');
      expect(byline.textContent).toContain('Corinna Beispiel');
      expect(byline.textContent).not.toContain('Test Author');
      expect(byline.querySelector('a[href^="/p/"]')).toBeNull();
    });

    it('keeps the publisher byline when they credit themselves', () => {
      const credited = {
        ...mockArticle,
        tags: [...mockArticle.tags, ['p', mockArticle.pubkey, '', 'creator']]
      };
      const { getByTestId } = render(ArticleCard, {
        props: { article: credited, authorProfile: mockAuthorProfile }
      });
      expect(getByTestId('article-byline').textContent).toContain('Test Author');
    });
  });

  describe('drafts', () => {
    it('marks a kind 30024 draft with a badge', () => {
      const { queryByTestId } = render(ArticleCard, {
        props: { article: { ...mockArticle, kind: 30024 }, authorProfile: mockAuthorProfile }
      });
      expect(queryByTestId('article-draft-badge')?.textContent).toContain('Entwurf');
    });

    it('shows no draft badge on a published article', () => {
      const { queryByTestId } = render(ArticleCard, {
        props: { article: mockArticle, authorProfile: mockAuthorProfile }
      });
      expect(queryByTestId('article-draft-badge')).toBeNull();
    });
  });
});
