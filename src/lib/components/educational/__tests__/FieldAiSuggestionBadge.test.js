/**
 * FieldAiSuggestionBadge — inline per-field AI suggestion review badge
 *
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import FieldAiSuggestionBadge from '../FieldAiSuggestionBadge.svelte';

vi.mock('$lib/paraglide/messages', () => ({
  amb_form_review_ai_suggestion: () => 'AI suggestion',
  amb_form_review_keep_mine: () => 'Keep mine',
  amb_form_review_use_ai: () => 'Use AI',
  amb_form_review_replace: () => 'Replace',
  amb_form_review_merge: () => 'Merge',
  amb_form_review_add: () => 'Add'
}));

afterEach(() => cleanup());

function baseProps(overrides = {}) {
  return {
    field: 'name',
    formData: {},
    aboutByVocab: {},
    aiSuggestions: null,
    dismissedFields: new Set(),
    onapply: () => {},
    ...overrides
  };
}

describe('FieldAiSuggestionBadge — non-rendering states', () => {
  it("renders nothing when state is 'match'", () => {
    render(
      FieldAiSuggestionBadge,
      baseProps({
        field: 'name',
        formData: { name: 'Same' },
        aiSuggestions: { payload: { name: 'Same' }, evidence: {} }
      })
    );
    expect(screen.queryByTestId('field-ai-badge-name')).toBeNull();
  });

  it("renders nothing when state is 'none'", () => {
    render(
      FieldAiSuggestionBadge,
      baseProps({
        field: 'name',
        formData: { name: 'Mine' },
        aiSuggestions: { payload: {}, evidence: {} }
      })
    );
    expect(screen.queryByTestId('field-ai-badge-name')).toBeNull();
  });

  it('renders nothing when field is in dismissedFields', () => {
    render(
      FieldAiSuggestionBadge,
      baseProps({
        field: 'name',
        formData: { name: 'Mine' },
        aiSuggestions: { payload: { name: 'AI value' }, evidence: {} },
        dismissedFields: new Set(['name'])
      })
    );
    expect(screen.queryByTestId('field-ai-badge-name')).toBeNull();
  });
});

describe('FieldAiSuggestionBadge — string field conflict', () => {
  function setup(overrides = {}) {
    const onapply = vi.fn();
    const utils = render(
      FieldAiSuggestionBadge,
      baseProps({
        field: 'name',
        formData: { name: 'Mine' },
        aiSuggestions: { payload: { name: 'AI value' }, evidence: {} },
        onapply,
        ...overrides
      })
    );
    return { ...utils, onapply };
  }

  it('renders use-ai + keep-mine buttons (exactly two)', () => {
    setup();
    const wrapper = screen.getByTestId('field-ai-badge-name');
    const buttons = wrapper.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(screen.getByRole('button', { name: 'Use AI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeInTheDocument();
  });

  it("clicking use-ai fires onapply(field, 'replace')", async () => {
    const { onapply } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Use AI' }));
    expect(onapply).toHaveBeenCalledWith('name', 'replace');
  });

  it("clicking keep-mine fires onapply(field, 'dismiss')", async () => {
    const { onapply } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(onapply).toHaveBeenCalledWith('name', 'dismiss');
  });
});

describe('FieldAiSuggestionBadge — additive array field', () => {
  function setup(overrides = {}) {
    const onapply = vi.fn();
    const utils = render(
      FieldAiSuggestionBadge,
      baseProps({
        field: 'keywords',
        formData: { keywords: ['math'] },
        aiSuggestions: { payload: { keywords: ['math', 'algebra'] }, evidence: {} },
        onapply,
        ...overrides
      })
    );
    return { ...utils, onapply };
  }

  it('renders add + keep-mine buttons (exactly two, no replace)', () => {
    setup();
    const wrapper = screen.getByTestId('field-ai-badge-keywords');
    expect(wrapper.getAttribute('data-state')).toBe('additive');
    const buttons = wrapper.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
  });

  it("clicking add fires onapply(field, 'merge')", async () => {
    const { onapply } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onapply).toHaveBeenCalledWith('keywords', 'merge');
  });
});

describe('FieldAiSuggestionBadge — conflict array field', () => {
  function setup(overrides = {}) {
    const onapply = vi.fn();
    const utils = render(
      FieldAiSuggestionBadge,
      baseProps({
        field: 'learningResourceType',
        formData: {
          learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/text', label: 'Text' }]
        },
        aiSuggestions: {
          payload: {
            learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/video', prefLabel: 'Video' }]
          },
          evidence: {}
        },
        onapply,
        ...overrides
      })
    );
    return { ...utils, onapply };
  }

  it('renders replace + merge + keep-mine buttons (exactly three)', () => {
    setup();
    const wrapper = screen.getByTestId('field-ai-badge-learningResourceType');
    expect(wrapper.getAttribute('data-state')).toBe('conflict');
    const buttons = wrapper.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeInTheDocument();
  });

  it("clicking merge fires onapply(field, 'merge')", async () => {
    const { onapply } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(onapply).toHaveBeenCalledWith('learningResourceType', 'merge');
  });
});

describe('FieldAiSuggestionBadge — evidence', () => {
  it('renders evidence in italic when present', () => {
    render(
      FieldAiSuggestionBadge,
      baseProps({
        field: 'name',
        formData: { name: 'Mine' },
        aiSuggestions: {
          payload: { name: 'AI value' },
          evidence: { name: 'some quote' }
        }
      })
    );
    expect(screen.getByText(/some quote/)).toBeInTheDocument();
  });

  it('renders long AI values in full (no truncate class clipping)', () => {
    const longValue =
      'A'.repeat(50) + ' ' + 'B'.repeat(50) + ' ' + 'C'.repeat(50) + ' ' + 'D'.repeat(50);
    render(
      FieldAiSuggestionBadge,
      baseProps({
        field: 'description',
        formData: { description: 'Mine' },
        aiSuggestions: { payload: { description: longValue }, evidence: {} }
      })
    );
    const wrapper = screen.getByTestId('field-ai-badge-description');
    expect(wrapper.textContent).toContain(longValue);
    expect(wrapper.querySelector('.truncate')).toBeNull();
  });
});

describe('FieldAiSuggestionBadge — paired-key labels', () => {
  it('renders human label, not raw ID, for paired-key field', () => {
    render(
      FieldAiSuggestionBadge,
      baseProps({
        field: 'gradeLevels',
        formData: {
          gradeLevels: ['nostr:39738:abc:7'],
          gradeLevelLabels: [{ id: 'nostr:39738:abc:7', label: 'Jahrgang 7' }]
        },
        aiSuggestions: {
          payload: {
            gradeLevels: [{ id: 'nostr:39738:abc:8', prefLabel: 'Jahrgang 8' }]
          },
          evidence: {}
        }
      })
    );
    const wrapper = screen.getByTestId('field-ai-badge-gradeLevels');
    expect(wrapper.textContent).toContain('Jahrgang 8');
    expect(wrapper.textContent).not.toContain('nostr:39738:abc:8');
  });
});
