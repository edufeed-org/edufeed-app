/**
 * AMBResourceView Component Tests
 *
 * Verifies that external URLs (license, files, external references) are not
 * broken by SvelteKit's resolve() function, which is only meant for internal routes.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { writable } from 'svelte/store';

// Mutable state read by the form-to-amb and accounts mocks below.
// Tests can set these before render to simulate different scenarios.
// vi.hoisted makes this available to vi.mock factories despite hoisting.
const { mockState } = vi.hoisted(() => ({
  mockState:
    /** @type {{ formRef: { address: string; relay: string } | null; activeUserPubkey: string | null }} */ ({
      formRef: null,
      activeUserPubkey: null
    })
}));

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
  common_back: () => 'Back',
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
  event_menu_unfeatured_toast: () => 'Removed from homepage',
  aria_event_menu: () => 'Event menu',
  toast_resource_deleted: () => 'Resource deleted successfully',
  toast_resource_delete_failed: () => 'Failed to delete resource',
  toast_resource_delete_error: () => 'An error occurred while deleting the resource',
  amb_resource_creator_alt: () => 'Creator',
  amb_resource_more_creators: (/** @type {{ count: number }} */ { count }) => `+${count} more`,
  amb_resource_published: (/** @type {{ date: string }} */ { date }) => `Published ${date}`,
  amb_resource_published_label: () => 'Published',
  amb_resource_edit_in_form: () => 'Edit in form',
  amb_resource_nostr_native_description: () =>
    'This content is stored on the Nostr network and available directly without external dependencies.',
  amb_resource_view_file: () => 'View',
  amb_resource_download_file: () => 'Download',
  amb_resource_external_references: () => 'External References',
  amb_resource_external_reference: () => 'External Reference',
  amb_resource_ekw_metadata: () => 'EKKW-Metadaten',
  amb_resource_ekw_grade_level: () => 'Klassenstufe',
  amb_resource_ekw_school_type: () => 'Schulart',
  amb_resource_ekw_didactic_concept: () => 'Didaktisches Konzept',
  amb_resource_ekw_method: () => 'Methode',
  amb_resource_ekw_method_other: () => 'Methode (Freitext)',
  amb_resource_ekw_bible_reference: () => 'Bibelstelle'
}));
vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'en'
}));
vi.mock('applesauce-core/helpers', () => ({
  getProfilePicture: (/** @type {any} */ profile) => profile?.picture || null,
  getDisplayName: (/** @type {any} */ profile, /** @type {string} */ fallback) =>
    profile?.name || fallback
}));
vi.mock('$lib/helpers/navigationHistory.js', () => ({
  getHasHistory: () => true,
  getFallbackRoute: () => '/'
}));
vi.mock('$lib/helpers/form-to-amb.js', () => ({
  getFormReferenceFromResource: () => mockState.formRef
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
  useActiveUser: () => () =>
    mockState.activeUserPubkey ? { pubkey: mockState.activeUserPubkey } : null
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
vi.mock('../bookmarks/BookmarkButton.svelte', () => ({ default: () => ({}) }));
vi.mock('../comments/CommentList.svelte', () => ({ default: () => ({}) }));
vi.mock('../calendar/EventTags.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/CommunityShare.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/MarkdownRenderer.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/EventContextMenu.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/DeleteConfirmModal.svelte', () => ({ default: () => ({}) }));
vi.mock('../bookmarks/BookmarkButton.svelte', () => ({ default: () => ({}) }));
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
  beforeEach(() => {
    mockState.formRef = null;
    mockState.activeUserPubkey = null;
  });

  it('renders a back button via DetailHeader', () => {
    const { container } = render(AMBResourceView, {
      props: { event: mockEvent, resource: mockResource }
    });

    const backButton = container.querySelector('button[aria-label="Back"]');
    expect(backButton).toBeTruthy();
  });

  it('does not render the legacy bespoke 4xl page title', () => {
    // Anti-regression: the old custom <h1 class="text-4xl"> header should be
    // replaced by DetailHeader's slim toolbar + smaller title.
    const { container } = render(AMBResourceView, {
      props: { event: mockEvent, resource: mockResource }
    });

    const legacyTitle = container.querySelector('h1.text-4xl');
    expect(legacyTitle).toBeNull();
  });

  it('hides the inline "Edit in form" button when no formRef is present', () => {
    mockState.activeUserPubkey = mockEvent.pubkey; // owner, but no formRef
    mockState.formRef = null;

    const { queryByText } = render(AMBResourceView, {
      props: { event: mockEvent, resource: mockResource }
    });

    expect(queryByText('Edit in form')).toBeNull();
  });

  it('renders the inline "Edit in form" button when formRef resolves and user owns the resource', () => {
    mockState.activeUserPubkey = mockEvent.pubkey; // owner
    mockState.formRef = { address: '30168:abc:def', relay: 'wss://forms.example.com' };

    const { queryByText } = render(AMBResourceView, {
      props: { event: mockEvent, resource: mockResource }
    });

    expect(queryByText('Edit in form')).toBeTruthy();
  });

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

describe('EKKW-Metadaten section', () => {
  /** @type {any} */
  const minimalAmbResource = {
    pubkey: '0'.repeat(64),
    identifier: 'https://example.org/ekw-lesson',
    name: 'EKKW Lesson',
    description: 'Beschreibung',
    image: '',
    publishedDate: 1_700_000_000,
    languages: ['de'],
    isFree: true,
    license: null,
    keywords: [],
    tags: [],
    rawEvent: null,
    kind: 30142,
    creators: [],
    encodings: [],
    externalUrls: [],
    hasPart: [],
    isPartOf: [],
    creatorNames: []
  };

  function fixtureEvent(/** @type {string[][]} */ ekwTags) {
    return {
      ...minimalAmbResource,
      rawEvent: {
        id: 'eventid',
        pubkey: '0'.repeat(64),
        kind: 30142,
        tags: ekwTags,
        content: '',
        sig: 'sig'
      },
      event: {
        id: 'eventid',
        pubkey: '0'.repeat(64),
        kind: 30142,
        tags: ekwTags,
        content: '',
        sig: 'sig'
      }
    };
  }

  it('renders the EKKW-Metadaten section when EKW tags are present', () => {
    const ekwTags = [
      ['ekw:gradeLevel:id', 'naddr:grade5'],
      ['ekw:gradeLevel:prefLabel:de', 'Klasse 5'],
      ['ekw:gradeLevel:type', 'Concept'],
      ['ekw:schoolType:id', 'naddr:gym'],
      ['ekw:schoolType:prefLabel:de', 'Gymnasium'],
      ['ekw:schoolType:type', 'Concept'],
      ['ekw:didacticConcept:id', 'naddr:problem'],
      ['ekw:didacticConcept:prefLabel:de', 'Problemorientiert'],
      ['ekw:didacticConcept:type', 'Concept'],
      ['ekw:method:id', 'naddr:plenum'],
      ['ekw:method:prefLabel:de', 'Plenum'],
      ['ekw:method:type', 'Concept'],
      ['ekw:methodOther', 'Stuhlkreis'],
      ['ekw:bibleReference', 'Mt 5,1-12']
    ];
    const resource = fixtureEvent(ekwTags);
    const { getByText } = render(AMBResourceView, {
      props: { event: resource.event, resource }
    });
    expect(getByText('EKKW-Metadaten')).toBeTruthy();
    expect(getByText('Klasse 5')).toBeTruthy();
    expect(getByText('Gymnasium')).toBeTruthy();
    expect(getByText('Problemorientiert')).toBeTruthy();
    expect(getByText('Plenum')).toBeTruthy();
    expect(getByText('Methode (Freitext)')).toBeTruthy();
    expect(getByText('Stuhlkreis')).toBeTruthy();
    expect(getByText('Mt 5,1-12')).toBeTruthy();
  });

  it('does not render the EKKW-Metadaten section when no EKW tags are present', () => {
    const resource = fixtureEvent([]);
    const { queryByText } = render(AMBResourceView, {
      props: { event: resource.event, resource }
    });
    expect(queryByText('EKKW-Metadaten')).toBeNull();
  });
});
