/**
 * TestOER — independent verification of 8c6883d6 (#77).
 *
 * The checkbox defect was a SERIALISATION defect: the builder collected a
 * property the encoder then dropped, silently, for one type out of thirteen.
 * That class is reachable without a browser — builder state -> tags -> the
 * parser a respondent actually uses — so this sweeps every type the builder
 * offers (FormBuilder.svelte FIELD_TYPES) against every property the builder
 * lets an author set on it.
 *
 * Deliberately asserts on the PARSED output, not on builderItemFromState's
 * intermediate mapping: asserting the intermediate is exactly what let the
 * second of two serial gates hide behind the first.
 */
import { describe, it, expect } from 'vitest';
import { builderStateToTags } from '$lib/helpers/forms/builder-state.js';
import { parseFormTemplate } from '$lib/helpers/forms/format.js';

/**
 * The types the BUILDER offers an options editor for — stated here, not
 * imported from format.js. Importing CHOICE_TYPES made the choice-type rows
 * parameterise themselves off the constant that decides the behaviour: a
 * mutation dropping 'radio' from CHOICE_TYPES simply deleted the radio row and
 * the suite stayed green. Measured, not reasoned — it was a live mutation row.
 */
const CHOICE_TYPES = ['select', 'checkbox', 'radio'];

/** Verbatim from FormBuilder.svelte:28-42. */
const FIELD_TYPES = [
  'text',
  'textarea',
  'text-array',
  'number',
  'email',
  'url',
  'select',
  'checkbox',
  'radio',
  'date',
  'creator',
  'amb-relation',
  'external-urls'
];

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
  const tags = builderStateToTags(states, { dTag: 'sweep', name: 'Sweep' });
  return parseFormTemplate(
    /** @type {any} */ ({ kind: 30168, pubkey: '', tags, content: '', created_at: 0 })
  );
}

/**
 * The parsed field for one type, as a respondent's parser hands it back.
 * `any` deliberately: every assertion below reaches into `options`, which the
 * FormField typedef declares as an open bag.
 * @param {string} type
 * @param {Partial<any>} [over]
 * @returns {any}
 */
function only(type, over) {
  const parsed = roundTrip([fieldState(type, over)]);
  return parsed.fields.find((f) => f.id === `f-${type}`);
}

describe('every builder field type survives builder -> tags -> parse', () => {
  it('all 13 types are emitted and parse back as the same type', () => {
    const parsed = roundTrip(FIELD_TYPES.map((t) => fieldState(t)));
    expect(parsed.fields.map((f) => f.id)).toEqual(FIELD_TYPES.map((t) => `f-${t}`));
    expect(parsed.fields.map((f) => f.type)).toEqual(FIELD_TYPES);
  });

  it.each(FIELD_TYPES)('%s keeps its label', (type) => {
    expect(only(type)?.label).toBe(`Label ${type}`);
  });

  it.each(FIELD_TYPES)('%s keeps required', (type) => {
    expect(only(type, { required: true })?.options?.required).toBe(true);
  });

  it.each(FIELD_TYPES)('%s keeps its defaultValue', (type) => {
    expect(only(type, { defaultValue: 'seeded' })?.defaultValue).toBe('seeded');
  });

  it.each(FIELD_TYPES)('%s keeps its placeholder', (type) => {
    expect(only(type, { placeholder: 'hint here' })?.options?.placeholder).toBe('hint here');
  });

  it.each(FIELD_TYPES)('%s keeps min/max', (type) => {
    const f = only(type, { min: 2, max: 9 });
    expect([f?.options?.min, f?.options?.max]).toEqual([2, 9]);
  });

  it.each(FIELD_TYPES)('%s keeps its output mapping', (type) => {
    expect(only(type, { output: 'ext' })?.output).toBe('ext');
  });
});

describe('choice types keep the choices the builder collected', () => {
  const OPTS = [
    { id: 'o1', label: 'test' },
    { id: 'o2', label: 'test2' },
    { id: 'o3', label: 'test3' }
  ];

  // The reported bug, generalised: the builder shows an options editor for
  // exactly these types, so exactly these types must carry options to the wire.
  it.each(CHOICE_TYPES)('%s carries its options through to the parser', (type) => {
    expect(only(type, { selectOptions: OPTS })?.options?.options).toEqual(OPTS);
  });

  it.each(CHOICE_TYPES)('%s keeps per-option nextSection routing', (type) => {
    const routed = [{ id: 'o1', label: 'test', nextSection: 'sec-c' }];
    expect(only(type, { selectOptions: routed })?.options?.options?.[0]?.nextSection).toBe('sec-c');
  });

  it('an optionless checkbox stays a boolean toggle — no options key', () => {
    const f = only('checkbox');
    expect(f?.options?.options).toBeUndefined();
  });

  // Non-choice types have no options editor in the builder, so nothing should
  // reach the wire even if state carries a stale array from a type change.
  it.each(FIELD_TYPES.filter((t) => !CHOICE_TYPES.includes(t)))(
    '%s emits no options even with stale selectOptions',
    (type) => {
      expect(only(type, { selectOptions: OPTS })?.options?.options).toBeUndefined();
    }
  );
});
