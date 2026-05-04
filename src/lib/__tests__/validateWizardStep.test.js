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
  noUrlNeedsAttachment: () => 'ERR_NO_URL_NEEDS_ATTACHMENT',
  license: () => 'ERR_LICENSE'
};

const isValidUrl = (s) => /^https?:\/\//.test(s);

function ctx(overrides = {}) {
  return {
    isEkw: false,
    hasNoUrl: false,
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
    license: ''
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

    it('passes with no identifier when the user explicitly opted out (hasNoUrl)', () => {
      const errors = validateWizardStep(2, emptyFormData(), ctx({ hasNoUrl: true }));
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

    it('does not flag subject for the EKW variant (uses Fachrichtung instead)', () => {
      const formData = {
        ...emptyFormData(),
        learningResourceType: [{ id: 'x', label: 'X' }]
      };
      const errors = validateWizardStep(
        4,
        formData,
        ctx({ isEkw: true, hasSubjectVocab: true, subjectsCount: 0 })
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
    it('flags attachments when hasNoUrl and neither encodings nor externalUrls exist', () => {
      const errors = validateWizardStep(5, emptyFormData(), ctx({ hasNoUrl: true }));
      expect(errors).toEqual({ attachments: 'ERR_NO_URL_NEEDS_ATTACHMENT' });
    });

    it('passes with at least one encoding when hasNoUrl', () => {
      const formData = { ...emptyFormData(), encodings: [{ url: 'x', name: 'y' }] };
      const errors = validateWizardStep(5, formData, ctx({ hasNoUrl: true }));
      expect(errors).toEqual({});
    });

    it('passes with at least one external URL when hasNoUrl', () => {
      const formData = { ...emptyFormData(), externalUrls: ['https://example.org'] };
      const errors = validateWizardStep(5, formData, ctx({ hasNoUrl: true }));
      expect(errors).toEqual({});
    });

    it('passes with no attachments when there IS a URL on step 2', () => {
      const errors = validateWizardStep(5, emptyFormData(), ctx({ hasNoUrl: false }));
      expect(errors).toEqual({});
    });
  });

  describe('step 7 — Rights', () => {
    it('flags license when empty', () => {
      const errors = validateWizardStep(7, emptyFormData(), ctx());
      expect(errors).toEqual({ license: 'ERR_LICENSE' });
    });

    it('passes when license is set', () => {
      const errors = validateWizardStep(
        7,
        { ...emptyFormData(), license: 'https://creativecommons.org/licenses/by/4.0/' },
        ctx()
      );
      expect(errors).toEqual({});
    });
  });

  describe('steps with no validation — 6 (relations) and 8 (share)', () => {
    it('returns empty errors for step 6', () => {
      expect(validateWizardStep(6, emptyFormData(), ctx())).toEqual({});
    });

    it('returns empty errors for step 8', () => {
      expect(validateWizardStep(8, emptyFormData(), ctx())).toEqual({});
    });
  });
});
