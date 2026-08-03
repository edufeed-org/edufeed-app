/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { builderStateToTags, builderItemFromState } from '$lib/helpers/forms/builder-state.js';
import { parseFormTemplate } from '$lib/helpers/forms/format.js';
import {
  orderedSections,
  resolveNextSectionId,
  visibleFields
} from '$lib/helpers/forms/branching.js';

/**
 * Minimal builder FieldState, mirroring what FormBuilder holds per row.
 * @param {Partial<any>} over
 */
const state = (over = {}) => ({
  id: 'f1',
  type: 'text',
  label: 'Field 1',
  defaultValue: '',
  required: false,
  placeholder: '',
  min: undefined,
  max: undefined,
  selectOptions: [],
  multiple: false,
  ...over
});

/** @param {string} id @param {string} title */
const sectionState = (id, title) => ({ id, type: 'section', title });

/**
 * builderItemFromState returns `FormField | SectionMarker`; these tests assert
 * on the field arm's members, which the union doesn't narrow to.
 * @param {any} f
 */
const item = (f) => /** @type {any} */ (builderItemFromState(f));

/**
 * parseFormTemplate reads only `.tags`, but its param type wants a whole event.
 * @param {string[][]} tags
 */
const parse = (tags) =>
  parseFormTemplate({ kind: 30168, pubkey: 'pk', tags, content: '', created_at: 0 });

describe('builderItemFromState', () => {
  it('maps a section row to a section marker', () => {
    expect(builderItemFromState({ id: 's1', type: 'section', title: 'Basics' })).toEqual({
      id: 's1',
      type: 'section',
      title: 'Basics'
    });
  });

  it('lifts builder flags into the wire `options` bag', () => {
    const mapped = item(
      state({ required: true, placeholder: 'hi', min: 1, max: 9, multiple: true })
    );
    expect(mapped.options).toEqual({
      required: true,
      placeholder: 'hi',
      min: 1,
      max: 9,
      multiple: true
    });
  });

  it('omits falsy/absent flags rather than emitting them', () => {
    expect(item(state()).options).toEqual({});
  });

  it('carries choices for every type the builder offers an options editor for', () => {
    const opts = [{ id: 'red', label: 'Red' }];
    // Must stay in step with FormBuilderFieldRow's CHOICE_TYPES. Checkbox was
    // missing here while the builder happily collected options for it, so an
    // author's choices were dropped silently at publish.
    for (const type of ['select', 'radio', 'checkbox']) {
      expect(item(state({ type, selectOptions: opts })).options.options).toEqual(opts);
    }
    // same options array on a text field must NOT reach the wire
    expect(item(state({ type: 'text', selectOptions: opts })).options.options).toBeUndefined();
  });

  it('round-trips choices through the TAGS, for every choice type', () => {
    // The assertion above stops at builderItemFromState — an intermediate. A
    // second, independent gate in buildFormTemplateTags also listed only
    // select/radio, so checkbox options died at the tag layer with that test
    // still green. This asserts where the requirement is actually stated: what
    // a respondent's parser gets back.
    const opts = [
      { id: 'test', label: 'test' },
      { id: 'test2', label: 'test2' }
    ];
    for (const type of ['select', 'radio', 'checkbox']) {
      const tags = builderStateToTags([state({ type, label: 'Choice', selectOptions: opts })], {
        dTag: 'd1'
      });
      const field = parse(tags).fields[0];
      expect(field.type, `${type} survives the round trip`).toBe(type);
      expect(field.options?.options, `${type} keeps its choices`).toEqual(opts);
    }
  });

  it('keeps an optionless checkbox a boolean toggle on the wire', () => {
    // The boolean consent-checkbox case: no choices, so it must NOT be marked
    // as an option field. Existing published forms depend on this shape.
    const tags = builderStateToTags([state({ type: 'checkbox', label: 'Terms' })], { dTag: 'd1' });
    const fieldTag = tags.find((t) => t[0] === 'field');
    expect(fieldTag?.[2]).toBe('text');
    const field = parse(tags).fields[0];
    expect(field.type).toBe('checkbox');
    expect(field.options?.options).toBeUndefined();
  });

  it('survives a half-built choice row with no selectOptions array', () => {
    // the preview encodes state mid-edit; publish never saw this shape
    expect(() =>
      builderItemFromState(state({ type: 'select', selectOptions: undefined }))
    ).not.toThrow();
  });

  it('emits vocab only when it carries an address, and output when set', () => {
    expect(item(state({ vocab: { address: '', relay: '' } })).vocab).toBeUndefined();
    const withVocab = item(
      state({ vocab: { address: '30001:pk:d', relay: 'wss://r' }, output: 'amb:about' })
    );
    expect(withVocab.vocab).toEqual({ address: '30001:pk:d', relay: 'wss://r' });
    expect(withVocab.output).toBe('amb:about');
  });
});

describe('builderStateToTags', () => {
  it('accepts an empty d-tag (a preview precedes the identifier)', () => {
    const tags = builderStateToTags([state()], {});
    expect(tags.find((t) => t[0] === 'd')).toEqual(['d', '']);
  });

  it('puts form metadata where parseFormTemplate looks for it', () => {
    const tags = builderStateToTags([state()], {
      dTag: 'my-form',
      name: 'My Form',
      description: 'desc',
      public: true,
      confirmationMessage: 'thanks!'
    });
    const parsed = parse(tags);
    expect(parsed.dTag).toBe('my-form');
    expect(parsed.name).toBe('My Form');
    expect(parsed.description).toBe('desc');
    expect(parsed.isPublic).toBe(true);
    expect(parsed.confirmationMessage).toBe('thanks!');
  });

  it('records fork provenance', () => {
    const tags = builderStateToTags([], {
      forkOf: { address: '30168:pk:parent', relay: 'wss://r' }
    });
    expect(parse(tags).forkOf).toEqual({
      address: '30168:pk:parent',
      relay: 'wss://r'
    });
  });

  it('emits no sections when the builder has no dividers', () => {
    const parsed = parse(builderStateToTags([state()], { dTag: 'd' }));
    expect(parsed.sections).toEqual([]);
  });
});

describe('round-trip: what the builder holds is what a respondent parses', () => {
  // The whole preview rests on this: encode builder state with the publish
  // encoder, decode with the respondent parser, and get the same form back.
  const fields = [
    sectionState('sec-a', 'Section A'),
    state({
      id: 'color',
      type: 'radio',
      label: 'Color',
      selectOptions: [
        { id: 'red', label: 'Red', nextSection: 'sec-c' },
        { id: 'blue', label: 'Blue' }
      ],
      required: true
    }),
    sectionState('sec-b', 'Section B'),
    state({ id: 'note', type: 'text', label: 'Note' }),
    sectionState('sec-c', 'Section C'),
    state({
      id: 'reason',
      type: 'text',
      label: 'Reason',
      displayIf: { rules: [{ questionId: 'color', operator: 'equals', value: 'red' }] }
    })
  ];

  const parsed = parse(builderStateToTags(fields, { dTag: 'rt' }));

  it('preserves field order and identity', () => {
    expect(parsed.fields.map((f) => f.id)).toEqual(['color', 'note', 'reason']);
    expect(parsed.fields.map((f) => f.type)).toEqual(['radio', 'text', 'text']);
  });

  it('preserves section grouping', () => {
    expect(parsed.sections.map((s) => [s.id, s.title, s.questionIds])).toEqual([
      ['sec-a', 'Section A', ['color']],
      ['sec-b', 'Section B', ['note']],
      ['sec-c', 'Section C', ['reason']]
    ]);
  });

  it('preserves required and the choice labels', () => {
    const color = parsed.fields.find((f) => f.id === 'color');
    expect(color?.options?.required).toBe(true);
    expect(color?.options?.options).toEqual([
      { id: 'red', label: 'Red', nextSection: 'sec-c' },
      { id: 'blue', label: 'Blue' }
    ]);
  });

  it('preserves the displayIf rule', () => {
    const reason = parsed.fields.find((f) => f.id === 'reason');
    expect(reason?.options?.displayIf).toEqual({
      rules: [{ questionId: 'color', operator: 'equals', value: 'red' }]
    });
  });

  // The two behaviours the flat readonly preview cannot show. Asserted through
  // the same branching helpers FormRenderer drives, so a preview built on these
  // tags routes exactly as the published form will.
  it('routes red A->C (skipping B) and falls through linearly on blue', () => {
    const sections = orderedSections(parsed);
    expect(sections.map((s) => s.id)).toEqual(['sec-a', 'sec-b', 'sec-c']);
    expect(resolveNextSectionId('sec-a', sections, parsed.fields, { color: 'red' })).toBe('sec-c');
    expect(resolveNextSectionId('sec-a', sections, parsed.fields, { color: 'blue' })).toBe('sec-b');
  });

  it('shows "Reason" only when Color is Red', () => {
    const ids = (/** @type {Record<string, any>} */ values) =>
      visibleFields(parsed.fields, values).map((f) => f.id);
    expect(ids({ color: 'red' })).toContain('reason');
    expect(ids({ color: 'blue' })).not.toContain('reason');
  });
});
