// @ts-nocheck
/** @vitest-environment node */
/**
 * Interactive (webxdc) encodings in the generic resource flow: NIP-DC
 * discovery tags on the kind-30142 and the step-5 license-gate exemptions.
 * (The dedicated `interactive` form variant was removed — packages now enter
 * through the normal upload flow.)
 */
import { describe, it, expect } from 'vitest';
import { appendInteractiveTags } from '../eventTags.js';
import { validateWizardStep } from '../validateWizardStep.js';

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

describe('validateWizardStep — x-webxdc encodings on step 5', () => {
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
    messages
  };

  it('edit mode: passes even without a licenseEvent on the x-webxdc encoding', () => {
    // The package is immutable once published (d-tag can't change), so the
    // original attestation already covers it even if the rehydration fetch
    // for the license event hasn't landed yet.
    const formData = {
      encodings: [{ type: 'application/x-webxdc', sha256: 'aa', licenseEvent: null }],
      externalUrls: []
    };
    const errors = validateWizardStep(5, formData, { ...ctx, isEditMode: true });
    expect(errors.encodings).toBeUndefined();
  });

  it('non-edit mode: still blocks when the x-webxdc encoding has no licenseEvent', () => {
    const formData = {
      encodings: [{ type: 'application/x-webxdc', sha256: 'aa', licenseEvent: null }],
      externalUrls: []
    };
    const errors = validateWizardStep(5, formData, ctx);
    expect(errors.encodings).toBe('ERR_ENCODING_LICENSE_MISSING');
  });

  it('edit mode: still blocks a non-webxdc encoding missing a licenseEvent', () => {
    const formData = {
      encodings: [{ type: 'application/pdf', sha256: 'bb', licenseEvent: null }],
      externalUrls: []
    };
    const errors = validateWizardStep(5, formData, { ...ctx, isEditMode: true });
    expect(errors.encodings).toBe('ERR_ENCODING_LICENSE_MISSING');
  });
});
