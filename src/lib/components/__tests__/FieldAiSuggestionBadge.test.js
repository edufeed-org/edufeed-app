/**
 * FieldAiSuggestionBadge — inline AI review badge.
 *
 * Issue "Schlagwörter zusammenführen klappt nicht": after Smart fill the user
 * keeps the AI keywords and adds one of their own. The AI list is then a
 * strict subset of the user's — nothing left to merge — so the badge must
 * disappear instead of offering a no-op "Zusammenführen".
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import FieldAiSuggestionBadge from '../educational/FieldAiSuggestionBadge.svelte';

vi.mock('$lib/paraglide/messages', () => ({
  amb_form_review_ai_suggestion: () => 'KI-Vorschlag',
  amb_form_review_use_ai: () => 'KI übernehmen',
  amb_form_review_keep_mine: () => 'Meine behalten',
  amb_form_review_add: () => 'Hinzufügen',
  amb_form_review_replace: () => 'Ersetzen',
  amb_form_review_merge: () => 'Zusammenführen'
}));
vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));

const AI_KEYWORDS = ['Augmented Reality', 'AR', 'religiöse Bildung'];
/** @param {Record<string, any>} payload */
const ai = (payload) => ({ source: 'llm-enriched', payload, evidence: {}, baseline: {} });

/** @param {string[]} keywords */
function renderBadge(keywords) {
  return render(FieldAiSuggestionBadge, {
    props: {
      field: 'keywords',
      formData: { keywords },
      aboutByVocab: {},
      aiSuggestions: ai({ keywords: AI_KEYWORDS }),
      dismissedFields: new Set(),
      onapply: vi.fn()
    }
  });
}

describe('FieldAiSuggestionBadge — keywords', () => {
  it('offers Ersetzen / Zusammenführen on a genuine conflict', () => {
    const { getByTestId, getByText } = renderBadge(['VR', 'AR']);
    expect(getByTestId('field-ai-badge-keywords').dataset.state).toBe('conflict');
    expect(getByText('Zusammenführen')).toBeTruthy();
  });

  it('renders nothing once the user has every AI keyword plus their own', () => {
    const { queryByTestId } = renderBadge([...AI_KEYWORDS, 'VR']);
    expect(queryByTestId('field-ai-badge-keywords')).toBeNull();
  });

  it('renders nothing when the sets are equal', () => {
    const { queryByTestId } = renderBadge([...AI_KEYWORDS]);
    expect(queryByTestId('field-ai-badge-keywords')).toBeNull();
  });
});
