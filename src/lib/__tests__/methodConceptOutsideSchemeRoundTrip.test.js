/**
 * A resource whose `ext:ekw:method:id` points at a concept that is
 * no longer in the `methode` scheme (the vocabulary publisher renamed some
 * concepts, splitting the old shared scheme into `methode` and
 * `konfi-methode`) must survive an edit/save round trip unchanged — editing
 * a resource must not silently drop or rewrite a stored concept value just
 * because the wizard's picker no longer lists it.
 *
 * Reproduces event a1f552f0's stored value exactly:
 *   ext:ekw:method:id = nostr:39738:d2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612:rollenspiel
 * (a concept that now lives only in the `konfi-methode` scheme, not
 * `methode`).
 *
 * Exercises the REAL production path, same as konfiRoundTrip.test.js:
 *   parseEkwTagsToFormData (edit-mode prefill)
 *     → buildResourceData (wizard submit whitelist)
 *     → convertFormDataToAMB / ambToNostr (save, unchanged)
 *     → parseEkwTagsToFormData again (re-prefill after save)
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { ambToNostr } from 'amb-nostr-converter';
import { buildResourceData } from '$lib/helpers/educational/buildResourceData.js';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import { createInitialFormData } from '$lib/helpers/educational/wizardInitialState.js';
import { parseEkwTagsToFormData } from '$lib/helpers/educational/parseEkwTagsToFormData.js';

const AUTHOR_PK = 'e'.repeat(64);

// The stored value from event a1f552f0 — a concept that is NOT in the
// `methode` scheme the wizard's picker currently offers (only in
// `konfi-methode`, after the vocabulary publisher's rename).
const UNKNOWN_METHOD_ID =
  'nostr:39738:d2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612:rollenspiel';
const UNKNOWN_METHOD_LABEL = 'Rollenspiel';

/** @param {any} resourceData */
function publishTags(resourceData) {
  const amb = convertFormDataToAMB(resourceData);
  const result = ambToNostr(/** @type {any} */ (amb), {
    pubkey: AUTHOR_PK,
    timestamp: 1_700_000_000
  });
  if (!result.success || !result.data) throw new Error('conversion failed');
  return /** @type {string[][]} */ (result.data.tags);
}

describe('method concept outside the picker scheme survives edit/save', () => {
  it('round-trips the exact stored tag value unchanged through load → form state → event build', () => {
    // 1. Load: an existing stored event carries the out-of-scheme concept.
    const storedEvent = {
      tags: [
        ['d', 'a1f552f0-resource'],
        ['ext:ekw:method:id', UNKNOWN_METHOD_ID],
        ['ext:ekw:method:prefLabel:de', UNKNOWN_METHOD_LABEL],
        ['ext:ekw:method:type', 'Concept']
      ]
    };

    // 2. Prefill: edit-mode parses the stored tags into form state exactly
    // as ResourceFormWizard.svelte does around line 861.
    const ekw = parseEkwTagsToFormData(storedEvent);
    expect(ekw.methods).toEqual([UNKNOWN_METHOD_ID]);
    expect(ekw.methodLabels).toEqual([{ id: UNKNOWN_METHOD_ID, label: UNKNOWN_METHOD_LABEL }]);

    const rawFormData = /** @type {any} */ ({
      ...createInitialFormData(),
      name: 'EKW Schule Methode resource',
      description: 'desc',
      inLanguage: 'de',
      license: 'https://creativecommons.org/licenses/by/4.0/',
      bildungsbereich: 'schule',
      methods: ekw.methods,
      methodLabels: ekw.methodLabels
    });

    // 3. Save: user edits unrelated fields and saves — the method field is
    // untouched, so formData.methods/methodLabels still carry the original
    // out-of-scheme value when the wizard builds the event to publish.
    const resourceData = buildResourceData(rawFormData, { about: [], hasNoUrl: true });
    const tags = publishTags(resourceData);

    const methodIdTags = tags.filter((t) => t[0] === 'ext:ekw:method:id');
    expect(methodIdTags).toEqual([['ext:ekw:method:id', UNKNOWN_METHOD_ID]]);

    // 4. Re-prefill after save: the rebuilt event still parses back to the
    // identical form-state fragment — no loss, no silent id rewrite.
    const roundTripped = parseEkwTagsToFormData({ tags });
    expect(roundTripped.methods).toEqual([UNKNOWN_METHOD_ID]);
    expect(roundTripped.methodLabels).toEqual([
      { id: UNKNOWN_METHOD_ID, label: UNKNOWN_METHOD_LABEL }
    ]);
  });
});
