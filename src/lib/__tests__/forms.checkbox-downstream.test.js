/**
 * TestOER — independent verification of 8c6883d6 (#77).
 *
 * The fix gives a checkbox-with-options the same value shape select+multiple
 * already used (';'-joined option ids). "Same shape as an existing path" is a
 * claim about DOWNSTREAM consumers, and none of them were exercised by the
 * commit's tests — every measurement stopped at the renderer.
 *
 * So: drive the two field types through the consumers that read that shape and
 * assert they are indistinguishable. If they ever diverge, the checkbox group
 * is on a path of its own rather than an established one, and whatever is true
 * of select+multiple stops being evidence about checkbox.
 */
import { describe, it, expect } from 'vitest';
import { validateField } from '$lib/helpers/forms.js';
import { formValuesToAmbJson } from '$lib/helpers/educational/formValuesToAmbJson.js';
import { evaluateDisplayIf } from '$lib/helpers/forms/branching.js';

const OPTS = [
  { id: 'o1', label: 'test' },
  { id: 'o2', label: 'test2' },
  { id: 'o3', label: 'test3' }
];

/** @param {string} type @param {object} over */
function field(type, over = {}) {
  return {
    id: 'q',
    type,
    label: 'Q',
    defaultValue: '',
    options: { required: true, options: OPTS, ...(type === 'select' ? { multiple: true } : {}) },
    output: 'amb:keywords',
    ...over
  };
}

describe('a checkbox group behaves as select+multiple already does', () => {
  const cb = field('checkbox');
  const sel = field('select');

  it.each([
    ['nothing chosen', ''],
    ['undefined', undefined],
    ['one chosen', 'o2'],
    ['two chosen', 'o1;o3']
  ])('required validation agrees on %s', (_name, value) => {
    // `undefined` is one of the rows on purpose — an untouched field really
    // can arrive absent at runtime, which the param type does not admit.
    const v = /** @type {any} */ (value);
    expect(validateField(cb, v)).toBe(validateField(sel, v));
  });

  it.each([
    ['ext output', 'ext'],
    ['amb scalar output', 'amb:name'],
    ['keywords output', 'amb:keywords']
  ])('AMB submission output is identical for %s', (_name, output) => {
    const form = { pubkey: 'pk', dTag: 'd', fields: [] };
    const values = { q: 'o1;o3' };
    const a = formValuesToAmbJson({ ...form, fields: [field('checkbox', { output })] }, values, {});
    const b = formValuesToAmbJson({ ...form, fields: [field('select', { output })] }, values, {});
    expect(a).toEqual(b);
  });

  it('show-if "contains" reads a multi-answer the same way for both', () => {
    const displayIf = /** @type {any} */ ({
      rules: [{ questionId: 'q', operator: 'contains', value: 'o3' }]
    });
    expect(evaluateDisplayIf(displayIf, { q: 'o1;o3' })).toBe(true);
    expect(evaluateDisplayIf(displayIf, { q: 'o1;o2' })).toBe(false);
  });
});

describe('the optionless checkbox keeps its boolean contract', () => {
  const bool = { id: 'c', type: 'checkbox', label: 'Consent', options: { required: true } };

  it('accepts the boolean FieldsRenderer emits', () => {
    expect(validateField(bool, true)).toBeNull();
  });

  it('still accepts the legacy string, so old stored answers do not break', () => {
    expect(validateField(bool, 'true')).toBeNull();
  });

  it.each([
    ['unticked boolean', false],
    ['untouched', ''],
    ['absent', undefined]
  ])('rejects %s', (_name, value) => {
    expect(validateField(bool, /** @type {any} */ (value))).toBe('Consent is required');
  });
});
