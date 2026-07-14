/** @vitest-environment node */
import { describe, it, expect } from 'vitest';

import { validateField } from '$lib/helpers/forms.js';

describe('validateField — vocab fields', () => {
  /** @type {import('$lib/helpers/forms.js').FormField} */
  const requiredVocab = {
    id: 'konfiZielgruppen',
    type: 'vocab',
    label: 'Zielgruppen',
    vocab: { address: '39737:abc:x', relay: '' },
    options: { multiple: true, required: true }
  };

  it('flags required vocab when array is empty', () => {
    expect(validateField(requiredVocab, [])).toBe('Zielgruppen is required');
  });

  it('flags required vocab when value is undefined', () => {
    // @ts-expect-error - exercising the undefined path
    expect(validateField(requiredVocab, undefined)).toBe('Zielgruppen is required');
  });

  it('passes when at least one concept is selected', () => {
    // @ts-expect-error - object array, not string
    expect(validateField(requiredVocab, [{ id: 'urn:x', labels: { de: 'X' } }])).toBeNull();
  });

  it('non-required vocab with empty array passes', () => {
    const optionalVocab = { ...requiredVocab, options: { multiple: true } };
    expect(validateField(optionalVocab, [])).toBeNull();
  });
});
