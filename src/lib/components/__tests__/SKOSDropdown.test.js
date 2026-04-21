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

    it('clicking a parent row label toggles expand/collapse without selecting', async () => {
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

      // Find the first parent row's inner selection button (the label area)
      const parentRow = /** @type {HTMLElement} */ (optionsBefore[0]);
      const labelButton = /** @type {HTMLButtonElement} */ (
        parentRow.querySelector('button:not([aria-label="Expand"]):not([aria-label="Collapse"])')
      );
      expect(labelButton).toBeTruthy();

      await fireEvent.click(labelButton);

      // Children should now be visible (expanded)
      const optionsAfter = container.querySelectorAll('[role="option"]');
      expect(optionsAfter.length).toBeGreaterThan(10);

      // Selection must NOT have been triggered
      expect(onchange).not.toHaveBeenCalled();

      // Clicking again collapses back
      const parentRowAgain = /** @type {HTMLElement} */ (
        container.querySelectorAll('[role="option"]')[0]
      );
      const labelButton2 = /** @type {HTMLButtonElement} */ (
        parentRowAgain.querySelector(
          'button:not([aria-label="Expand"]):not([aria-label="Collapse"])'
        )
      );
      await fireEvent.click(labelButton2);
      expect(container.querySelectorAll('[role="option"]').length).toBe(10);
      expect(onchange).not.toHaveBeenCalled();
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

      // Expand the parent by clicking its label (auto-collapsed initially)
      const parentRow = /** @type {HTMLElement} */ (
        container.querySelectorAll('[role="option"]')[0]
      );
      const parentLabelBtn = /** @type {HTMLButtonElement} */ (
        parentRow.querySelector('button:not([aria-label="Expand"]):not([aria-label="Collapse"])')
      );
      await fireEvent.click(parentLabelBtn);

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
});
