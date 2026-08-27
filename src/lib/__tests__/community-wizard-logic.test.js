/** @vitest-environment node */
// src/lib/__tests__/community-wizard-logic.test.js
import { describe, it, expect } from 'vitest';
import {
  communityWizardSteps,
  applyDefaultAccess,
  disableAllContentTypes
} from '$lib/components/community/create/wizard-logic.js';
import { createDefaultContentTypes } from '$lib/helpers/communityTagBuilder.js';

describe('communityWizardSteps', () => {
  it('collapses to the legacy flows when the type step is hidden', () => {
    expect(communityWizardSteps({ useCurrentKeypair: true, typeStepVisible: false })).toEqual([
      'settings',
      'confirm'
    ]);
    expect(communityWizardSteps({ useCurrentKeypair: false, typeStepVisible: false })).toEqual([
      'profile',
      'keys',
      'settings',
      'confirm'
    ]);
  });
  it('inserts the type step after identity, before settings', () => {
    expect(communityWizardSteps({ useCurrentKeypair: true, typeStepVisible: true })).toEqual([
      'type',
      'settings',
      'confirm'
    ]);
    expect(communityWizardSteps({ useCurrentKeypair: false, typeStepVisible: true })).toEqual([
      'profile',
      'keys',
      'type',
      'settings',
      'confirm'
    ]);
  });

  // 'people' collapse guarantee — only present for moderated communities,
  // and only when the type step itself is visible (a stray communityType:
  // 'moderated' left over from a previous flags-on session must not leak a
  // 'people' step in once flags go off and the type step disappears).
  it('never inserts the people step when the type step is hidden, regardless of communityType', () => {
    expect(
      communityWizardSteps({
        useCurrentKeypair: true,
        typeStepVisible: false,
        communityType: 'moderated'
      })
    ).toEqual(['settings', 'confirm']);
  });

  it('omits the people step for open and closed communities', () => {
    expect(
      communityWizardSteps({
        useCurrentKeypair: true,
        typeStepVisible: true,
        communityType: 'open'
      })
    ).toEqual(['type', 'settings', 'confirm']);
    expect(
      communityWizardSteps({
        useCurrentKeypair: true,
        typeStepVisible: true,
        communityType: 'closed'
      })
    ).toEqual(['type', 'settings', 'confirm']);
  });

  it('inserts the people step after settings, before confirm, for moderated communities', () => {
    expect(
      communityWizardSteps({
        useCurrentKeypair: true,
        typeStepVisible: true,
        communityType: 'moderated'
      })
    ).toEqual(['type', 'settings', 'people', 'confirm']);
    expect(
      communityWizardSteps({
        useCurrentKeypair: false,
        typeStepVisible: true,
        communityType: 'moderated'
      })
    ).toEqual(['profile', 'keys', 'type', 'settings', 'people', 'confirm']);
  });
});

describe('applyDefaultAccess / disableAllContentTypes', () => {
  it('sets every entry access to the tier, immutably', () => {
    const input = createDefaultContentTypes(['learning', 'chat']);
    const out = applyDefaultAccess(input, 'members');
    expect(out.learning.access).toEqual({ tier: 'members' });
    expect(out.chat.access).toEqual({ tier: 'members' });
    expect(input.learning.access).toEqual({ tier: 'all' });
  });
  it('disables everything, immutably', () => {
    const input = createDefaultContentTypes(['learning']);
    const out = disableAllContentTypes(input);
    expect(Object.values(out).every((ct) => ct.enabled === false)).toBe(true);
    expect(input.learning.enabled).toBe(true);
  });
});
