/**
 * SKOSDropdown Component Tests
 *
 * Tests trigger styling, ARIA attributes, collapsible hierarchy,
 * keyboard navigation, and search highlighting.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import SKOSDropdown from '../educational/SKOSDropdown.svelte';

// Mock paraglide runtime
vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'en'
}));

// Mock paraglide messages
vi.mock('$lib/paraglide/messages', () => ({
  skos_dropdown_select: () => 'Select...',
  skos_dropdown_search: () => 'Search...',
  skos_dropdown_no_results: () => 'No results found',
  skos_dropdown_expand: () => 'Expand',
  skos_dropdown_collapse: () => 'Collapse',
  skos_loading: () => 'Loading...',
  skos_maximum_reached: () => 'Maximum reached',
  skos_selected: (/** @type {{ count: number }} */ { count }) => `${count} selected`
}));

/** Flat vocabulary (like learningResourceType) */
const flatConcepts = [
  { id: 'https://example.com/text', prefLabel: { en: 'Text' }, level: 0 },
  { id: 'https://example.com/video', prefLabel: { en: 'Video' }, level: 0 },
  { id: 'https://example.com/image', prefLabel: { en: 'Image' }, level: 0 }
];

// Keep a reference to the mock so we can change its behavior per test
const fetchVocabularyMock = vi.fn().mockResolvedValue(flatConcepts);

vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  fetchVocabulary: (/** @type {any[]} */ ...args) => fetchVocabularyMock(...args),
  getConceptLabel: (/** @type {any} */ concept, /** @type {any} */ locale) =>
    concept.prefLabel?.[locale] || concept.id,
  sortConceptsByLabel: (/** @type {any} */ concepts) => concepts,
  filterConcepts: (
    /** @type {any[]} */ concepts,
    /** @type {any} */ searchTerm,
    /** @type {any} */ locale
  ) => {
    if (!searchTerm?.trim()) return concepts;
    const term = searchTerm.toLowerCase().trim();
    return concepts.filter((/** @type {any} */ c) => {
      const label = c.prefLabel?.[locale] || c.id;
      return label.toLowerCase().includes(term);
    });
  }
}));

beforeEach(() => {
  cleanup();
  fetchVocabularyMock.mockReset();
  fetchVocabularyMock.mockResolvedValue(flatConcepts);
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

describe('SKOSDropdown', () => {
  describe('Trigger styling', () => {
    it('renders trigger button with select-trigger class for consistent styling', () => {
      const { container } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'learningResourceType',
          label: 'Resource Type',
          placeholder: 'Select type...'
        }
      });

      const trigger = /** @type {HTMLElement} */ (container.querySelector('button.select-trigger'));
      expect(trigger).toBeTruthy();
      expect(trigger.classList.contains('select')).toBe(true);
      expect(trigger.classList.contains('select-bordered')).toBe(true);
      expect(trigger.classList.contains('select-trigger')).toBe(true);
    });

    it('shows placeholder when nothing is selected', async () => {
      const { container } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'learningResourceType',
          placeholder: 'Pick one...'
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (
          container.querySelector('button.select-trigger')
        );
        expect(trigger.textContent).toContain('Pick one...');
      });
    });

    it('shows loading state initially', () => {
      // Never resolve so it stays loading
      fetchVocabularyMock.mockReturnValue(new Promise(() => {}));

      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      const spinner = container.querySelector('.loading-spinner');
      expect(spinner).toBeTruthy();
    });
  });

  describe('ARIA attributes', () => {
    it('trigger has combobox role and aria attributes', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger).toBeTruthy();
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.getAttribute('aria-controls')).toBe('skos-listbox-learningResourceType');
      });
    });

    it('sets aria-expanded to true when opened', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        const trigger = container.querySelector('[role="combobox"]');
        expect(trigger).toBeTruthy();
      });

      const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
      await fireEvent.click(trigger);

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('renders listbox with correct id when open', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const listbox = /** @type {HTMLElement} */ (container.querySelector('[role="listbox"]'));
      expect(listbox).toBeTruthy();
      expect(listbox.getAttribute('id')).toBe('skos-listbox-learningResourceType');
    });

    it('options have role="option" and aria-selected', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const options = container.querySelectorAll('[role="option"]');
      expect(options.length).toBe(3); // Text, Video, Image
      options.forEach((opt) => {
        expect(opt.getAttribute('aria-selected')).toBe('false');
      });
    });

    it('listbox has aria-multiselectable when multiple', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType', multiple: true }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const listbox = /** @type {HTMLElement} */ (container.querySelector('[role="listbox"]'));
      expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    });
  });

  describe('Dropdown panel sizing', () => {
    it('uses w-full to constrain panel within parent container', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const panel = /** @type {HTMLElement} */ (container.querySelector('.dropdown-content'));
      expect(panel).toBeTruthy();
      expect(panel.classList.contains('w-full')).toBe(true);
    });
  });

  describe('Compact mode', () => {
    it('uses default max-h when compact is not set', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const panel = /** @type {HTMLElement} */ (container.querySelector('.dropdown-content'));
      expect(panel).toBeTruthy();
      expect(panel.className).toContain('max-h-[min(60vh,480px)]');
    });

    it('uses reduced max-h when compact is true', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType', compact: true }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const panel = /** @type {HTMLElement} */ (container.querySelector('.dropdown-content'));
      expect(panel).toBeTruthy();
      expect(panel.className).toContain('max-h-[min(40vh,280px)]');
    });
  });

  describe('Collapsible hierarchy', () => {
    it('shows expand buttons for parent concepts in hierarchical vocabulary', async () => {
      // Use a large hierarchical vocabulary (>30) to trigger auto-collapse
      const largeConcepts = [];
      for (let i = 0; i < 10; i++) {
        largeConcepts.push({
          id: `https://example.com/cat${i}`,
          prefLabel: { en: `Category ${i}` },
          level: 0
        });
        for (let j = 0; j < 3; j++) {
          largeConcepts.push({
            id: `https://example.com/cat${i}/sub${j}`,
            prefLabel: { en: `Sub ${i}-${j}` },
            level: 1,
            parentId: `https://example.com/cat${i}`
          });
        }
      }
      fetchVocabularyMock.mockResolvedValue(largeConcepts);

      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'about' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
      });

      // Wait for the vocabulary to load and collapse effect to run
      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // Should show expand buttons for parent categories
      const expandBtns = container.querySelectorAll('[aria-label="Expand"]');
      expect(expandBtns.length).toBeGreaterThan(0);
    });

    it('does not show expand buttons for flat vocabularies', async () => {
      fetchVocabularyMock.mockResolvedValue(flatConcepts);

      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger).toBeTruthy();
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // Flat concepts have no parentId, so no concept should have children
      const options = container.querySelectorAll('[role="option"]');
      expect(options.length).toBe(3);

      // No expand/collapse toggles should exist inside the listbox
      const listbox = /** @type {HTMLElement} */ (container.querySelector('[role="listbox"]'));
      const expandBtns = listbox.querySelectorAll('[aria-label="Expand"]');
      const collapseBtns = listbox.querySelectorAll('[aria-label="Collapse"]');
      expect(expandBtns.length + collapseBtns.length).toBe(0);
    });

    it('clicking a parent row label selects the parent without toggling expand/collapse', async () => {
      // >30 so auto-collapse triggers and children start hidden
      /** @type {any[]} */
      const hierarchy = [];
      for (let i = 0; i < 10; i++) {
        hierarchy.push({
          id: `https://example.com/cat${i}`,
          prefLabel: { en: `Cat ${i}` },
          level: 0
        });
        for (let j = 0; j < 3; j++) {
          hierarchy.push({
            id: `https://example.com/cat${i}/sub${j}`,
            prefLabel: { en: `Sub ${i}-${j}` },
            level: 1,
            parentId: `https://example.com/cat${i}`
          });
        }
      }
      fetchVocabularyMock.mockResolvedValue(hierarchy);

      const onchange = vi.fn();
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'about', multiple: true, onchange }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger).toBeTruthy();
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // Auto-collapsed: only parents visible initially
      const optionsBefore = container.querySelectorAll('[role="option"]');
      expect(optionsBefore.length).toBe(10);

      // Find the first parent row's label button (the label area, not the chevron)
      const parentRow = /** @type {HTMLElement} */ (optionsBefore[0]);
      const labelButton = /** @type {HTMLButtonElement} */ (
        parentRow.querySelector('button:not([aria-label="Expand"]):not([aria-label="Collapse"])')
      );
      expect(labelButton).toBeTruthy();

      await fireEvent.click(labelButton);

      // Selection IS triggered with the parent concept
      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange.mock.calls[0][0]).toHaveLength(1);
      expect(onchange.mock.calls[0][0][0]).toMatchObject({
        id: 'https://example.com/cat0',
        label: 'Cat 0'
      });

      // Collapse state unchanged: still only the 10 parents visible
      expect(container.querySelectorAll('[role="option"]').length).toBe(10);
    });

    it('clicking the chevron on a parent expands/collapses without selecting', async () => {
      /** @type {any[]} */
      const hierarchy = [];
      for (let i = 0; i < 10; i++) {
        hierarchy.push({
          id: `https://example.com/cat${i}`,
          prefLabel: { en: `Cat ${i}` },
          level: 0
        });
        for (let j = 0; j < 3; j++) {
          hierarchy.push({
            id: `https://example.com/cat${i}/sub${j}`,
            prefLabel: { en: `Sub ${i}-${j}` },
            level: 1,
            parentId: `https://example.com/cat${i}`
          });
        }
      }
      fetchVocabularyMock.mockResolvedValue(hierarchy);

      const onchange = vi.fn();
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'about', multiple: true, onchange }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger).toBeTruthy();
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // Auto-collapsed: only the 10 parents visible
      expect(container.querySelectorAll('[role="option"]').length).toBe(10);

      // Click the chevron (Expand) on the first parent
      const parentRow = /** @type {HTMLElement} */ (
        container.querySelectorAll('[role="option"]')[0]
      );
      const chevron = /** @type {HTMLButtonElement} */ (
        parentRow.querySelector('button[aria-label="Expand"]')
      );
      expect(chevron).toBeTruthy();
      await fireEvent.click(chevron);

      // Children visible
      expect(container.querySelectorAll('[role="option"]').length).toBeGreaterThan(10);
      // No selection
      expect(onchange).not.toHaveBeenCalled();

      // Click again (now Collapse) → collapses back
      const parentRowAgain = /** @type {HTMLElement} */ (
        container.querySelectorAll('[role="option"]')[0]
      );
      const collapseBtn = /** @type {HTMLButtonElement} */ (
        parentRowAgain.querySelector('button[aria-label="Collapse"]')
      );
      await fireEvent.click(collapseBtn);
      expect(container.querySelectorAll('[role="option"]').length).toBe(10);
      expect(onchange).not.toHaveBeenCalled();
    });

    it('Enter key on a parent row selects the parent (keyboard parity)', async () => {
      /** @type {any[]} */
      const hierarchy = [];
      for (let i = 0; i < 10; i++) {
        hierarchy.push({
          id: `https://example.com/cat${i}`,
          prefLabel: { en: `Cat ${i}` },
          level: 0
        });
        for (let j = 0; j < 3; j++) {
          hierarchy.push({
            id: `https://example.com/cat${i}/sub${j}`,
            prefLabel: { en: `Sub ${i}-${j}` },
            level: 1,
            parentId: `https://example.com/cat${i}`
          });
        }
      }
      fetchVocabularyMock.mockResolvedValue(hierarchy);

      const onchange = vi.fn();
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'about', multiple: true, onchange }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const wrapper = /** @type {HTMLElement} */ (container.querySelector('.dropdown'));
      // ArrowDown to first parent, then Enter
      await fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
      await fireEvent.keyDown(wrapper, { key: 'Enter' });

      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange.mock.calls[0][0][0]).toMatchObject({
        id: 'https://example.com/cat0'
      });
      // Collapse state unchanged
      expect(container.querySelectorAll('[role="option"]').length).toBe(10);
    });

    it('clicking a leaf row label still selects', async () => {
      /** @type {any[]} */
      const hierarchy = [{ id: 'https://example.com/cat0', prefLabel: { en: 'Cat 0' }, level: 0 }];
      for (let i = 0; i < 32; i++) {
        // pad to >30 to trigger auto-collapse path (then we expand)
        hierarchy.push({
          id: `https://example.com/leaf${i}`,
          prefLabel: { en: `Leaf ${i}` },
          level: 1,
          parentId: 'https://example.com/cat0'
        });
      }
      fetchVocabularyMock.mockResolvedValue(hierarchy);

      const onchange = vi.fn();
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'about', multiple: true, onchange }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // Expand the parent via the chevron (auto-collapsed initially; label click now selects)
      const parentRow = /** @type {HTMLElement} */ (
        container.querySelectorAll('[role="option"]')[0]
      );
      const chevronBtn = /** @type {HTMLButtonElement} */ (
        parentRow.querySelector('button[aria-label="Expand"]')
      );
      await fireEvent.click(chevronBtn);

      // Pick the first leaf (index 1 after expand)
      const options = container.querySelectorAll('[role="option"]');
      const leafRow = /** @type {HTMLElement} */ (options[1]);
      const leafLabelBtn = /** @type {HTMLButtonElement} */ (
        leafRow.querySelector('button:not([aria-label="Expand"]):not([aria-label="Collapse"])')
      );
      await fireEvent.click(leafLabelBtn);

      expect(onchange).toHaveBeenCalledTimes(1);
      expect(onchange.mock.calls[0][0]).toHaveLength(1);
    });

    it('during search, clicking any row label selects (chevrons hide)', async () => {
      /** @type {any[]} */
      const hierarchy = [];
      for (let i = 0; i < 10; i++) {
        hierarchy.push({
          id: `https://example.com/cat${i}`,
          prefLabel: { en: `Cat ${i}` },
          level: 0
        });
        for (let j = 0; j < 3; j++) {
          hierarchy.push({
            id: `https://example.com/cat${i}/sub${j}`,
            prefLabel: { en: `Sub ${i}-${j}` },
            level: 1,
            parentId: `https://example.com/cat${i}`
          });
        }
      }
      fetchVocabularyMock.mockResolvedValue(hierarchy);

      const onchange = vi.fn();
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'about', multiple: true, onchange }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const searchInput = /** @type {HTMLInputElement} */ (
        container.querySelector('input[type="text"]')
      );
      await fireEvent.input(searchInput, { target: { value: 'Cat 0' } });

      // In search mode, the "Cat 0" parent should select when clicked
      const options = container.querySelectorAll('[role="option"]');
      const parentRow = /** @type {HTMLElement} */ (
        Array.from(options).find((o) => o.textContent?.includes('Cat 0'))
      );
      const labelBtn = /** @type {HTMLButtonElement} */ (
        parentRow.querySelector('button:not([aria-label="Expand"]):not([aria-label="Collapse"])')
      );
      await fireEvent.click(labelBtn);

      expect(onchange).toHaveBeenCalledTimes(1);
    });
  });

  describe('Aligned checkbox column (reserved disclosure lane)', () => {
    /** Mix of a top-level leaf and a top-level parent with children. */
    const mixedConcepts = [
      { id: 'https://example.com/leaf-top', prefLabel: { en: 'TopLeaf' }, level: 0 },
      { id: 'https://example.com/parent', prefLabel: { en: 'Parent' }, level: 0 },
      {
        id: 'https://example.com/parent/c1',
        prefLabel: { en: 'Child1' },
        level: 1,
        parentId: 'https://example.com/parent'
      },
      {
        id: 'https://example.com/parent/c2',
        prefLabel: { en: 'Child2' },
        level: 1,
        parentId: 'https://example.com/parent'
      }
    ];

    /**
     * Open the dropdown and return the option row whose text contains `label`.
     * @param {HTMLElement} container
     * @param {string} label
     */
    function rowWithText(container, label) {
      return /** @type {HTMLElement} */ (
        Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
          o.textContent?.includes(label)
        )
      );
    }

    it('reserves a disclosure lane on top-level leaf rows so checkboxes align with parents', async () => {
      fetchVocabularyMock.mockResolvedValue(mixedConcepts);

      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'about', multiple: true }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // Both a parent and a top-level leaf must reserve a disclosure lane,
      // otherwise the leaf's checkbox sits flush-left and the column is ragged.
      const parentRow = rowWithText(container, 'Parent');
      const leafRow = rowWithText(container, 'TopLeaf');
      expect(parentRow.querySelector('[data-disclosure-lane]')).toBeTruthy();
      expect(leafRow.querySelector('[data-disclosure-lane]')).toBeTruthy();
    });
  });

  describe('Tri-state parent checkbox + rollup count', () => {
    const partialFixture = [
      { id: 'https://example.com/parent', prefLabel: { en: 'Parent' }, level: 0 },
      {
        id: 'https://example.com/parent/c1',
        prefLabel: { en: 'Child1' },
        level: 1,
        parentId: 'https://example.com/parent'
      },
      {
        id: 'https://example.com/parent/c2',
        prefLabel: { en: 'Child2' },
        level: 1,
        parentId: 'https://example.com/parent'
      }
    ];

    /**
     * @param {HTMLElement} container
     * @param {string} label
     */
    function rowWithText(container, label) {
      return /** @type {HTMLElement} */ (
        Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
          o.textContent?.includes(label)
        )
      );
    }

    it('shows an indeterminate checkbox on a parent with some (not all) children selected', async () => {
      fetchVocabularyMock.mockResolvedValue(partialFixture);

      const { container } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'about',
          multiple: true,
          selected: [{ id: 'https://example.com/parent/c1', label: 'Child1' }]
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const parentRow = rowWithText(container, 'Parent');
      const parentCheckbox = /** @type {HTMLInputElement} */ (
        parentRow.querySelector('input[type="checkbox"]')
      );
      expect(parentCheckbox.indeterminate).toBe(true);
      expect(parentCheckbox.checked).toBe(false);
    });

    it('shows a checked (not indeterminate) parent checkbox when the parent itself is selected', async () => {
      fetchVocabularyMock.mockResolvedValue(partialFixture);

      const { container } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'about',
          multiple: true,
          selected: [{ id: 'https://example.com/parent', label: 'Parent' }]
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const parentRow = rowWithText(container, 'Parent');
      const parentCheckbox = /** @type {HTMLInputElement} */ (
        parentRow.querySelector('input[type="checkbox"]')
      );
      expect(parentCheckbox.checked).toBe(true);
      expect(parentCheckbox.indeterminate).toBe(false);
    });

    it('renders the child count as a selected/total ratio when some children are selected', async () => {
      fetchVocabularyMock.mockResolvedValue(partialFixture);

      const { container } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'about',
          multiple: true,
          selected: [{ id: 'https://example.com/parent/c1', label: 'Child1' }]
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const parentRow = rowWithText(container, 'Parent');
      const badge = /** @type {HTMLElement} */ (parentRow.querySelector('[data-rollup-count]'));
      expect(badge).toBeTruthy();
      expect(badge.textContent?.replace(/\s/g, '')).toBe('1/2');
    });

    it('renders the child count as the plain total when no children are selected', async () => {
      fetchVocabularyMock.mockResolvedValue(partialFixture);

      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'about', multiple: true }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const parentRow = rowWithText(container, 'Parent');
      const badge = /** @type {HTMLElement} */ (parentRow.querySelector('[data-rollup-count]'));
      expect(badge).toBeTruthy();
      expect(badge.textContent?.replace(/\s/g, '')).toBe('2');
    });
  });

  describe('Keyboard navigation', () => {
    it('opens dropdown on Enter key', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      const wrapper = /** @type {HTMLElement} */ (container.querySelector('.dropdown'));
      await fireEvent.keyDown(wrapper, { key: 'Enter' });

      const listbox = container.querySelector('[role="listbox"]');
      expect(listbox).toBeTruthy();
    });

    it('closes dropdown on Escape key', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      // Open
      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );
      expect(container.querySelector('[role="listbox"]')).toBeTruthy();

      // Escape
      const wrapper = /** @type {HTMLElement} */ (container.querySelector('.dropdown'));
      await fireEvent.keyDown(wrapper, { key: 'Escape' });

      expect(container.querySelector('[role="listbox"]')).toBeFalsy();
    });

    it('moves active index with ArrowDown', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      // Open
      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const wrapper = /** @type {HTMLElement} */ (container.querySelector('.dropdown'));

      // ArrowDown twice (from -1 to 0, then to 1)
      await fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
      await fireEvent.keyDown(wrapper, { key: 'ArrowDown' });

      // Second option should have the active outline class
      const options = container.querySelectorAll('[data-option-index]');
      expect(options[1].className).toContain('outline-primary');
    });

    it('selects item with Enter on active index', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      // Open
      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const wrapper = /** @type {HTMLElement} */ (container.querySelector('.dropdown'));

      // ArrowDown to first option
      await fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
      // Select it
      await fireEvent.keyDown(wrapper, { key: 'Enter' });

      // First option should now be selected (aria-selected="true")
      const options = container.querySelectorAll('[role="option"]');
      expect(options[0].getAttribute('aria-selected')).toBe('true');
    });

    it('jumps to first option with Home key', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const wrapper = /** @type {HTMLElement} */ (container.querySelector('.dropdown'));

      // Navigate to last with End, then back to first with Home
      await fireEvent.keyDown(wrapper, { key: 'End' });
      const options = container.querySelectorAll('[data-option-index]');
      expect(options[options.length - 1].className).toContain('outline-primary');

      await fireEvent.keyDown(wrapper, { key: 'Home' });
      expect(options[0].className).toContain('outline-primary');
    });
  });

  describe('Search and highlighting', () => {
    it('shows search input when dropdown is open', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const searchInput = /** @type {HTMLElement} */ (
        container.querySelector('input[type="text"]')
      );
      expect(searchInput).toBeTruthy();
      expect(searchInput.getAttribute('aria-label')).toBe('Search...');
    });

    it('filters options when search term is entered', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // Type search term
      const searchInput = /** @type {HTMLElement} */ (
        container.querySelector('input[type="text"]')
      );
      await fireEvent.input(searchInput, { target: { value: 'vid' } });

      await waitFor(() => {
        const options = container.querySelectorAll('[role="option"]');
        expect(options.length).toBe(1);
        expect(options[0].textContent).toContain('Video');
      });
    });

    it('shows "No results found" when search has no matches', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const searchInput = /** @type {HTMLElement} */ (
        container.querySelector('input[type="text"]')
      );
      await fireEvent.input(searchInput, { target: { value: 'zzzzz' } });

      await waitFor(() => {
        expect(container.textContent).toContain('No results found');
      });
    });

    it('renders mark elements for search highlighting', async () => {
      const { container } = render(SKOSDropdown, {
        props: { vocabularyKey: 'learningResourceType' }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const searchInput = /** @type {HTMLElement} */ (
        container.querySelector('input[type="text"]')
      );
      await fireEvent.input(searchInput, { target: { value: 'tex' } });

      await waitFor(() => {
        const marks = container.querySelectorAll('mark');
        expect(marks.length).toBeGreaterThan(0);
        expect(marks[0].textContent).toBe('Tex');
      });
    });
  });

  describe('External concepts prop', () => {
    it('does not call fetchVocabulary when concepts prop is supplied', async () => {
      fetchVocabularyMock.mockClear();
      const externalConcepts = [
        { id: 'https://example.com/a', prefLabel: { en: 'Alpha' }, level: 0 },
        { id: 'https://example.com/b', prefLabel: { en: 'Beta' }, level: 0 }
      ];

      const { container } = render(SKOSDropdown, {
        props: {
          concepts: /** @type {any} */ (externalConcepts),
          isLoading: false
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger).toBeTruthy();
        expect(trigger.textContent).not.toContain('Loading');
      });

      expect(fetchVocabularyMock).not.toHaveBeenCalled();
    });

    it('renders options from externally supplied concepts', async () => {
      const externalConcepts = [
        { id: 'https://example.com/a', prefLabel: { en: 'Alpha' }, level: 0 },
        { id: 'https://example.com/b', prefLabel: { en: 'Beta' }, level: 0 }
      ];

      const { container } = render(SKOSDropdown, {
        props: {
          concepts: /** @type {any} */ (externalConcepts),
          isLoading: false
        }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      const options = container.querySelectorAll('[role="option"]');
      expect(options.length).toBe(2);
      expect(options[0].textContent).toContain('Alpha');
      expect(options[1].textContent).toContain('Beta');
    });

    it('renders options without spinner when concepts prop is supplied without isLoading', async () => {
      const externalConcepts = [
        { id: 'https://example.com/a', prefLabel: { en: 'Alpha' }, level: 0 },
        { id: 'https://example.com/b', prefLabel: { en: 'Beta' }, level: 0 }
      ];

      const { container } = render(SKOSDropdown, {
        props: {
          concepts: /** @type {any} */ (externalConcepts)
          // no isLoading prop — internal default must resolve to false
        }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // Spinner must not appear in trigger or panel
      expect(container.querySelector('.loading-spinner')).toBeFalsy();
      expect(container.querySelector('[data-testid="skos-panel-loading"]')).toBeFalsy();

      const options = container.querySelectorAll('[role="option"]');
      expect(options.length).toBe(2);
    });

    it('shows spinner when external isLoading prop is true', () => {
      const { container } = render(SKOSDropdown, {
        props: {
          concepts: [],
          isLoading: true
        }
      });

      const spinner = container.querySelector('.loading-spinner');
      expect(spinner).toBeTruthy();
    });

    it('opens panel with spinner when trigger is clicked while isLoading=true', async () => {
      const { container } = render(SKOSDropdown, {
        props: {
          concepts: [],
          isLoading: true
        }
      });

      const trigger = /** @type {HTMLElement} */ (
        await waitFor(() => {
          const t = container.querySelector('[role="combobox"]');
          if (!t) throw new Error('combobox not found');
          return t;
        })
      );

      await fireEvent.click(trigger);

      // Panel opens but shows a loading indicator instead of options / search
      const panelLoader = container.querySelector('[data-testid="skos-panel-loading"]');
      expect(panelLoader).toBeTruthy();
      expect(container.querySelector('[role="listbox"]')).toBeFalsy();
      expect(container.querySelector('input[type="text"]')).toBeFalsy();
    });

    it('swaps panel contents from spinner to listbox when isLoading flips false', async () => {
      const { container, rerender } = render(SKOSDropdown, {
        props: {
          concepts: /** @type {any} */ ([]),
          isLoading: true
        }
      });

      const trigger = /** @type {HTMLElement} */ (
        await waitFor(() => {
          const t = container.querySelector('[role="combobox"]');
          if (!t) throw new Error('combobox not found');
          return t;
        })
      );
      await fireEvent.click(trigger);
      expect(container.querySelector('[data-testid="skos-panel-loading"]')).toBeTruthy();

      // Simulate concepts arriving
      await rerender({
        concepts: /** @type {any} */ ([
          { id: 'https://example.com/alpha', prefLabel: { en: 'Alpha' }, level: 0 }
        ]),
        isLoading: false
      });

      await waitFor(() => {
        expect(container.querySelector('[data-testid="skos-panel-loading"]')).toBeFalsy();
        expect(container.querySelector('[role="listbox"]')).toBeTruthy();
      });
    });

    it('generates unique aria-controls when no vocabularyKey is provided', async () => {
      const { container } = render(SKOSDropdown, {
        props: {
          concepts: /** @type {any} */ ([{ id: 'x', prefLabel: { en: 'X' }, level: 0 }]),
          isLoading: false
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger).toBeTruthy();
        const controls = trigger.getAttribute('aria-controls');
        expect(controls).toBeTruthy();
        expect(controls).not.toBe('skos-listbox-undefined');
        expect(controls).toMatch(/^skos-listbox-/);
      });
    });
  });

  describe('Selection', () => {
    it('shows selected item as badge in trigger', async () => {
      const { container } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'learningResourceType',
          selected: [{ id: 'https://example.com/text', label: 'Text' }]
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger).toBeTruthy();
        expect(trigger.textContent).toContain('Text');
      });

      const badge = /** @type {HTMLElement} */ (container.querySelector('.badge-primary'));
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain('Text');
    });

    it('shows selection count footer when items selected', async () => {
      const { container } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'learningResourceType',
          selected: [{ id: 'https://example.com/text', label: 'Text' }]
        }
      });

      await waitFor(() => {
        expect(container.querySelector('[role="combobox"]')).toBeTruthy();
        expect(
          /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]')).textContent
        ).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      expect(container.textContent).toContain('1 selected');
    });
  });

  describe('Auto-expand on selection (AI suggestion visibility)', () => {
    /** Build a >30-concept hierarchical fixture. */
    function buildHierarchy() {
      /** @type {any[]} */
      const out = [];
      for (let i = 0; i < 10; i++) {
        out.push({
          id: `https://example.com/cat${i}`,
          prefLabel: { en: `Cat ${i}` },
          level: 0
        });
        for (let j = 0; j < 3; j++) {
          out.push({
            id: `https://example.com/cat${i}/sub${j}`,
            prefLabel: { en: `Sub ${i}-${j}` },
            level: 1,
            parentId: `https://example.com/cat${i}`
          });
        }
      }
      return out;
    }

    it('auto-expands parents containing a pre-selected concept', async () => {
      fetchVocabularyMock.mockResolvedValue(buildHierarchy());

      const { container } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'about',
          multiple: true,
          selected: [{ id: 'https://example.com/cat3/sub1', label: 'Sub 3-1' }]
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // The selected child must be visible in the panel and marked
      const selectedRow = /** @type {HTMLElement | null} */ (
        Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
          o.textContent?.includes('Sub 3-1')
        ) ?? null
      );
      expect(selectedRow).toBeTruthy();
      expect(selectedRow?.getAttribute('aria-selected')).toBe('true');

      // Other unrelated parents stay collapsed (only one parent expanded)
      // Total visible = 10 parents + 3 children of cat3 = 13
      expect(container.querySelectorAll('[role="option"]').length).toBe(13);
    });

    it('auto-expands when `selected` changes after mount (post-enrichment)', async () => {
      fetchVocabularyMock.mockResolvedValue(buildHierarchy());

      const { container, rerender } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'about',
          multiple: true,
          selected: /** @type {any} */ ([])
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );
      // All 10 parents collapsed, no children visible
      expect(container.querySelectorAll('[role="option"]').length).toBe(10);

      // Simulate AI enrichment populating selected after mount
      await rerender({
        vocabularyKey: 'about',
        multiple: true,
        selected: /** @type {any} */ ([{ id: 'https://example.com/cat5/sub2', label: 'Sub 5-2' }])
      });

      await waitFor(() => {
        const row = Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
          o.textContent?.includes('Sub 5-2')
        );
        expect(row).toBeTruthy();
        expect(row?.getAttribute('aria-selected')).toBe('true');
      });
    });

    it('auto-expands grandparents too (multi-level hierarchy)', async () => {
      // 3 grandparents, each with 5 parents, each with 3 children = 60 concepts (triggers >30 auto-collapse)
      /** @type {any[]} */
      const hierarchy = [];
      for (let g = 0; g < 3; g++) {
        hierarchy.push({
          id: `https://example.com/g${g}`,
          prefLabel: { en: `Grand ${g}` },
          level: 0
        });
        for (let p = 0; p < 5; p++) {
          hierarchy.push({
            id: `https://example.com/g${g}/p${p}`,
            prefLabel: { en: `Parent ${g}-${p}` },
            level: 1,
            parentId: `https://example.com/g${g}`
          });
          for (let c = 0; c < 3; c++) {
            hierarchy.push({
              id: `https://example.com/g${g}/p${p}/c${c}`,
              prefLabel: { en: `Child ${g}-${p}-${c}` },
              level: 2,
              parentId: `https://example.com/g${g}/p${p}`
            });
          }
        }
      }
      fetchVocabularyMock.mockResolvedValue(hierarchy);

      const { container } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'about',
          multiple: true,
          selected: [{ id: 'https://example.com/g1/p2/c1', label: 'Child 1-2-1' }]
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // Grandparent of the selection should be expanded (its parents visible)
      const parentRow = Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
        o.textContent?.includes('Parent 1-2')
      );
      expect(parentRow).toBeTruthy();

      // The selected grandchild itself should be visible and marked
      const childRow = Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
        o.textContent?.includes('Child 1-2-1')
      );
      expect(childRow).toBeTruthy();
      expect(childRow?.getAttribute('aria-selected')).toBe('true');
    });

    it('does not re-collapse parents the user manually expanded', async () => {
      fetchVocabularyMock.mockResolvedValue(buildHierarchy());

      const { container, rerender } = render(SKOSDropdown, {
        props: {
          vocabularyKey: 'about',
          multiple: true,
          selected: /** @type {any} */ ([])
        }
      });

      await waitFor(() => {
        const trigger = /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'));
        expect(trigger.textContent).not.toContain('Loading');
      });

      await fireEvent.click(
        /** @type {HTMLElement} */ (container.querySelector('[role="combobox"]'))
      );

      // User expands cat7 manually via chevron
      const cat7Row = /** @type {HTMLElement} */ (
        Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
          o.textContent?.includes('Cat 7')
        )
      );
      const cat7Chevron = /** @type {HTMLButtonElement} */ (
        cat7Row.querySelector('button[aria-label="Expand"]')
      );
      await fireEvent.click(cat7Chevron);
      // cat7's children visible
      expect(
        Array.from(container.querySelectorAll('[role="option"]')).some((o) =>
          o.textContent?.includes('Sub 7-0')
        )
      ).toBe(true);

      // Now selection changes (simulate AI enrichment in cat3) — effect re-runs
      await rerender({
        vocabularyKey: 'about',
        multiple: true,
        selected: /** @type {any} */ ([{ id: 'https://example.com/cat3/sub1', label: 'Sub 3-1' }])
      });

      // cat7 must stay expanded (effect must not have re-collapsed it)
      await waitFor(() => {
        expect(
          Array.from(container.querySelectorAll('[role="option"]')).some((o) =>
            o.textContent?.includes('Sub 7-0')
          )
        ).toBe(true);
        // cat3 (selection's parent) is also now expanded
        expect(
          Array.from(container.querySelectorAll('[role="option"]')).some((o) =>
            o.textContent?.includes('Sub 3-1')
          )
        ).toBe(true);
      });
    });
  });
});
