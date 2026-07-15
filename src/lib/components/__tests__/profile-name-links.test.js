// @ts-nocheck
/**
 * Profile-name link coverage
 *
 * Every rendered user name must be a link to that user's profile page.
 * Representative components for the "author line" pattern:
 * ThreadCard, BookmarkItem, BadgeCard.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// --- Shared mocks ---

vi.mock('$app/paths', () => ({
  resolve: (path) => path
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (pubkey) => (pubkey ? `/p/${pubkey}` : '#')
}));

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (profile, fallback) => profile?.name || fallback || 'Unknown',
  getProfilePicture: (profile) => profile?.picture
}));

vi.mock('$lib/helpers/calendar.js', () => ({
  formatRelativeTime: () => 'just now',
  formatCalendarDate: () => '01.01.2026'
}));

function StubComponent() {}
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));

// --- ThreadCard-specific mocks ---

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({
      pipe: () => ({ subscribe: () => ({ unsubscribe() {} }) })
    })
  }
}));

vi.mock('applesauce-core/models', () => ({
  TimelineModel: {}
}));

vi.mock('$lib/helpers/commentThreading.js', () => ({
  getPlainTextExcerpt: (content) => content || ''
}));

vi.mock('../calendar/EventTags.svelte', () => ({ default: StubComponent }));

// --- BookmarkItem-specific mocks ---

vi.mock('$lib/helpers/bookmark.js', () => ({
  updateBookmarkContent: vi.fn()
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn()
}));

vi.mock('../comments/CommentList.svelte', () => ({ default: StubComponent }));
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/EventDeleteButton.svelte', () => ({ default: StubComponent }));

// --- BadgeCard-specific mocks ---

vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: StubComponent }));

vi.mock('$lib/components/icons', () => ({
  ChatIcon: StubComponent,
  EditIcon: StubComponent
}));

vi.mock('$lib/paraglide/messages', () => ({
  default: {},
  common_save: () => 'Save',
  common_cancel: () => 'Cancel',
  common_edit: () => 'Edit',
  thread_card_untitled: () => 'Untitled',
  thread_card_commenter_single: ({ name }) => `${name} commented`,
  thread_card_commenters_and_others: ({ name, count }) => `${name} and ${count} others`
}));

import ThreadCard from '../thread/ThreadCard.svelte';
import BookmarkItem from '../bookmarks/BookmarkItem.svelte';
import BadgeCard from '../badges/BadgeCard.svelte';

const AUTHOR = 'b'.repeat(64);

/**
 * Find an anchor linking to AUTHOR's profile whose text contains the name.
 */
function queryProfileNameLink(container, name) {
  return [...container.querySelectorAll(`a[href="/p/${AUTHOR}"]`)].find((a) =>
    a.textContent.includes(name)
  );
}

describe('profile name links', () => {
  it('ThreadCard renders the author name as a profile link', () => {
    const { container } = render(ThreadCard, {
      props: {
        thread: {
          id: 'a'.repeat(64),
          pubkey: AUTHOR,
          kind: 11,
          created_at: 1700000000,
          tags: [['title', 'A thread']],
          content: 'hello'
        },
        authorProfile: { name: 'Alice' }
      }
    });

    expect(queryProfileNameLink(container, 'Alice')).toBeTruthy();
  });

  it('BookmarkItem renders the author name as a profile link', () => {
    const { container } = render(BookmarkItem, {
      props: {
        event: {
          id: 'a'.repeat(64),
          pubkey: AUTHOR,
          kind: 39701,
          created_at: 1700000000,
          tags: [['d', 'example.com/path']],
          content: 'A useful resource'
        },
        authorProfile: { name: 'Alice' }
      }
    });

    expect(queryProfileNameLink(container, 'Alice')).toBeTruthy();
  });

  it('BadgeCard renders the issuer name as a profile link', () => {
    const { container } = render(BadgeCard, {
      props: {
        badge: {
          issuerPubkey: AUTHOR,
          badgeName: 'Helper',
          badgeDescription: 'Awarded for helping',
          badgeImage: '',
          awardedAt: 1700000000
        },
        issuerProfile: { name: 'Alice' }
      }
    });

    expect(queryProfileNameLink(container, 'Alice')).toBeTruthy();
  });
});
