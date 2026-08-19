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
  // Mirrors the fixture pattern in src/lib/__tests__/validateWizardStep.test.js:
  // predictable string-id messages + a full ctx (isEkw/hasSubjectVocab/
  // subjectsCount included even though step 2 doesn't read them, for parity
  // with how every other suite builds its ctx).
  const messages = {
    bildungsbereich: () => 'ERR_BILDUNGSBEREICH',
    urlRequired: () => 'ERR_URL_REQUIRED',
    identifier: () => 'ERR_IDENTIFIER_FORMAT',
    title: () => 'ERR_TITLE',
    description: () => 'ERR_DESCRIPTION',
    resourceType: () => 'ERR_RESOURCE_TYPE',
    subject: () => 'ERR_SUBJECT',
    noUrlNeedsFile: () => 'needs file',
    license: () => 'ERR_LICENSE',
    imageLicenseMissing: () => 'ERR_IMAGE_LICENSE_MISSING',
    encodingLicenseMissing: () => 'ERR_ENCODING_LICENSE_MISSING'
  };

  const ctx = {
    isEkw: false,
    hasNoUrl: false,
    isEditMode: false,
    hasSubjectVocab: true,
    subjectsCount: 0,
    isValidUrl: () => true,
    messages,
    variantId: 'interactive'
  };

  it('requires a licensed package', () => {
    const errors = validateWizardStep(2, { encodings: [] }, ctx);
    expect(errors.attachments).toBe('needs file');
  });

  it('passes with a licensed x-webxdc encoding and set identifier', () => {
    const formData = {
      identifier: 'https://blossom/x.xdc',
      encodings: [{ type: 'application/x-webxdc', sha256: 'aa', licenseEvent: { id: 'e' } }]
    };
    expect(validateWizardStep(2, formData, ctx)).toEqual({});
  });
});
