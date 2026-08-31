/** @vitest-environment jsdom */
/**
 * MessageAttachments — encrypted imeta chat attachments rendered below a
 * message bubble. The decrypt layer is mocked (fetchDecryptedAttachmentUrl);
 * what's under test is the render contract: image/video/audio get native
 * elements once their URL resolves, files get a download chip, a failed
 * decrypt falls back to an "unavailable" chip, and nothing renders while
 * the URL is still pending.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import MessageAttachments from '../community/channels/MessageAttachments.svelte';

const ENC = { algorithm: 'aes-gcm', key: 'f'.repeat(64), nonce: '0'.repeat(32) };

// url -> resolved value the mock returns (null = decrypt failure);
// a url absent from this map stays pending forever (loading state).
const resolutions = new Map();
vi.mock('$lib/concord/blob-media.js', () => ({
  fetchDecryptedAttachmentUrl: vi.fn(
    (att) =>
      new Promise((resolve) => {
        if (resolutions.has(att.url)) resolve(resolutions.get(att.url));
        // else: never resolves — deliberate, models in-flight decrypt
      })
  )
}));

describe('MessageAttachments', () => {
  it('renders an <img> once an encrypted image resolves to an object URL', async () => {
    resolutions.set('https://blossom.example/pic.bin', 'blob:decrypted-pic');
    render(MessageAttachments, {
      attachments: [
        {
          url: 'https://blossom.example/pic.bin',
          type: 'image/jpeg',
          dimensions: '800x600',
          alt: 'a test photo',
          encryption: ENC
        }
      ]
    });
    await waitFor(() => {
      const img = screen.getByRole('img', { name: 'a test photo' });
      expect(img.getAttribute('src')).toBe('blob:decrypted-pic');
    });
  });

  it('renders a download chip for a file attachment (URL basename as label)', async () => {
    resolutions.set('https://blossom.example/paper.pdf', 'https://blossom.example/paper.pdf');
    render(MessageAttachments, {
      attachments: [
        { url: 'https://blossom.example/paper.pdf', type: 'application/pdf', size: 1024 }
      ]
    });
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /paper\.pdf/ });
      expect(link.getAttribute('href')).toBe('https://blossom.example/paper.pdf');
    });
  });

  it('falls back to an unavailable chip when decrypt fails (null URL)', async () => {
    resolutions.set('https://blossom.example/broken.bin', null);
    render(MessageAttachments, {
      attachments: [
        { url: 'https://blossom.example/broken.bin', type: 'image/png', encryption: ENC }
      ]
    });
    await waitFor(() => {
      expect(screen.getByText(/nicht verfügbar|unavailable/i)).toBeTruthy();
    });
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a loading placeholder while the decrypt is pending', () => {
    // url NOT in resolutions -> promise never settles
    render(MessageAttachments, {
      attachments: [
        {
          url: 'https://blossom.example/pending.bin',
          type: 'image/jpeg',
          dimensions: '400x300',
          encryption: ENC
        }
      ]
    });
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('.skeleton')).toBeTruthy();
  });

  it('renders nothing at all for an empty attachment list', () => {
    const { container } = render(MessageAttachments, { attachments: [] });
    expect(container.textContent.trim()).toBe('');
    expect(container.querySelector('img, video, audio, a, .skeleton')).toBeNull();
  });

  it('renders a <video> element for a resolved video attachment', async () => {
    resolutions.set('https://blossom.example/clip.bin', 'blob:decrypted-clip');
    const { container } = render(MessageAttachments, {
      attachments: [{ url: 'https://blossom.example/clip.bin', type: 'video/mp4', encryption: ENC }]
    });
    await waitFor(() => {
      const video = container.querySelector('video');
      expect(video?.getAttribute('src')).toBe('blob:decrypted-clip');
    });
  });
});
