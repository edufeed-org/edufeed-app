/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  APPLICANT_LOCALE_FIELD,
  resolveApplicantLocale
} from '$lib/helpers/membership-applications.js';

describe('resolveApplicantLocale', () => {
  it('returns the UI locale the applicant stored in the form answer', () => {
    expect(resolveApplicantLocale({ wished_handle: 'maria', [APPLICANT_LOCALE_FIELD]: 'en' })).toBe(
      'en'
    );
    expect(resolveApplicantLocale({ [APPLICANT_LOCALE_FIELD]: 'de' })).toBe('de');
  });

  it('falls back to the base locale for applications that predate the field', () => {
    expect(resolveApplicantLocale({ wished_handle: 'maria' })).toBe('de');
    expect(resolveApplicantLocale(undefined)).toBe('de');
  });

  it('ignores a locale the app does not ship', () => {
    expect(resolveApplicantLocale({ [APPLICANT_LOCALE_FIELD]: 'fr' })).toBe('de');
    expect(resolveApplicantLocale({ [APPLICANT_LOCALE_FIELD]: '' })).toBe('de');
  });

  it('names the field the application form writes', () => {
    expect(APPLICANT_LOCALE_FIELD).toBe('ui_locale');
  });
});
