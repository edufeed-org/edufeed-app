/**
 * Module-scoped poll draft. Persists across modal close/reopen within a page
 * session — closing the dialog (Cancel, backdrop, ESC) preserves the user's
 * input. Cleared by the modal's "Start over" button or after a successful
 * publish.
 *
 * Lives in a plain module (not <script module>) so tests can `vi.resetModules`
 * or call `resetPollDraft()` between renders to avoid state leaking between
 * test cases.
 */
import { generateOptionId } from '$lib/helpers/polls.js';

/**
 * @typedef {Object} PollDraft
 * @property {string} question
 * @property {{ id: string; label: string }[]} options
 * @property {'singlechoice' | 'multiplechoice'} pollType
 * @property {'24h' | '7d' | '30d' | 'none' | 'custom'} endsAtPreset
 * @property {string} customEndsAt
 * @property {string} community
 */

/** @returns {PollDraft} */
export function freshPollDraft() {
  return {
    question: '',
    options: [
      { id: generateOptionId(), label: '' },
      { id: generateOptionId(), label: '' }
    ],
    pollType: 'singlechoice',
    endsAtPreset: '7d',
    customEndsAt: '',
    community: ''
  };
}

/** @type {{ value: PollDraft }} */
export const pollDraftHolder = { value: freshPollDraft() };

export function resetPollDraft() {
  pollDraftHolder.value = freshPollDraft();
}
