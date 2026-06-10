/**
 * EncodingPreview Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages.js', () => ({
  amb_resource_open_pdf_inline_fallback: () => 'Open PDF in a new tab'
}));

import EncodingPreview from '../educational/EncodingPreview.svelte';

describe('EncodingPreview', () => {
  it('renders an <object> for application/pdf', () => {
    const { container } = render(EncodingPreview, {
      props: {
        url: 'https://example.com/doc.pdf',
        mimeType: 'application/pdf',
        name: 'doc.pdf'
      }
    });
    const obj = container.querySelector('object[type="application/pdf"]');
    expect(obj).toBeTruthy();
    expect(obj?.getAttribute('data')).toBe('https://example.com/doc.pdf');
  });

  it('renders a lazy <img> for image mime types', () => {
    const { container } = render(EncodingPreview, {
      props: {
        url: 'https://example.com/pic.png',
        mimeType: 'image/png',
        name: 'pic.png'
      }
    });
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('https://example.com/pic.png');
    expect(img?.getAttribute('alt')).toBe('pic.png');
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('renders nothing for unknown mime types', () => {
    const { container } = render(EncodingPreview, {
      props: {
        url: 'https://example.com/archive.zip',
        mimeType: 'application/zip',
        name: 'archive.zip'
      }
    });
    expect(container.querySelector('object')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('uses the .pdf filename extension when mime is generic', () => {
    const { container } = render(EncodingPreview, {
      props: {
        url: 'https://example.com/doc.pdf',
        mimeType: 'application/octet-stream',
        name: 'doc.pdf'
      }
    });
    expect(container.querySelector('object[type="application/pdf"]')).toBeTruthy();
  });

  it('uses an image extension when mime is generic', () => {
    const { container } = render(EncodingPreview, {
      props: {
        url: 'https://example.com/photo.jpg',
        mimeType: 'application/octet-stream',
        name: 'photo.jpg'
      }
    });
    expect(container.querySelector('img')).toBeTruthy();
  });

  it('upgrades http:// to https:// in the PDF embed source', () => {
    const { container } = render(EncodingPreview, {
      props: {
        url: 'http://blossom.example.com/doc.pdf',
        mimeType: 'application/pdf',
        name: 'doc.pdf'
      }
    });
    const obj = container.querySelector('object[type="application/pdf"]');
    expect(obj).toBeTruthy();
    expect(obj?.getAttribute('data')).toBe('https://blossom.example.com/doc.pdf');
  });

  it('upgrades http:// to https:// in the image src', () => {
    const { container } = render(EncodingPreview, {
      props: {
        url: 'http://blossom.example.com/pic.png',
        mimeType: 'image/png',
        name: 'pic.png'
      }
    });
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://blossom.example.com/pic.png');
  });

  it('renders a compact PDF fallback card when the URL scheme is not http(s)', () => {
    const { container } = render(EncodingPreview, {
      props: {
        url: 'ftp://example.com/doc.pdf',
        mimeType: 'application/pdf',
        name: 'doc.pdf'
      }
    });
    expect(container.querySelector('object')).toBeNull();
    const link = container.querySelector('a[href="ftp://example.com/doc.pdf"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.textContent).toContain('Open PDF in a new tab');
  });

  it('does not render the inline fallback link inside the <object> on the happy path', () => {
    const { container } = render(EncodingPreview, {
      props: {
        url: 'https://example.com/doc.pdf',
        mimeType: 'application/pdf',
        name: 'doc.pdf'
      }
    });
    // The 80vh viewer renders cleanly; the row's existing View/Download buttons
    // handle the fallback affordance, so no link inside the <object>.
    expect(container.querySelector('object a')).toBeNull();
  });
});
