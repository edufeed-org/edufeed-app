/** @vitest-environment jsdom */
// hidePicture: the create-community modal replaces the raw picture-URL input
// with LicensedImageInput (laoc, 2026-08-11), so the form must be able to
// step aside there the same way it already does for the banner.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ProfileForm from '$lib/components/shared/ProfileForm.svelte';

const userData = { name: '', about: '', picture: '', banner: '', website: '' };

describe('ProfileForm', () => {
  it('shows the picture URL field by default', () => {
    const { container } = render(ProfileForm, { props: { userData, errors: {} } });
    expect(container.querySelector('#profile-picture')).toBeTruthy();
  });

  it('hides the picture URL field when hidePicture is set', () => {
    const { container } = render(ProfileForm, {
      props: { userData, errors: {}, hidePicture: true }
    });
    expect(container.querySelector('#profile-picture')).toBeNull();
    expect(container.querySelector('#profile-name')).toBeTruthy();
  });

  it('asks about the community, not the person, when variant is community', () => {
    const { container } = render(ProfileForm, {
      props: { userData, errors: {}, hidePicture: true, hideBanner: true, variant: 'community' }
    });
    const name = /** @type {HTMLInputElement} */ (container.querySelector('#profile-name'));
    const about = /** @type {HTMLTextAreaElement} */ (container.querySelector('#profile-about'));
    expect(container.querySelector('label[for="profile-name"]')?.textContent).toContain(
      'Community'
    );
    expect(name.placeholder).not.toMatch(/your name|nickname/i);
    expect(about.placeholder).not.toMatch(/yourself/i);
    expect(about.placeholder).toMatch(/community/i);
  });

  it('keeps the personal wording by default', () => {
    const { container } = render(ProfileForm, { props: { userData, errors: {} } });
    const name = /** @type {HTMLInputElement} */ (container.querySelector('#profile-name'));
    expect(name.placeholder).toMatch(/your name/i);
  });
});
