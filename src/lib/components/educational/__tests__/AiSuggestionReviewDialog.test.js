/**
 * AiSuggestionReviewDialog — open/closed/empty states
 *
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
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
