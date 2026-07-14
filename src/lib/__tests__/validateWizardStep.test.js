// @ts-nocheck
/**
 * validateWizardStep — pure validation helper for ResourceFormWizard.
 *
 * Returns a map of `fieldKey → errorMessage` for the given step. Used both
 * by the wizard's "advance" button (whole-step check) and by inline blur
 * handlers (single-field check filtered from the same map). Pure so the
 * wizard can call it in `$derived`.
 *
 * Field keys are logical names that match the form-data shape, with
 * step-cross-field aggregates getting their own slot:
 *   bildungsbereich, identifier, name, description, learningResourceType,
 *   about (subject aggregate), attachments (encodings ∪ externalUrls), license.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

import { validateWizardStep } from '../helpers/educational/validateWizardStep.js';

/** Predictable string-id messages so assertions are stable. */
const messages = {
  bildungsbereich: () => 'ERR_BILDUNGSBEREICH',
  urlRequired: () => 'ERR_URL_REQUIRED',
  identifier: () => 'ERR_IDENTIFIER_FORMAT',
  title: () => 'ERR_TITLE',
  description: () => 'ERR_DESCRIPTION',
  resourceType: () => 'ERR_RESOURCE_TYPE',
  subject: () => 'ERR_SUBJECT',
  noUrlNeedsFile: () => 'ERR_NO_URL_NEEDS_FILE',
  license: () => 'ERR_LICENSE',
  imageLicenseMissing: () => 'ERR_IMAGE_LICENSE_MISSING',
  encodingLicenseMissing: () => 'ERR_ENCODING_LICENSE_MISSING'
};

const isValidUrl = (s) => /^https?:\/\//.test(s);

function ctx(overrides = {}) {
  return {
    isEkw: false,
    hasNoUrl: false,
    isEditMode: false,
    hasSubjectVocab: true,
    subjectsCount: 0,
    isValidUrl,
    messages,
    ...overrides
  };
}

function emptyFormData() {
  return {
    bildungsbereich: '',
    identifier: '',
    name: '',
    description: '',
    learningResourceType: [],
    encodings: [],
    externalUrls: [],
    license: 'https://creativecommons.org/licenses/by/4.0/'
  };
}

describe('validateWizardStep', () => {
  describe('step 1 — Bildungsbereich', () => {
    it('flags bildungsbereich when empty', () => {
      const errors = validateWizardStep(1, emptyFormData(), ctx());
      expect(errors).toEqual({ bildungsbereich: 'ERR_BILDUNGSBEREICH' });
    });

    it('passes when bildungsbereich is set', () => {
      const errors = validateWizardStep(
        1,
        { ...emptyFormData(), bildungsbereich: 'allgemeinbildung' },
        ctx()
      );
      expect(errors).toEqual({});
    });
  });

  describe('step 2 — URL / naddr', () => {
    it('flags identifier when missing and the user did NOT opt out of a URL', () => {
      const errors = validateWizardStep(2, emptyFormData(), ctx({ hasNoUrl: false }));
      expect(errors).toEqual({ identifier: 'ERR_URL_REQUIRED' });
    });

    it('passes when identifier is present', () => {
      const errors = validateWizardStep(
        2,
        { ...emptyFormData(), identifier: 'https://example.org' },
        ctx()
      );
      expect(errors).toEqual({});
    });

    it('flags attachments when the user opted out of a URL but uploaded no file (create mode)', () => {
      const errors = validateWizardStep(2, emptyFormData(), ctx({ hasNoUrl: true }));
      expect(errors).toEqual({ attachments: 'ERR_NO_URL_NEEDS_FILE' });
    });

    it('passes when hasNoUrl and at least one file has been uploaded', () => {
      const formData = { ...emptyFormData(), encodings: [{ url: 'x', name: 'y' }] };
      const errors = validateWizardStep(2, formData, ctx({ hasNoUrl: true }));
      expect(errors).toEqual({});
    });

    it('does not require a file in edit mode (step-2 uploader is hidden there)', () => {
      const errors = validateWizardStep(
        2,
        emptyFormData(),
        ctx({ hasNoUrl: true, isEditMode: true })
      );
      expect(errors).toEqual({});
    });
  });

  describe('step 3 — Basic info', () => {
    it('flags name and description when both empty', () => {
      const errors = validateWizardStep(3, emptyFormData(), ctx());
      expect(errors).toEqual({
        name: 'ERR_TITLE',
        description: 'ERR_DESCRIPTION'
      });
    });

    it('flags identifier when present but not a valid URL', () => {
      const formData = {
        ...emptyFormData(),
        name: 'Test',
        description: 'Desc',
        identifier: 'not-a-url'
      };
      const errors = validateWizardStep(3, formData, ctx());
      expect(errors).toEqual({ identifier: 'ERR_IDENTIFIER_FORMAT' });
    });

    it('passes when name + description are filled and identifier is empty', () => {
      const formData = { ...emptyFormData(), name: 'Test', description: 'Desc' };
      const errors = validateWizardStep(3, formData, ctx());
      expect(errors).toEqual({});
    });

    describe('image license validation', () => {
      it('flags uploaded image without license event as invalid', () => {
        const formData = {
          ...emptyFormData(),
          name: 'Test',
          description: 'Desc',
          image: 'https://blossom.example/abc.jpg',
          imageWasUploaded: true,
          imageLicenseEvent: null
        };
        const errors = validateWizardStep(3, formData, ctx());
        expect(errors.image).toBe('ERR_IMAGE_LICENSE_MISSING');
      });

      it('accepts uploaded image with license event', () => {
        const formData = {
          ...emptyFormData(),
          name: 'Test',
          description: 'Desc',
          image: 'https://blossom.example/abc.jpg',
          imageWasUploaded: true,
          imageLicenseEvent: { kind: 1063, tags: [['x', 'a'.repeat(64)]] }
        };
        const errors = validateWizardStep(3, formData, ctx());
        expect(errors.image).toBeFalsy();
      });

      it('accepts pasted URL without license event', () => {
        const formData = {
          ...emptyFormData(),
          name: 'Test',
          description: 'Desc',
          image: 'https://wikipedia.org/img.jpg',
          imageWasUploaded: false,
          imageLicenseEvent: null
        };
        const errors = validateWizardStep(3, formData, ctx());
        expect(errors.image).toBeFalsy();
      });

      it('accepts empty image regardless of upload/license state', () => {
        const formData = {
          ...emptyFormData(),
          name: 'Test',
          description: 'Desc',
          image: '',
          imageWasUploaded: true,
          imageLicenseEvent: null
        };
        const errors = validateWizardStep(3, formData, ctx());
        expect(errors.image).toBeFalsy();
      });
    });

    describe('content license', () => {
      it('flags license when cleared', () => {
        const formData = { ...emptyFormData(), name: 'T', description: 'D', license: '' };
        const errors = validateWizardStep(3, formData, ctx());
        expect(errors).toEqual({ license: 'ERR_LICENSE' });
      });

      it('passes when license is set', () => {
        const formData = { ...emptyFormData(), name: 'T', description: 'D' };
        const errors = validateWizardStep(3, formData, ctx());
        expect(errors).toEqual({});
      });
    });
  });

  describe('step 4 — Classification', () => {
    it('flags learningResourceType when empty', () => {
      const errors = validateWizardStep(4, emptyFormData(), ctx({ subjectsCount: 1 }));
      expect(errors).toEqual({ learningResourceType: 'ERR_RESOURCE_TYPE' });
    });

    it('flags subject (about) when subject vocab exists but no subjects are selected', () => {
      const formData = {
        ...emptyFormData(),
        learningResourceType: [{ id: 'x', label: 'X' }]
      };
      const errors = validateWizardStep(
        4,
        formData,
        ctx({ hasSubjectVocab: true, subjectsCount: 0 })
      );
      expect(errors).toEqual({ about: 'ERR_SUBJECT' });
    });

    it('flags subject for EKW too — Fachrichtung now lives in aboutByVocab and counts', () => {
      const formData = {
        ...emptyFormData(),
        learningResourceType: [{ id: 'x', label: 'X' }]
      };
      const errors = validateWizardStep(
        4,
        formData,
        ctx({ isEkw: true, hasSubjectVocab: true, subjectsCount: 0 })
      );
      expect(errors).toEqual({ about: 'ERR_SUBJECT' });
    });

    it('passes EKW step 4 when Fachrichtung is selected (subjectsCount>=1)', () => {
      const formData = {
        ...emptyFormData(),
        learningResourceType: [{ id: 'x', label: 'X' }]
      };
      const errors = validateWizardStep(
        4,
        formData,
        ctx({ isEkw: true, hasSubjectVocab: true, subjectsCount: 1 })
      );
      expect(errors).toEqual({});
    });

    it('does not flag subject when the Bildungsbereich has no subject vocab (e.g. Konfi-Arbeit)', () => {
      const formData = {
        ...emptyFormData(),
        learningResourceType: [{ id: 'x', label: 'X' }]
      };
      const errors = validateWizardStep(
        4,
        formData,
        ctx({ hasSubjectVocab: false, subjectsCount: 0 })
      );
      expect(errors).toEqual({});
    });
  });

  describe('step 5 — Content & Creators', () => {
    it('no longer gates on attachments — the file requirement now lives on step 2', () => {
      const errors = validateWizardStep(5, emptyFormData(), ctx({ hasNoUrl: true }));
      expect(errors.attachments).toBeUndefined();
    });

    it('step 5: blocks publish when an encoding has sha256 but no licenseEvent', () => {
      const errors = validateWizardStep(
        5,
        {
          encodings: [{ url: 'x', sha256: 'a'.repeat(64), licenseEvent: null }],
          externalUrls: []
        },
        ctx()
      );
      expect(errors.encodings).toBe('ERR_ENCODING_LICENSE_MISSING');
    });

    it('step 5: passes when every encoding with sha256 has a licenseEvent', () => {
      const errors = validateWizardStep(
        5,
        {
          encodings: [{ url: 'x', sha256: 'a'.repeat(64), licenseEvent: { id: 'lic1' } }],
          externalUrls: []
        },
        ctx()
      );
      expect(errors.encodings).toBeUndefined();
    });

    it('step 5: passes when encoding has no sha256 (legacy)', () => {
      const errors = validateWizardStep(
        5,
        {
          encodings: [{ url: 'x' }],
          externalUrls: []
        },
        ctx()
      );
      expect(errors.encodings).toBeUndefined();
    });
  });

  describe('steps with no validation — 6 (relations) and 7 (share)', () => {
    it('returns empty errors for step 6', () => {
      expect(validateWizardStep(6, emptyFormData(), ctx())).toEqual({});
    });

    it('returns empty errors for step 7', () => {
      expect(validateWizardStep(7, emptyFormData(), ctx())).toEqual({});
    });
  });
});
