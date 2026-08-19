// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { appendInteractiveTags } from '../eventTags.js';
import { validateWizardStep } from '../validateWizardStep.js';
import { ALL_VARIANTS } from '../../../config/resource-form-variants.js';

describe('interactive variant registration', () => {
  it('is registered with label keys', () => {
    const v = ALL_VARIANTS.find((v) => v.id === 'interactive');
    expect(v).toBeTruthy();
    expect(v.labelKey).toBe('resource_form_variant_interactive_label');
  });
});

describe('appendInteractiveTags', () => {
  it('adds m and x tags for an x-webxdc file', () => {
    const tags = [];
    appendInteractiveTags(tags, [{ type: 'application/x-webxdc', sha256: 'aa' }]);
    expect(tags).toContainEqual(['m', 'application/x-webxdc']);
    expect(tags).toContainEqual(['x', 'aa']);
  });

  it('does nothing without one', () => {
    const tags = [];
    appendInteractiveTags(tags, [{ type: 'application/pdf', sha256: 'bb' }]);
    appendInteractiveTags(tags, undefined);
    expect(tags).toEqual([]);
  });
});

describe('validateWizardStep interactive step 2', () => {
  const ctx = {
    hasNoUrl: false,
    isEditMode: false,
    isValidUrl: () => true,
    variantId: 'interactive'
  };

  it('requires a licensed package', () => {
    const errors = validateWizardStep(2, { encodings: [] }, ctx);
    expect(errors.attachments).toBeTruthy();
  });

  it('passes with a licensed x-webxdc encoding and set identifier', () => {
    const formData = {
      identifier: 'https://blossom/x.xdc',
      encodings: [{ type: 'application/x-webxdc', sha256: 'aa', licenseEvent: { id: 'e' } }]
    };
    expect(validateWizardStep(2, formData, ctx)).toEqual({});
  });
});
