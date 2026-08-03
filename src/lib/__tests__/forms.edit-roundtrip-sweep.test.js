/**
 * TestOER — independent verification of 27e90bb7 (per-field descriptions).
 *
 * The commit's own framing is the right one: a property `fieldToState` drops is
 * silently erased the first time an author re-opens their form, and that is
 * invisible from the publish direction. But it was tested for ONE property.
 * The class is every property the builder can author, so this sweeps all of
 * them through the full cycle
 *
 *     builder state -> tags -> parseFormTemplate -> fieldToState -> tags
 *
 * and asserts the two tag sets are identical. Any drop in either direction
 * shows up as a tag diff, whichever mapping caused it.
 *
 * The properties are taken from what `builderItemFromState` actually emits
 * (builder-state.js:39-55) — restated here rather than imported, so a change
 * to that list cannot silently delete a case from this test.
 */
import { describe, it, expect } from 'vitest';
import { builderStateToTags, fieldToState } from '$lib/helpers/forms/builder-state.js';
import { parseFormTemplate } from '$lib/helpers/forms/format.js';

/** Every options-bag key builderItemFromState can emit, with a probe value. */
const AUTHORED = {
  required: true,
  description: 'Gab es Aussagen?\n• erste\n• zweite',
  placeholder: 'hint here',
  min: 2,
  max: 9,
  multiple: true,
  selectOptions: [
    { id: 'o1', label: 'Red', nextSection: 'sec-c' },
    { id: 'o2', label: 'Blue' }
  ],
  displayIf: { rules: [{ questionId: 'other', operator: 'equals', value: 'Red' }] }
};

/**
 * A fully-populated builder FieldState. `output` pinned — see the wart test.
 * @param {Record<string, any>} [over]
 */
function fullState(over = {}) {
  return {
    id: 'q1',
    type: 'select',
    label: 'Colour',
    defaultValue: 'o1',
    output: 'ext',
    vocab: undefined,
    vocabNaddrInput: '',
    vocabError: '',
    ...AUTHORED,
    ...over
  };
}

/** @param {any[]} states @returns {string[][]} */
const toTags = (states) => builderStateToTags(states, { dTag: 'd1', name: 'N' });
/** @param {string[][]} tags @returns {any} */
const parse = (tags) =>
  parseFormTemplate(
    /** @type {any} */ ({ kind: 30168, pubkey: '', tags, content: '', created_at: 0 })
  );

/** One full publish -> re-open -> publish cycle. @param {any[]} states */
function reEdit(states) {
  const first = toTags(states);
  const reopened = parse(first).fields.map(/** @param {any} f */ (f) => fieldToState(f));
  return { first, second: toTags(reopened) };
}

describe('the edit cycle preserves every property the builder can author', () => {
  it('a fully-populated field round-trips to byte-identical tags', () => {
    const { first, second } = reEdit([fullState()]);
    expect(second).toEqual(first);
  });

  // Per-property, so a failure names the property rather than dumping the tags.
  it.each(Object.keys(AUTHORED))('%s survives publish -> re-open -> publish', (key) => {
    const { first, second } = reEdit([fullState()]);
    /** @param {string[][]} tags @returns {string[]} */
    const fieldTag = (tags) =>
      /** @type {string[]} */ (
        tags.find((/** @type {string[]} */ t) => t[0] === 'field' && t[1] === 'q1')
      );
    /** @param {string[][]} tags */
    const settings = (tags) => JSON.parse(fieldTag(tags)[5]);
    /** @param {string[][]} tags */
    const choices = (tags) => JSON.parse(fieldTag(tags)[4]);

    if (key === 'selectOptions') {
      expect(choices(second)).toEqual(choices(first));
      expect(choices(second).length).toBe(2);
    } else {
      const wire = key === 'multiple' ? 'multiple' : key;
      expect(settings(second)[wire]).toEqual(settings(first)[wire]);
      expect(settings(second)[wire]).toBeDefined();
    }
  });

  it('a description with newlines survives verbatim, bullets intact', () => {
    const { second } = reEdit([fullState()]);
    const tag = /** @type {string[]} */ (second.find((t) => t[0] === 'field'));
    const desc = JSON.parse(tag[5]).description;
    expect(desc).toBe('Gab es Aussagen?\n• erste\n• zweite');
    expect(desc.split('\n')).toHaveLength(3);
  });

  it('a field with NO description emits no description key at all', () => {
    const { first, second } = reEdit([fullState({ description: '' })]);
    for (const tags of [first, second]) {
      const t0 = /** @type {string[]} */ (tags.find((t) => t[0] === 'field'));
      const s = JSON.parse(t0[5]);
      expect('description' in s).toBe(false);
    }
  });
});

describe('the documented output wart is the ONLY thing an edit cycle moves', () => {
  // The commit says parseFormTemplate defaults a missing output to
  // `amb:<id>`, so re-publishing an output-less form materialises field-output
  // tags nobody authored — pre-existing, deliberately untouched. That is a
  // claim about SCOPE, so measure it: with output unset, the cycle must differ
  // in exactly those tags and nothing else.
  it('with output unset, only field-output tags appear — everything else identical', () => {
    const { first, second } = reEdit([fullState({ output: '' })]);

    /** @param {string[][]} tags */
    const withoutOutput = (tags) => tags.filter((t) => t[0] !== 'field-output');
    expect(withoutOutput(second)).toEqual(withoutOutput(first));

    expect(first.filter((t) => t[0] === 'field-output')).toEqual([]);
    expect(second.filter((t) => t[0] === 'field-output')).toEqual([
      ['field-output', 'q1', 'amb:q1']
    ]);
  });

  it('with output pinned, the cycle is a true fixed point (second == third)', () => {
    const first = toTags([fullState()]);
    /** @param {any} f */
    const fs = (f) => fieldToState(f);
    const second = toTags(parse(first).fields.map(fs));
    const third = toTags(parse(second).fields.map(fs));
    expect(third).toEqual(second);
    expect(second).toEqual(first);
  });
});

describe('a foreign description is data, not markup', () => {
  // The renderer shows options.description for ANY parsed event. These assert
  // the PARSER's contract — whatever arrives comes back as an inert string.
  it.each([
    ['script tag', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['markdown', '**bold** [link](http://x)'],
    ['RTL override', 'safe‮evil'],
    ['very long', 'x'.repeat(5000)]
  ])('%s survives parse as a plain string, unchanged', (_name, hostile) => {
    const tags = [
      ['d', 'd1'],
      ['settings', '{}'],
      [
        'field',
        'q1',
        'text',
        'L',
        '[]',
        JSON.stringify({ renderElement: 'text', description: hostile })
      ]
    ];
    const parsed = /** @type {any} */ (parse(tags).fields[0]);
    expect(typeof parsed.options.description).toBe('string');
    expect(parsed.options.description).toBe(hostile);
  });

  it('a non-string description is passed through as-is, not coerced', () => {
    const tags = [
      ['d', 'd1'],
      ['settings', '{}'],
      [
        'field',
        'q1',
        'text',
        'L',
        '[]',
        JSON.stringify({ renderElement: 'text', description: { a: 1 } })
      ]
    ];
    const parsed = /** @type {any} */ (parse(tags).fields[0]);
    // Documents actual behaviour so a future change to it is visible.
    expect(parsed.options.description).toEqual({ a: 1 });
  });
});
