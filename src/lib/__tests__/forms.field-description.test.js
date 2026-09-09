/**
 * Per-field description texts (follow-up from #77 / the Fragebogen review).
 *
 * The field tag's 6th element is an open JSON settings bag and
 * parseFormTemplate already spreads unknown keys into `field.options`, so the
 * WIRE has always been able to carry a description. What did not exist was a
 * producer (builder state -> options bag) and a consumer (renderer). These
 * tests pin the full authoring cycle, both directions:
 *
 *   publish:  FieldState -> builderStateToTags -> parseFormTemplate
 *   edit:     parsed FormField -> fieldToState -> ... -> parse again
 *
 * The edit direction is asserted deliberately: a value that survives publish
 * but not re-edit is silently erased the first time an author opens their own
 * form — the same one-direction defect class as the checkbox options bug.
 */
import { describe, it, expect } from 'vitest';
import { builderStateToTags, fieldToState } from '$lib/helpers/forms/builder-state.js';
import { parseFormTemplate } from '$lib/helpers/forms/format.js';

/**
 * A FieldState as FormBuilder.addField() creates it, plus author edits.
 * @param {string} type
 * @param {Partial<any>} [over]
 */
function fieldState(type, over = {}) {
  return {
    id: `f-${type}`,
    type,
    label: `Label ${type}`,
    defaultValue: '',
    required: false,
    placeholder: '',
    min: undefined,
    max: undefined,
    selectOptions: [],
    multiple: false,
    vocab: undefined,
    output: '',
    ...over
  };
}

/** @param {any[]} states */
function roundTrip(states) {
  const tags = builderStateToTags(states, { dTag: 'desc', name: 'Desc' });
  return parseFormTemplate(
    /** @type {any} */ ({ kind: 30168, pubkey: '', tags, content: '', created_at: 0 })
  );
}

const ERLAEUTERUNG = 'Gab es Aussagen, Reaktionen oder Situationen, die Sie überrascht haben?';

describe('per-field description: publish direction', () => {
  it('a text field carries its description to the parsed form', () => {
    const parsed = roundTrip([fieldState('textarea', { description: ERLAEUTERUNG })]);
    expect(/** @type {any} */ (parsed.fields[0]).options.description).toBe(ERLAEUTERUNG);
  });

  it('a checkbox with options carries description AND its choices', () => {
    const parsed = roundTrip([
      fieldState('checkbox', {
        description: ERLAEUTERUNG,
        selectOptions: [
          { id: 'o1', label: 'test' },
          { id: 'o2', label: 'test2' }
        ]
      })
    ]);
    const f = /** @type {any} */ (parsed.fields[0]);
    expect(f.options.description).toBe(ERLAEUTERUNG);
    expect((f.options.options || []).map((/** @type {any} */ o) => o.label)).toEqual([
      'test',
      'test2'
    ]);
  });

  it('control: a field without description parses back without one', () => {
    const parsed = roundTrip([fieldState('text')]);
    expect(/** @type {any} */ (parsed.fields[0]).options.description).toBeUndefined();
  });

  it('control: tags without a description are byte-identical to before the feature', () => {
    // The absent case must serialise exactly as it always has, so already
    // published forms do not move. Compare against the literal shape.
    const tags = builderStateToTags([fieldState('text')], { dTag: 'desc', name: 'Desc' });
    const fieldTag = tags.find((t) => t[0] === 'field');
    expect(fieldTag?.[5]).toBe('{"renderElement":"text"}');
  });
});

describe('per-field description: edit direction', () => {
  it('fieldToState carries a parsed description back into builder state', () => {
    const parsed = roundTrip([fieldState('textarea', { description: ERLAEUTERUNG })]);
    const state = fieldToState(parsed.fields[0]);
    expect(state.description).toBe(ERLAEUTERUNG);
  });

  it('a full edit cycle is idempotent: parse -> state -> tags equals the original tags', () => {
    // Explicit `output` on every field: parseFormTemplate defaults a missing
    // output to `amb:<field-id>`, so an output-LESS form re-encodes with that
    // default materialised as a field-output tag — a pre-existing edit-cycle
    // asymmetry this feature neither causes nor fixes. With outputs pinned,
    // description is the only value the cycle could lose.
    const original = builderStateToTags(
      [
        fieldState('textarea', {
          description: ERLAEUTERUNG,
          required: true,
          output: 'amb:description'
        }),
        fieldState('checkbox', {
          description: 'Bitte alles Zutreffende ankreuzen.',
          selectOptions: [{ id: 'o1', label: 'test' }],
          output: 'amb:keywords'
        })
      ],
      { dTag: 'desc', name: 'Desc' }
    );
    const parsed = parseFormTemplate(
      /** @type {any} */ ({ kind: 30168, pubkey: '', tags: original, content: '', created_at: 0 })
    );
    const reencoded = builderStateToTags(parsed.fields.map(fieldToState), {
      dTag: 'desc',
      name: 'Desc'
    });
    expect(reencoded).toEqual(original);
  });
});
