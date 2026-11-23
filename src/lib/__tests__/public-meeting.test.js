// @ts-nocheck -- mocks with loose shapes
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { isPubliclyListed, publicCopyDTag, syncPublicCopy } from '$lib/groups/public-meeting.js';

const meeting = {
  kind: 31923,
  tags: [
    ['d', 'meeting-1'],
    ['h', 'chan'],
    ['listed', 'public']
  ]
};
const formData = {
  title: 'Planung',
  summary: 'x',
  attributes: { price: '5' },
  location: 'ignored'
};
const URL = 'https://app.example/groups/x';

function deps(existing = null) {
  return {
    findCopy: vi.fn(async () => existing),
    createEvent: vi.fn(async () => ({ id: 'new' })),
    updateEvent: vi.fn(async () => ({ id: 'upd' })),
    deleteEvent: vi.fn(async () => ({ success: true }))
  };
}
const run = (want, d) => syncPublicCopy({ want, meeting, formData, channelUrl: URL, ...d });

describe('public calendar entry of a channel meeting', () => {
  it('reads the marker and derives a d-tag that differs from the meeting', () => {
    expect(isPubliclyListed(meeting)).toBe(true);
    expect(
      isPubliclyListed({
        tags: [
          ['d', 'meeting-1'],
          ['h', 'chan']
        ]
      })
    ).toBe(false);
    expect(isPubliclyListed(null)).toBe(false);
    expect(publicCopyDTag(meeting)).toBe('public-meeting-1');
  });

  it('creates the entry with the channel as location, no communities and no attributes', async () => {
    const d = deps();
    expect(await run(true, d)).toBe('created');
    expect(d.findCopy).toHaveBeenCalledWith('public-meeting-1');
    const [form, communities, , options] = d.createEvent.mock.calls[0];
    expect(form).toMatchObject({
      title: 'Planung',
      location: URL,
      eventType: 'time',
      isAllDay: false
    });
    expect(form.attributes).toBeUndefined();
    expect(communities).toEqual([]);
    expect(options).toEqual({ dTag: 'public-meeting-1', awaitPublish: true });
  });

  it('updates an entry that exists', async () => {
    const copy = { id: 'old' };
    const d = deps(copy);
    expect(await run(true, d)).toBe('updated');
    expect(d.updateEvent.mock.calls[0][1]).toBe(copy);
    expect(d.createEvent).not.toHaveBeenCalled();
  });

  it('removes the entry when listing is switched off, and does nothing when there is none', async () => {
    const copy = { id: 'old' };
    const d = deps(copy);
    expect(await run(false, d)).toBe('removed');
    expect(d.deleteEvent).toHaveBeenCalledWith(copy);
    const none = deps();
    expect(await run(false, none)).toBe('none');
    expect(none.deleteEvent).not.toHaveBeenCalled();
  });

  it('throws when the entry could not be removed, so the caller can say so', async () => {
    const d = deps({ id: 'old' });
    d.deleteEvent.mockResolvedValue({ success: false, error: 'relay said no' });
    await expect(run(false, d)).rejects.toThrow('relay said no');
  });
});
