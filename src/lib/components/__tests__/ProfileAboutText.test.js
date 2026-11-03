/**
 * A profile's About (kind 0 `about`) is plain text, but its URLs, nostr:
 * mentions and hashtags are links — before, ProfileRail printed it verbatim,
 * so "https://oer.community/" could not be clicked.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { nip19 } from 'nostr-tools';

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));

// The mention renders while the profile is still unknown: an "@…" link.
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => undefined
}));

vi.mock('$lib/paraglide/messages', () => ({
  media_image_open: () => 'Open image',
  media_video_play: () => 'Play video',
  media_lightbox_close: () => 'Close',
  media_lightbox_prev: () => 'Previous image',
  media_lightbox_next: () => 'Next image'
}));

import ProfileAboutText from '../shared/ProfileAboutText.svelte';

const PUBKEY = 'a'.repeat(64);
const NPUB = nip19.npubEncode(PUBKEY);

describe('ProfileAboutText', () => {
  it('renders a URL as a link to it', async () => {
    render(ProfileAboutText, {
      props: { about: 'Wir sind https://oer.community/ — kommt vorbei' }
    });
    await tick();

    const link = screen.getByRole('link', { name: /oer\.community/ });
    expect(link.getAttribute('href')).toBe('https://oer.community/');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders a nostr:npub mention as a link to the profile', async () => {
    const { container } = render(ProfileAboutText, {
      props: { about: `Teil von nostr:${NPUB} und mehr` }
    });
    await tick();

    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.startsWith('/p/'))).toBe(true);
    expect(container.textContent).not.toContain(`nostr:${NPUB}`);
  });

  it('renders a hashtag as a link to discover', async () => {
    render(ProfileAboutText, { props: { about: 'Ich mag #OER und #Bildung' } });
    await tick();

    const link = screen.getByRole('link', { name: '#OER' });
    expect(link.getAttribute('href')).toBe('/discover?tags=OER');
  });

  it('keeps line breaks and treats the text as plain text, not markdown', async () => {
    const { container } = render(ProfileAboutText, {
      props: { about: 'Zeile eins\n**nicht fett**' }
    });
    await tick();

    expect(container.textContent).toContain('Zeile eins\n**nicht fett**');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('.whitespace-pre-wrap')).toBeTruthy();
  });

  // laoc: bare links in the About box — no image, video or event previews.
  it('shows an image URL as a bare link, not as an image', async () => {
    const url = 'https://image.nostr.build/abc.jpg';
    const { container } = render(ProfileAboutText, { props: { about: `Mein Bild ${url} hier` } });
    await tick();

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="media-image"]')).toBeNull();
    const link = screen.getByRole('link', { name: /abc\.jpg/ });
    expect(link.getAttribute('href')).toBe(url);
  });

  it('shows several image URLs as bare links, not as a gallery', async () => {
    const a = 'https://image.nostr.build/a.jpg';
    const b = 'https://image.nostr.build/b.jpg';
    const { container } = render(ProfileAboutText, { props: { about: `${a}\n${b}` } });
    await tick();

    expect(container.querySelector('[data-testid="media-gallery"]')).toBeNull();
    const hrefs = [...container.querySelectorAll('a')].map((x) => x.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining([a, b]));
  });
});
