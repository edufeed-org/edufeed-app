// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import AMBResourceCard from '../educational/AMBResourceCard.svelte';

// Hoisted so vi.mock factory can reference it
const { BookmarkButtonStub } = vi.hoisted(() => ({
  BookmarkButtonStub: vi.fn(() => ({}))
}));

// Mock dependencies (copied from AMBResourceCard.test.js)
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseForHash: () => () => null,
  useLicenseStatus: () => () => ({ event: null, status: 'loading' })
}));
vi.mock('$lib/paraglide/messages.js', () => ({
  amb_resource_free: () => 'Free',
  interactive_badge: () => 'Interactive',
  amb_resource_view_content: () => 'View Content',
  amb_resource_open_content: () => 'Open Content',
  event_tags_view_all_tooltip: () => '',
  event_tags_more_count: () => '',
  debug_panel_raw_nostr_event: () => '',
  common_copied: () => '',
  common_copy: () => '',
  amb_card_linked_materials: (/** @type {{count: number}} */ { count }) =>
    `${count} linked materials`,
  amb_card_linked_materials_one: () => '1 linked material',
  amb_card_linked_material_type_pdf: () => 'PDF',
  amb_card_linked_material_type_image: () => 'Image',
  amb_card_linked_material_type_video: () => 'Video',
  amb_card_linked_material_type_audio: () => 'Audio',
  amb_card_linked_material_type_presentation: () => 'Presentation',
  amb_card_linked_material_type_spreadsheet: () => 'Spreadsheet',
  amb_card_linked_material_type_document: () => 'Document',
  amb_card_linked_material_type_archive: () => 'Archive',
  amb_card_linked_material_type_text: () => 'Text file',
  amb_card_linked_material_type_link: () => 'Link',
  amb_card_linked_material_type_file: () => 'File'
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
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/EventDebugPanel.svelte', () => ({ default: () => ({}) }));
vi.mock('../calendar/EventTags.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/MarkdownRenderer.svelte', () => ({ default: () => ({}) }));
vi.mock('../bookmarks/BookmarkButton.svelte', () => ({ default: BookmarkButtonStub }));

const base = {
  id: 'id1',
  identifier: 'https://x',
  pubkey: 'pk',
  created_at: 1,
  kind: 30142,
  name: 'Quiz',
  description: '',
  image: '',
  types: [],
  learningResourceTypes: [],
  subjects: [],
  educationalLevels: [],
  keywords: [],
  languages: [],
  license: '',
  isFree: true,
  publishedDate: Math.floor(Date.now() / 1000),
  creatorNames: [],
  resourceURLs: [],
  primaryURL: '',
  encodings: [],
  externalUrl: '',
  externalUrls: [],
  tags: [],
  rawEvent: { tags: [] }
};

describe('AMBResourceCard interactive badge', () => {
  beforeEach(() => {
    BookmarkButtonStub.mockClear();
  });

  it('shows the badge for x-webxdc encodings', () => {
    const resource = {
      ...base,
      encodings: [{ url: 'u', mimeType: 'application/x-webxdc', sha256: 'aa' }]
    };
    const { getByText } = render(AMBResourceCard, { props: { resource } });
    expect(getByText(/Interactive|Interaktiv/)).toBeTruthy();
  });

  it('hides it otherwise', () => {
    const { queryByText } = render(AMBResourceCard, { props: { resource: base } });
    expect(queryByText(/Interactive|Interaktiv/)).toBeNull();
  });

  it('shows the badge in list variant', () => {
    const resource = {
      ...base,
      encodings: [{ url: 'u', mimeType: 'application/x-webxdc', sha256: 'aa' }]
    };
    const { getByText } = render(AMBResourceCard, {
      props: { resource, variant: 'list' }
    });
    expect(getByText(/Interactive|Interaktiv/)).toBeTruthy();
  });

  it('hides the badge in list variant when no webxdc encodings', () => {
    const { queryByText } = render(AMBResourceCard, {
      props: { resource: base, variant: 'list' }
    });
    expect(queryByText(/Interactive|Interaktiv/)).toBeNull();
  });
});
