/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { LOCKED_FIELD_OUTPUTS } from '$lib/helpers/forms/builder-sections.js';
import { fieldToState } from '$lib/helpers/forms/builder-state.js';

describe('doi field type in the builder', () => {
  it('is locked to the amb:id output, like external-urls is to amb:refs', () => {
    expect(LOCKED_FIELD_OUTPUTS.doi).toBe('amb:id');
  });

  it('normalizes a loaded doi field to amb:id even if the tag carried something else', () => {
    const state = fieldToState({
      id: 'doi',
      type: 'doi',
      label: 'DOI',
      output: 'amb:doi',
      options: {}
    });
    expect(state.output).toBe('amb:id');
  });
});
