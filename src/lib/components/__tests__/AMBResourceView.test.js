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
  amb_resource_target_audience: () => 'Target Audience',
  amb_resource_subjects: () => 'Subjects',
  amb_resource_available_languages: () => 'Languages',
  amb_resource_access: () => 'Access',
  amb_resource_free: () => 'Free',
  amb_resource_paid: () => 'Paid',
  amb_resource_license: () => 'License',
  amb_resource_view_license: () => 'View License',
  amb_resource_topics_keywords: () => 'Topics',
  amb_resource_creators_heading: () => 'Creators',
  amb_resource_role_creator: () => 'Creator',
  amb_resource_indexed_by: () => 'Indexed by',
  amb_resource_from_metadata: () => 'from metadata',
  amb_resource_related_resources: () => 'Related',
  amb_resource_uploaded_files: () => 'Uploaded Files',
  amb_resource_open_pdf_inline_fallback: () => 'Open PDF in a new tab',
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
    profile?.name || fallback,
  getTagValue: (/** @type {any} */ event, /** @type {string} */ name) =>
    event?.tags?.find((/** @type {string[]} */ t) => t[0] === name)?.[1]
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
vi.mock('$lib/helpers/educational/ambTransform.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    getLabelsWithFallback: () => [],
    getLanguageDisplayName: (/** @type {string} */ code) => {
      /** @type {Record<string, string>} */
      const names = { de: 'German', en: 'English', fr: 'French' };
      return names[code] || code;
    }
  };
});
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
  encodeEventToNaddr: vi.fn(() => 'naddr1test'),
  profileLink: vi.fn((/** @type {string} */ pubkey) => (pubkey ? `/p/${pubkey}` : '#'))
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
vi.mock('../educational/ExtensionMetadataPanel.svelte', () => ({ default: () => ({}) }));
vi.mock('../bookmarks/BookmarkButton.svelte', () => ({ default: () => ({}) }));
vi.mock('$lib/components/icons', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual };
});

// PdfInlineViewer lazy-imports pdfjs-dist + a worker — neither runs cleanly
// in jsdom. Stub it so EncodingPreview's PDF branch is testable without a
// real Web Worker / canvas; the stub exposes props as data-attrs.
vi.mock('$lib/components/educational/PdfInlineViewer.svelte', async () => {
  const Stub = (await import('./fixtures/PdfInlineViewerStub.svelte')).default;
  return { default: Stub };
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

  it('renders contributor placeholders without broken robohash images', () => {
    // Anti-regression: name-only contributors used to point <img> at
    // robohash.org, which left a broken-image icon when robohash failed.
    const eventWithCreators = {
      ...mockEvent,
      tags: [
        ...mockEvent.tags,
        ['creator:name', 'John Sankey'],
        ['creator:type', 'Person'],
        ['creator:name', 'Bernd Ost'],
        ['creator:type', 'Person']
      ]
    };
    const { container } = render(AMBResourceView, {
      props: { event: eventWithCreators, resource: mockResource }
    });

    // No contributor avatar should rely on robohash.
    const robohashImgs = container.querySelectorAll('img[src*="robohash"]');
    expect(robohashImgs.length).toBe(0);

    // Each name-only contributor renders an initial-letter placeholder.
    // (Scoped: the "Indexed by" provenance row renders its own fallback.)
    const fallbacks = Array.from(container.querySelectorAll('.av-fallback')).filter(
      (el) => !el.closest('[data-testid="indexed-by-section"]')
    );
    expect(fallbacks.length).toBe(2);
    expect(fallbacks[0].textContent?.trim()).toBe('J');
    expect(fallbacks[1].textContent?.trim()).toBe('B');
  });

  describe('creators & roles section', () => {
    const CREATOR_PK = 'f'.repeat(64);
    const singleCreatorEvent = {
      ...mockEvent,
      tags: [
        ['d', 'test-resource'],
        ['name', 'Test Resource'],
        ['creator:name', 'Corinna Link'],
        ['creator:type', 'Person'],
        ['creator:honorificPrefix', 'Dr.'],
        ['creator:id', 'https://orcid.org/0000-0002-1825-0097'],
        ['creator:affiliation:name', 'Comenius-Institut'],
        ['p', CREATOR_PK, 'wss://x', 'creator']
      ]
    };

    it('renders for a single creator (no more >1 gate)', () => {
      const { container } = render(AMBResourceView, {
        props: { event: singleCreatorEvent, resource: mockResource }
      });

      const names = [...container.querySelectorAll('.ed-contrib .name')].map((e) =>
        e.textContent?.trim()
      );
      expect(names).toContain('Dr. Corinna Link');
    });

    it('shows role, affiliation, and ORCID for a creator', () => {
      const { container } = render(AMBResourceView, {
        props: { event: singleCreatorEvent, resource: mockResource }
      });

      const section = container.querySelector('.ed-contrib-grid');
      expect(section?.textContent).toContain('Creator');
      expect(section?.textContent).toContain('Comenius-Institut');
      const orcidLink = section?.querySelector('a[href="https://orcid.org/0000-0002-1825-0097"]');
      expect(orcidLink).toBeTruthy();
    });

    it('renders a structured creator and a creator p-tag as two distinct entries', () => {
      // NIP-AMB: a person is EITHER a creator:* run OR a p-tag, never both —
      // so one of each on an event means two different people. (The old
      // "1+1 = same person" merge stitched the structured name onto the
      // p-tag identity's avatar and hid a creator.)
      const { container } = render(AMBResourceView, {
        props: { event: singleCreatorEvent, resource: mockResource }
      });

      // Scoped: the "Indexed by" provenance row renders its own .ed-contrib.
      const entries = Array.from(container.querySelectorAll('.ed-contrib')).filter(
        (e) => !e.closest('[data-testid="indexed-by-section"]')
      );
      expect(entries.length).toBe(2);

      // The p-tag person links to their Nostr profile…
      const profileAnchor = container.querySelector(`.ed-contrib a[href="/p/${CREATOR_PK}"]`);
      expect(profileAnchor).toBeTruthy();

      // …while the structured (non-Nostr) creator's name is NOT profile-linked.
      const structuredEntry = [...entries].find((e) => e.textContent?.includes('Dr. Corinna Link'));
      expect(structuredEntry?.querySelector(`a[href="/p/${CREATOR_PK}"]`)).toBeFalsy();
    });

    it('renders nothing when the event has no creator data', () => {
      const { container } = render(AMBResourceView, {
        props: { event: mockEvent, resource: mockResource }
      });
      expect(container.querySelector('.ed-contrib-grid')).toBeNull();
    });
  });

  describe('indexed resource provenance (indexer ≠ creator)', () => {
    const indexedEvent = {
      ...mockEvent,
      tags: [
        ['d', 'https://oerf-journal.eu/index.php/oerf/article/view/605'],
        ['name', 'Aufbruch ins Unbekannte'],
        ['creator:name', 'Regina Polak'],
        ['creator:type', 'Person']
      ]
    };

    it('renders an "Indexed by" section crediting the publisher', () => {
      const { container } = render(AMBResourceView, {
        props: { event: indexedEvent, resource: mockResource }
      });
      const section = container.querySelector('[data-testid="indexed-by-section"]');
      expect(section).toBeTruthy();
      expect(section?.textContent).toContain('Indexed by');
      // Publisher (profile not loaded in tests) falls back to the pubkey slice, linked
      const link = section?.querySelector(`a[href="/p/${mockEvent.pubkey}"]`);
      expect(link).toBeTruthy();
    });

    it('annotates metadata-only creators with "from metadata"', () => {
      const { container } = render(AMBResourceView, {
        props: { event: indexedEvent, resource: mockResource }
      });
      const grid = container.querySelector('.ed-contrib-grid');
      expect(grid?.textContent).toContain('Regina Polak');
      expect(grid?.textContent).toContain('from metadata');
    });

    it('shows the metadata creator in the DetailHeader byline instead of the indexer', () => {
      const { container } = render(AMBResourceView, {
        props: { event: indexedEvent, resource: mockResource }
      });
      const toolbar = container.querySelector('[data-testid="metadata-avatar"]');
      expect(toolbar).toBeTruthy();
      expect(toolbar?.textContent?.trim()).toBe('RP');
    });

    it('renders no "Indexed by" section for own content (creator p-tag = pubkey)', () => {
      const ownEvent = {
        ...indexedEvent,
        tags: [...indexedEvent.tags, ['p', mockEvent.pubkey, '', 'creator']]
      };
      const { container } = render(AMBResourceView, {
        props: { event: ownEvent, resource: mockResource }
      });
      expect(container.querySelector('[data-testid="indexed-by-section"]')).toBeNull();
      expect(container.querySelector('[data-testid="metadata-avatar"]')).toBeNull();
    });
  });

  it('mounts the PDF inline viewer for PDF encodings', () => {
    const { container } = render(AMBResourceView, {
      props: { event: mockEvent, resource: mockResource }
    });

    const stub = container.querySelector('[data-testid="pdf-viewer-stub"]');
    expect(stub).toBeTruthy();
    expect(stub?.getAttribute('data-src')).toBe('https://example.com/file.pdf');
  });

  // Regression for a real event (kind 30142, d=u5mfchck): the creator run
  // was duplicated in the tags and the p-tag carried an nsec instead of a
  // pubkey. The duplicate names crashed the page (each_key_duplicate) and
  // the nsec was rendered as a contributor.
  describe('malformed creator data (real-world event shape)', () => {
    const dirtyEvent = {
      ...mockEvent,
      tags: [
        ['d', 'u5mfchck'],
        ['name', 'Test Resource'],
        ['creator:name', 'Corinna Link'],
        ['creator:type', 'Person'],
        ['creator:name', 'Corinna Link'],
        ['creator:type', 'Person'],
        ['creator:name', 'Second Author'],
        ['creator:type', 'Person'],
        [
          'p',
          'nsec1ashx20k9x3qshzah8ktnu7da529wg8ps29fa30khrwhc0zpam20qpdw7q4',
          'wss://x',
          'creator'
        ],
        ['p', 'f'.repeat(64), 'wss://x', 'creator']
      ]
    };

    it('renders without throwing on duplicated creator names', async () => {
      const { formatAMBResource } = await import('$lib/helpers/educational/ambHelpers.js');
      const resource = formatAMBResource(dirtyEvent);
      expect(() =>
        render(AMBResourceView, { props: { event: dirtyEvent, resource } })
      ).not.toThrow();
    });

    it('shows the duplicated creator only once and never renders an nsec p-tag', async () => {
      const { formatAMBResource } = await import('$lib/helpers/educational/ambHelpers.js');
      const resource = formatAMBResource(dirtyEvent);
      const { container } = render(AMBResourceView, {
        props: { event: dirtyEvent, resource }
      });

      // The leaked private key must never appear anywhere in the DOM.
      expect(container.textContent).not.toContain('nsec1');

      // Contributors grid: each person once — the duplicate run collapsed,
      // the invalid p-tag dropped (only the one valid hex p-tag remains).
      const contribNames = [...container.querySelectorAll('.ed-contrib .name')].map((el) =>
        el.textContent?.trim()
      );
      expect(contribNames.filter((n) => n === 'Corinna Link')).toHaveLength(1);
      expect(contribNames.filter((n) => n === 'Second Author')).toHaveLength(1);
    });
  });
});

// EKW/extension metadata rendering moved to ExtensionMetadataPanel.test.js.
// AMBResourceView mocks ExtensionMetadataPanel out (see vi.mock above) so the
// child's behavior is tested in isolation rather than through the parent.
