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
    event.tags?.find((/** @type {string[]} */ t) => t[0] === 'image')?.[1] || null
}));
vi.mock('$lib/helpers/calendar.js', () => ({
  formatCalendarDate: () => 'Jan 15'
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  encodeEventToNaddr: () => 'naddr1test'
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
});
