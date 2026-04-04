/**
 * AMBResourceView Component Tests
 *
 * Verifies that external URLs (license, files, external references) are not
 * broken by SvelteKit's resolve() function, which is only meant for internal routes.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import AMBResourceView from '../educational/AMBResourceView.svelte';

// Mock dependencies
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));
vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));
vi.mock('$app/stores', () => ({
  page: writable({ url: { href: 'http://localhost/test' } })
}));
vi.mock('$app/navigation', () => ({
  goto: vi.fn()
}));
vi.mock('$lib/paraglide/messages.js', () => ({
  amb_resource_access_content_title: () => 'Access Content',
  amb_resource_access_content_external_desc: () => 'External content',
  amb_resource_open_content: () => 'Open Content',
  amb_resource_educational_details: () => 'Educational Details',
  amb_resource_educational_level: () => 'Educational Level',
  amb_resource_subjects: () => 'Subjects',
  amb_resource_available_languages: () => 'Languages',
  amb_resource_access: () => 'Access',
  amb_resource_free: () => 'Free',
  amb_resource_paid: () => 'Paid',
  amb_resource_license: () => 'License',
  amb_resource_view_license: () => 'View License',
  amb_resource_topics_keywords: () => 'Topics',
  amb_resource_all_contributors: () => 'Contributors',
  amb_resource_related_resources: () => 'Related',
  amb_resource_uploaded_files: () => 'Uploaded Files',
  amb_resource_discussion: () => 'Discussion',
  common_edit: () => 'Edit',
  common_delete: () => 'Delete',
  common_share: () => 'Share',
  common_close: () => 'Close',
  common_copy: () => 'Copy',
  common_copied: () => 'Copied',
  event_menu_copy_event_id: () => 'Copy event ID',
  event_menu_copy_link: () => 'Copy link',
  event_menu_view_raw_event: () => 'View raw event',
  event_menu_raw_event_title: () => 'Raw Event',
  event_menu_event_id_copied: () => 'Event ID copied!',
  event_menu_share_link_copied: () => 'Link copied!',
  event_menu_share_to_communities: () => 'Share to communities',
  event_menu_feature_on_homepage: () => 'Feature on homepage',
  event_menu_remove_from_homepage: () => 'Remove from homepage',
  event_menu_featured_toast: () => 'Featured on homepage!',
  event_menu_unfeatured_toast: () => 'Removed from homepage'
}));
vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'en'
}));
vi.mock('applesauce-core/helpers', () => ({
  getProfilePicture: (/** @type {any} */ profile) => profile?.picture || null,
  getDisplayName: (/** @type {any} */ profile, /** @type {string} */ fallback) =>
    profile?.name || fallback
}));
vi.mock('$lib/helpers/calendar.js', () => ({
  formatCalendarDate: () => 'Jan 15'
}));
vi.mock('$lib/helpers/educational/ambTransform.js', () => ({
  getLabelsWithFallback: () => [],
  getLanguageDisplayName: (/** @type {string} */ code) => {
    /** @type {Record<string, string>} */
    const names = { de: 'German', en: 'English', fr: 'French' };
    return names[code] || code;
  }
}));
vi.mock('$lib/stores/skos-cache.svelte.js', () => ({
  getCachedConcepts: () => [],
  ensureVocabularyLoaded: vi.fn()
}));
vi.mock('$lib/helpers/educational/ambJsonLd.js', () => ({
  buildAMBJsonLd: () => ({})
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => null
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    appRelays: { educational: ['wss://relay.example.com'] }
  }
}));
vi.mock('nostr-tools', () => ({
  nip19: { naddrEncode: () => 'naddr1test' }
}));
vi.mock('$lib/helpers/eventDeletion.js', () => ({
  deleteEvent: vi.fn()
}));
vi.mock('$lib/helpers/toast.js', () => ({
  showToast: vi.fn()
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  encodeEventToNaddr: vi.fn(() => 'naddr1test')
}));
// Mock heavy sub-components
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: () => ({}) }));
vi.mock('../comments/CommentList.svelte', () => ({ default: () => ({}) }));
vi.mock('../calendar/EventTags.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/CommunityShare.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/MarkdownRenderer.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/components/icons', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual };
});

const mockEvent = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 30142,
  created_at: Math.floor(Date.now() / 1000),
  tags: [['d', 'test-resource']],
  content: '',
  sig: 'c'.repeat(128)
};

const mockResource = {
  name: 'Test Resource',
  description: 'A test educational resource.',
  image: null,
  identifier: 'test-resource',
  publishedDate: Math.floor(Date.now() / 1000),
  license: {
    id: 'https://creativecommons.org/licenses/by/4.0/',
    label: 'CC BY 4.0'
  },
  isFree: true,
  languages: ['en'],
  keywords: [],
  creatorNames: ['Test Author'],
  encodings: [
    {
      url: 'https://example.com/file.pdf',
      mimeType: 'application/pdf',
      name: 'file.pdf',
      size: 1024
    }
  ],
  externalUrls: ['https://example.com/reference']
};

describe('AMBResourceView', () => {
  it('external link hrefs preserve full URLs', () => {
    const { container } = render(AMBResourceView, {
      props: { event: mockEvent, resource: mockResource }
    });

    const externalLinks = container.querySelectorAll('a[target="_blank"]');
    const hrefs = Array.from(externalLinks).map((a) => a.getAttribute('href'));

    // License link
    expect(hrefs).toContain('https://creativecommons.org/licenses/by/4.0/');
    // File view link
    expect(hrefs).toContain('https://example.com/file.pdf');
    // External reference link
    expect(hrefs).toContain('https://example.com/reference');

    // None should be mangled by resolve()
    for (const href of hrefs) {
      expect(href).not.toMatch(/^\.\/ttps:/);
      expect(href).not.toMatch(/^\.\/ttp:/);
    }
  });

  it('file download links preserve full URLs', () => {
    const { container } = render(AMBResourceView, {
      props: { event: mockEvent, resource: mockResource }
    });

    const downloadLinks = container.querySelectorAll('a[download]');
    expect(downloadLinks.length).toBeGreaterThan(0);

    for (const link of downloadLinks) {
      const href = link.getAttribute('href');
      expect(href).toBe('https://example.com/file.pdf');
    }
  });
});
