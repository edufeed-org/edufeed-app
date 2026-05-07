/**
 * AiSuggestionReviewDialog — open/closed/empty states
 *
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import AiSuggestionReviewDialog from '../AiSuggestionReviewDialog.svelte';

vi.mock('$lib/paraglide/messages', () => ({
  amb_form_review_dialog_title: () => 'Review AI suggestions',
  amb_form_review_your_entry: () => 'Your entry',
  amb_form_review_ai_suggestion: () => 'AI suggestion',
  amb_form_review_keep_mine: () => 'Keep mine',
  amb_form_review_use_ai: () => 'Use AI',
  amb_form_review_replace: () => 'Replace',
  amb_form_review_merge: () => 'Merge',
  amb_form_review_add: () => 'Add',
  amb_form_review_close: () => 'Close',
  amb_form_review_empty: () => 'No open suggestions.'
}));

afterEach(() => cleanup());

describe('AiSuggestionReviewDialog — open/closed', () => {
  it('renders nothing visible when open is false', () => {
    const { queryByRole } = render(AiSuggestionReviewDialog, {
      props: {
        open: false,
        formData: {},
        aboutByVocab: {},
        aiSuggestions: null,
        dismissedFields: new Set(),
        onapply: () => {},
        onclose: () => {}
      }
    });
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders empty-state copy when open with no conflicts', () => {
    const { getByText } = render(AiSuggestionReviewDialog, {
      props: {
        open: true,
        formData: { name: 'Foo' },
        aboutByVocab: {},
        aiSuggestions: {
          source: 'llm-enriched',
          payload: { name: 'Foo' },
          evidence: {},
          baseline: {}
        },
        dismissedFields: new Set(),
        onapply: () => {},
        onclose: () => {}
      }
    });
    expect(getByText('No open suggestions.')).toBeInTheDocument();
  });
});

describe('AiSuggestionReviewDialog — string conflict row', () => {
  function setup(overrides = {}) {
    const onapply = vi.fn();
    const onclose = vi.fn();
    const utils = render(AiSuggestionReviewDialog, {
      props: {
        open: true,
        formData: { name: 'Mine' },
        aboutByVocab: {},
        aiSuggestions: {
          source: 'llm-enriched',
          payload: { name: 'AI value' },
          evidence: { name: 'evidence quote' },
          baseline: {}
        },
        dismissedFields: new Set(),
        onapply,
        onclose,
        ...overrides
      }
    });
    return { ...utils, onapply, onclose };
  }

  it('renders user value, AI value, and evidence quote', () => {
    const { getByText } = setup();
    expect(getByText('Mine')).toBeInTheDocument();
    expect(getByText('AI value')).toBeInTheDocument();
    expect(getByText(/evidence quote/)).toBeInTheDocument();
  });

  it('renders Keep mine + Use AI buttons for string conflict', () => {
    const { getByRole } = setup();
    expect(getByRole('button', { name: 'Keep mine' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Use AI' })).toBeInTheDocument();
  });

  it('clicking Use AI fires onapply(field, "replace")', async () => {
    const { getByRole, onapply } = setup();
    await fireEvent.click(getByRole('button', { name: 'Use AI' }));
    expect(onapply).toHaveBeenCalledWith('name', 'replace');
  });

  it('clicking Keep mine fires onapply(field, "dismiss")', async () => {
    const { getByRole, onapply } = setup();
    await fireEvent.click(getByRole('button', { name: 'Keep mine' }));
    expect(onapply).toHaveBeenCalledWith('name', 'dismiss');
  });
});

describe('AiSuggestionReviewDialog — array rows', () => {
  it("array 'conflict' shows Keep/Replace/Merge", () => {
    const { getByRole } = render(AiSuggestionReviewDialog, {
      props: {
        open: true,
        formData: { keywords: ['math'] },
        aboutByVocab: {},
        aiSuggestions: {
          source: 'llm-enriched',
          payload: { keywords: ['biology'] },
          evidence: {},
          baseline: {}
        },
        dismissedFields: new Set(),
        onapply: () => {},
        onclose: () => {}
      }
    });
    expect(getByRole('button', { name: 'Keep mine' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Merge' })).toBeInTheDocument();
  });

  it("array 'additive' shows Keep/Add (no Replace)", () => {
    const { getByRole, queryByRole } = render(AiSuggestionReviewDialog, {
      props: {
        open: true,
        formData: { keywords: ['math'] },
        aboutByVocab: {},
        aiSuggestions: {
          source: 'llm-enriched',
          payload: { keywords: ['math', 'algebra'] },
          evidence: {},
          baseline: {}
        },
        dismissedFields: new Set(),
        onapply: () => {},
        onclose: () => {}
      }
    });
    expect(getByRole('button', { name: 'Keep mine' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Replace' })).toBeNull();
  });

  it("Replace fires onapply(field, 'replace'); Merge fires 'merge'; Add fires 'merge'", async () => {
    const onapply = vi.fn();
    const { getByRole } = render(AiSuggestionReviewDialog, {
      props: {
        open: true,
        formData: { keywords: ['math'] },
        aboutByVocab: {},
        aiSuggestions: {
          source: 'llm-enriched',
          payload: { keywords: ['biology'] },
          evidence: {},
          baseline: {}
        },
        dismissedFields: new Set(),
        onapply,
        onclose: () => {}
      }
    });
    await fireEvent.click(getByRole('button', { name: 'Replace' }));
    await fireEvent.click(getByRole('button', { name: 'Merge' }));
    expect(onapply).toHaveBeenNthCalledWith(1, 'keywords', 'replace');
    expect(onapply).toHaveBeenNthCalledWith(2, 'keywords', 'merge');
  });
});
