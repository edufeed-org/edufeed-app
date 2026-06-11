/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';

// jsdom does not implement matchMedia — stub before any module that touches
// app-settings.svelte.js is imported (transitively via forms.js → event-factory).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = () =>
    /** @type {any} */ ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    });
}

// -----------------------------
// Mock infra (hoisted)
// -----------------------------

/** @type {Map<string, BehaviorSubject<any>>} */
const replaceableSubjects = vi.hoisted(() => new Map());

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    /**
     * @param {number} kind
     * @param {string} pubkey
     * @param {string} identifier
     */
    replaceable(kind, pubkey, identifier) {
      const key = `${kind}:${pubkey}:${identifier}`;
      let subj = replaceableSubjects.get(key);
      if (!subj) {
        subj = new BehaviorSubject(null);
        replaceableSubjects.set(key, subj);
      }
      return subj;
    }
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.example']
}));

// Use the real paraglide bundle (deterministic English defaults in tests).
// No mock here — we want to assert real translated labels appear.

const ExtensionMetadataPanel = (await import('../educational/ExtensionMetadataPanel.svelte'))
  .default;

beforeEach(() => {
  replaceableSubjects.clear();
});

describe('ExtensionMetadataPanel', () => {
  it('renders nothing when the event has no extension metadata', () => {
    const event = {
      tags: [
        ['d', 'res-1'],
        ['name', 'Pythagoras']
      ]
    };
    const { container } = render(ExtensionMetadataPanel, { props: { event } });
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders registered EKW labels for ext:ekw:* tags (new shape)', () => {
    const event = {
      tags: [
        ['ext:ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/5-6'],
        ['ext:ekw:gradeLevel:prefLabel:de', '5–6'],
        ['ext:ekw:gradeLevel:type', 'Concept'],
        ['ext:ekw:methodOther', 'Freie Methode A'],
        ['ext:ekw:methodOther', 'Freie Methode B']
      ]
    };
    const { getByText, getAllByText } = render(ExtensionMetadataPanel, { props: { event } });

    // Section heading from the registered ekw variant's extensionLabels.sectionKey
    expect(getByText(/EKKW Metadata/i)).toBeTruthy();
    // Concept facet label from the registry mapping
    expect(getByText(/Grade Level/i)).toBeTruthy();
    // Concept's German prefLabel renders as a badge
    expect(getByText('5–6')).toBeTruthy();
    // Scalar facet ("methodOther") — both lines render
    expect(getByText('Freie Methode A')).toBeTruthy();
    expect(getByText('Freie Methode B')).toBeTruthy();
    // Scalar facet label from the registry
    expect(getAllByText(/Method \(Free-text\)/i).length).toBeGreaterThan(0);
  });

  it('renders registered EKW labels for legacy ekw:* tags identically (regression)', () => {
    const event = {
      tags: [
        ['ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/5-6'],
        ['ekw:gradeLevel:prefLabel:de', '5–6'],
        ['ekw:gradeLevel:type', 'Concept']
      ]
    };
    const { getByText } = render(ExtensionMetadataPanel, { props: { event } });
    expect(getByText(/EKKW Metadata/i)).toBeTruthy();
    expect(getByText(/Grade Level/i)).toBeTruthy();
    expect(getByText('5–6')).toBeTruthy();
  });

  it('linkifies bibleReference scalars to die-bibel.de', () => {
    const event = {
      tags: [
        ['ext:ekw:bibleReference', 'Mt 5,3-12'],
        ['ext:ekw:bibleReference', 'Freitext-Notiz']
      ]
    };
    const { getByText, container } = render(ExtensionMetadataPanel, { props: { event } });

    // Canonical reference becomes a link to die-bibel.de (LU17 / Lutherbibel 2017).
    const link = /** @type {HTMLAnchorElement | null} */ (
      container.querySelector('a[href^="https://www.die-bibel.de/bibel/LU17/"]')
    );
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://www.die-bibel.de/bibel/LU17/MAT.5.3-12');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.textContent?.trim()).toBe('Mt 5,3-12');

    // Free-form text that doesn't start with a known book stays as plain text.
    const plain = getByText('Freitext-Notiz');
    expect(plain.tagName).not.toBe('A');
  });

  it('humanizes facet ids when the namespace has no registered variant and no form back-ref', () => {
    const event = {
      tags: [
        ['ext:foo:someFieldId:id', 'https://example.org/x'],
        ['ext:foo:someFieldId:prefLabel:de', 'Wert X'],
        ['ext:foo:someFieldId:type', 'Concept']
      ]
    };
    const { getByText } = render(ExtensionMetadataPanel, { props: { event } });
    // Humanized facet id: "someFieldId" → "Some Field Id"
    expect(getByText(/Some Field Id/)).toBeTruthy();
    expect(getByText('Wert X')).toBeTruthy();
  });

  it('uses the form authors field labels when the resource has a 30168 back-ref', async () => {
    const formPubkey = 'b'.repeat(64);
    const formDTag = 'my-form';
    const formAddress = `30168:${formPubkey}:${formDTag}`;
    const ns = `30168:${formPubkey}:${formDTag}`;

    const event = {
      tags: [
        ['a', formAddress, 'wss://relay.example', 'form'],
        [`ext:${ns}:kompetenzen:id`, 'https://example.org/komp/arg'],
        [`ext:${ns}:kompetenzen:prefLabel:de`, 'Argumentieren'],
        [`ext:${ns}:kompetenzen:type`, 'Concept']
      ]
    };

    // Pre-seed the eventStore for the form back-ref. The component's
    // $effect will subscribe to eventStore.replaceable(30168, pub, d) and
    // immediately get this event via BehaviorSubject's initial replay.
    const formEvent = {
      kind: 30168,
      pubkey: formPubkey,
      created_at: 1,
      id: 'fid',
      sig: 'sig',
      content: '',
      tags: [
        ['d', formDTag],
        ['name', 'Mein Lehrplan'],
        ['field', 'kompetenzen', 'concept', 'Kompetenzbereiche', '']
      ]
    };
    const subj = new BehaviorSubject(formEvent);
    replaceableSubjects.set(`30168:${formPubkey}:${formDTag}`, subj);

    const { findByText } = render(ExtensionMetadataPanel, { props: { event } });

    // Author-defined field label appears once the form arrives
    expect(await findByText('Kompetenzbereiche')).toBeTruthy();
    // The concept's prefLabel still renders as a badge
    expect(await findByText('Argumentieren')).toBeTruthy();
  });

  it('renders registered Konfi labels for ext:ekw:konfi:* tags via EXTENSION_NAMESPACE_LABELS', () => {
    const event = {
      tags: [
        ['ext:ekw:konfi:zielgruppen:id', 'urn:ku3'],
        ['ext:ekw:konfi:zielgruppen:prefLabel:de', 'KU3'],
        ['ext:ekw:konfi:zielgruppen:type', 'Concept'],
        ['ext:ekw:konfi:subtitle', 'Eine Einheit zur Taufe'],
        ['ext:ekw:konfi:plainLanguage', 'true']
      ]
    };
    const { getByText, queryByText } = render(ExtensionMetadataPanel, { props: { event } });

    // Section heading from EXTENSION_NAMESPACE_LABELS['ekw:konfi'].sectionKey
    expect(getByText(/Konfi-Arbeit-Metadaten|Confirmation Work Metadata/i)).toBeTruthy();
    // Concept facet label from the registry mapping
    expect(getByText(/Zielgruppen|Target groups/i)).toBeTruthy();
    // Concept's German prefLabel renders as a badge
    expect(getByText('KU3')).toBeTruthy();
    // Legacy subtitle scalar still renders (registry kept for backward compat)
    expect(getByText(/Untertitel|Subtitle/i)).toBeTruthy();
    expect(getByText('Eine Einheit zur Taufe')).toBeTruthy();
    // Boolean facet (plainLanguage=true) renders the label itself, not the literal "true"
    expect(
      getByText(
        /Ist der Inhalt in einfacher Sprache verfasst\?|Is the content written in plain language\?/i
      )
    ).toBeTruthy();
    expect(queryByText('true')).toBeNull();
  });

  it('hides boolean facets whose value is "false"', () => {
    const event = {
      tags: [
        ['ext:ekw:konfi:zielgruppen:id', 'urn:ku3'],
        ['ext:ekw:konfi:zielgruppen:prefLabel:de', 'KU3'],
        ['ext:ekw:konfi:zielgruppen:type', 'Concept'],
        ['ext:ekw:konfi:plainLanguage', 'false']
      ]
    };
    const { queryByText } = render(ExtensionMetadataPanel, { props: { event } });

    // The boolean facet label must NOT appear at all when value is false
    expect(
      queryByText(
        /Ist der Inhalt in einfacher Sprache verfasst\?|Is the content written in plain language\?/i
      )
    ).toBeNull();
    expect(queryByText('false')).toBeNull();
  });
});
