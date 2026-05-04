/**
 * EKW step 4 — LRT picker contract test.
 *
 * Validates the wiring contract for Task 6: feed `toSkosConcepts()` from the
 * EKW LRT data file into SKOSDropdown and verify the rendered option labels
 * match the EKW taxonomy (not bare HCRT). This test stops short of mounting
 * the wizard itself because step 4 is gated behind a multi-step navigation
 * with auto-advance setTimeouts, which is brittle to drive in jsdom. The
 * wizard branch is a 4-line `{#if isEkw}` conditional whose only meaningful
 * behaviour is the `concepts={ekwLrtConcepts}` prop wiring — that prop's
 * effect on rendered options is exactly what this test pins down.
 *
 * Pure data-shape coverage of `toSkosConcepts()` already lives in
 * `src/lib/data/__tests__/ekwLearningResourceTypes.test.js`. This test adds
 * the rendering layer on top: real SKOSDropdown + real skosLoader helpers +
 * real EKW vocabulary, only paraglide locale/messages mocked.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import SKOSDropdown from '../SKOSDropdown.svelte';
import {
  toSkosConcepts,
  migrateLrtForEkw,
  EKW_LRT_ID_PREFIX
} from '$lib/data/ekwLearningResourceTypes.js';
import { getAMBLearningResourceTypes } from '$lib/helpers/educational/ambHelpers.js';

// Force German locale so the EKW labels (which only have a `de` variant)
// render via the preferred-language path in getConceptLabel.
vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

vi.mock('$lib/paraglide/messages', () => ({
  skos_dropdown_select: () => 'Auswählen…',
  skos_dropdown_search: () => 'Suchen…',
  skos_dropdown_no_results: () => 'Keine Treffer',
  skos_dropdown_expand: () => 'Aufklappen',
  skos_dropdown_collapse: () => 'Zuklappen',
  skos_loading: () => 'Lädt…',
  skos_maximum_reached: () => 'Maximum erreicht',
  skos_selected: (/** @type {{ count: number }} */ { count }) => `${count} ausgewählt`
}));

beforeEach(() => {
  cleanup();
  // jsdom doesn't implement scrollIntoView — SKOSDropdown calls it on the
  // active option when the panel opens.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('EKW step 4 — LRT picker contract', () => {
  it('renders EKW LRT leaves with German labels and not bare HCRT labels', async () => {
    const concepts = toSkosConcepts();

    const { container } = render(SKOSDropdown, {
      props: {
        concepts,
        selected: [],
        label: 'Resource type',
        placeholder: 'Select',
        multiple: true
      }
    });

    // Open the dropdown panel.
    const trigger = /** @type {HTMLElement} */ (container.querySelector('button[role="combobox"]'));
    expect(trigger).toBeTruthy();
    await fireEvent.click(trigger);

    await waitFor(() => {
      const options = container.querySelectorAll('[role="option"]');
      expect(options.length).toBeGreaterThan(0);
    });

    const optionTexts = Array.from(container.querySelectorAll('[role="option"]')).map(
      (el) => el.textContent?.trim().replace(/\s+/g, ' ') ?? ''
    );

    // EKW vocab should expose these specific leaves:
    expect(optionTexts.some((t) => t.includes('Arbeitsblatt'))).toBe(true);
    expect(optionTexts.some((t) => t.includes('Audio › Erklär-Audio'))).toBe(true);

    // Sentinel: HCRT exposes a bare "Audio" top-level concept; under EKW
    // we should only see nested children with the "Audio › …" prefix,
    // never a bare "Audio" option text on its own.
    expect(optionTexts.some((t) => t === 'Audio')).toBe(false);
  });

  it('feeds every concept from toSkosConcepts() into the dropdown', async () => {
    const concepts = toSkosConcepts();

    const { container } = render(SKOSDropdown, {
      props: {
        concepts,
        selected: [],
        label: 'Resource type',
        placeholder: 'Select',
        multiple: true
      }
    });

    const trigger = /** @type {HTMLElement} */ (container.querySelector('button[role="combobox"]'));
    await fireEvent.click(trigger);

    await waitFor(() => {
      const options = container.querySelectorAll('[role="option"]');
      // Every leaf in the EKW vocab should be represented as an option row.
      expect(options.length).toBe(concepts.length);
    });
  });
});

/**
 * Edit-mode legacy LRT migration contract (Task 7).
 *
 * Mounting the full wizard in jsdom is impractical — the wizard pulls in
 * SvelteKit nav, applesauce account/relay infrastructure, blossom uploaders,
 * etc., several of which hit module-load issues in jsdom (matchMedia,
 * effect_update_depth_exceeded under the missing infrastructure). The wizard
 * also opens at step 1 and the LRT picker is on step 4, so reaching the chip
 * would require driving the full multi-step navigation in jsdom.
 *
 * This focused unit test instead reproduces the exact data path the wizard's
 * edit-mode prefill executes for the EKW variant:
 *
 *   const lrtTypes = getAMBLearningResourceTypes(editEvent, locale);
 *   formData.learningResourceType = isEkw
 *     ? migrateLrtForEkw(lrtTypes.map(...))
 *     : lrtTypes.map(...);
 *
 * It then renders SKOSDropdown with that migrated array as `selected` and
 * asserts the chip in the DOM carries `data-skos-chip-id` starting with
 * `EKW_LRT_ID_PREFIX`. This pins both:
 *   - migrateLrtForEkw correctly remaps HCRT id+German label to an EKW leaf
 *   - the chip exposes `data-skos-chip-id` so the wizard's eventual e2e
 *     coverage (or manual smoke check) can target the rendered selection
 */
describe('EKW step 4 — edit-mode legacy LRT migration', () => {
  it('migrates HCRT-id learningResourceType from an edit event to an EKW leaf and renders it as a chip', () => {
    // Synthetic kind-30142 event with a legacy HCRT id whose German prefLabel
    // matches the EKW leaf "Arbeitsblatt".
    /** @type {any} */
    const editEvent = {
      kind: 30142,
      pubkey: '0'.repeat(64),
      created_at: 1700000000,
      content: '',
      tags: [
        ['d', 'test'],
        ['name', 'Test'],
        ['identifier', 'https://example.org/test'],
        ['learningResourceType:id', 'https://w3id.org/kim/hcrt/text'],
        ['learningResourceType:prefLabel:de', 'Arbeitsblatt']
      ]
    };

    // Step 1: extract the same way the wizard does in edit mode.
    const lrtTypes = getAMBLearningResourceTypes(editEvent, 'de');
    expect(lrtTypes.length).toBe(1);
    expect(lrtTypes[0].id).toBe('https://w3id.org/kim/hcrt/text');
    expect(lrtTypes[0].label).toBe('Arbeitsblatt');

    // Step 2: apply the EKW-variant migration (the exact wiring under test).
    const compact = lrtTypes.map((t) => ({ id: t.id, label: t.label }));
    const migrated = migrateLrtForEkw(compact);

    // Sanity: the migration must produce exactly one EKW-prefixed concept.
    expect(migrated.length).toBe(1);
    expect(migrated[0].id.startsWith(EKW_LRT_ID_PREFIX)).toBe(true);

    // Step 3: render the dropdown with the migrated list as `selected` —
    // mirrors the runtime shape the wizard binds into SKOSDropdown.
    const { container } = render(SKOSDropdown, {
      props: {
        concepts: toSkosConcepts(),
        selected: migrated,
        label: 'Resource type',
        placeholder: 'Select',
        multiple: true
      }
    });

    // Assert: the rendered chip carries data-skos-chip-id with the EKW id.
    const chips = container.querySelectorAll('[data-skos-chip-id]');
    expect(chips.length).toBe(1);
    const id = chips[0].getAttribute('data-skos-chip-id') ?? '';
    expect(id.startsWith(EKW_LRT_ID_PREFIX)).toBe(true);
  });
});
