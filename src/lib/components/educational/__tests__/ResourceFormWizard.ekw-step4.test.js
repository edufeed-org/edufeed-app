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
import { toSkosConcepts } from '$lib/data/ekwLearningResourceTypes.js';

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
