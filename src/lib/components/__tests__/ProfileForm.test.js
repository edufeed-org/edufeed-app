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
});
