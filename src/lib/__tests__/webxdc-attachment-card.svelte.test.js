/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import WebxdcAttachmentCard from '$lib/components/groups/WebxdcAttachmentCard.svelte';

const attachment = {
  url: 'https://blossom.example/a.xdc',
  sha256: 'a'.repeat(64),
  webxdc: 'uuid-1',
  alt: 'Webxdc app: Pad',
  image: 'https://blossom.example/icon.png'
};

describe('WebxdcAttachmentCard', () => {
  it('shows the app name and launches on click', async () => {
    const onLaunch = vi.fn();
    const { getByRole, getByText } = render(WebxdcAttachmentCard, { attachment, onLaunch });
    expect(getByText('Pad')).toBeTruthy();
    await fireEvent.click(getByRole('button'));
    expect(onLaunch).toHaveBeenCalledWith(attachment);
  });

  it('shows the session title as the prominent line, with the app name secondary, when provided', () => {
    const { getByText } = render(WebxdcAttachmentCard, {
      attachment,
      title: 'Meeting notes',
      onLaunch: vi.fn()
    });
    expect(getByText('Meeting notes')).toBeTruthy();
    expect(getByText('Pad')).toBeTruthy();
  });
});
