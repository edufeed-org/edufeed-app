// @ts-nocheck
/**
 * LessonPublishModal — phase 7 of the lesson series: parts ✓/○/"fehlt",
 * licence and "Als Lernressource auffindbar machen", progress, a partial
 * failure offers "Fehlende veröffentlichen", a success the share sheet.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const h = vi.hoisted(() => ({ publish: vi.fn(), openModal: vi.fn() }));
vi.mock('$lib/stores/lesson-publish.svelte.js', () => ({
  LICENCES: {
    'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
    'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/'
  },
  defaultLicence: (_s, text) => (/BY-SA/.test(text) ? 'CC BY-SA 4.0' : 'CC BY 4.0'),
  seriesTitle: () => 'Mathematik: Brüche, Klasse 4',
  publishLessonSeries: h.publish
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal: h.openModal } }));
vi.mock('$app/paths', () => ({
  resolve: (path, params) => (params?.naddr ? `/${params.naddr}` : path)
}));

import LessonPublishModal from '../assistant/LessonPublishModal.svelte';

const PK = 'a'.repeat(64);
const naddr = (kind, d) => nip19.naddrEncode({ kind, pubkey: PK, identifier: d });
const state = (extra = {}) => ({
  phase: 7,
  frame: {},
  competences: [],
  didactics: {},
  plan: [],
  parts: {
    overview: { wrap: naddr(31234, 'o') },
    lessons: [{ n: 1, title: 'Stunde 1', wrap: naddr(31234, 'l1') }]
  },
  ...extra
});

beforeEach(() => {
  h.publish.mockReset();
  h.openModal.mockReset();
});
afterEach(() => cleanup());

const keys = () => screen.getAllByTestId('lesson-publish-part').map((li) => li.dataset.key);

describe('LessonPublishModal', () => {
  it('lists the parts in order; BY-SA in the sources proposes CC BY-SA; resource on by default', () => {
    render(LessonPublishModal, {
      lessonState: state(),
      draftWraps: { summary: naddr(31234, 's') },
      sourcesText: 'Grafik: CC BY-SA 4.0',
      record: vi.fn(),
      onClose: vi.fn()
    });
    expect(keys()).toEqual(['overview', 'lesson-1', 'summary']);
    expect(screen.getByTestId('lesson-publish-licence').value).toBe('CC BY-SA 4.0');
    expect(screen.getByTestId('lesson-publish-resource').checked).toBe(true);
    expect(screen.getByTestId('lesson-publish-submit').textContent).toContain('Veröffentlichen');
  });

  it('a part never saved: "fehlt", a hint, and publishing is disabled', () => {
    const s = state();
    s.parts.lessons.push({ n: 2, title: 'Stunde 2' });
    render(LessonPublishModal, { lessonState: s, record: vi.fn(), onClose: vi.fn() });
    expect(screen.getByText('fehlt')).toBeTruthy();
    expect(screen.getByTestId('lesson-publish-missing-hint')).toBeTruthy();
    expect(screen.getByTestId('lesson-publish-submit').disabled).toBe(true);
  });

  it('publishes with her choices; a failure offers "Fehlende veröffentlichen"', async () => {
    h.publish.mockRejectedValue(new Error('publish_failed:lesson-1'));
    const record = vi.fn();
    render(LessonPublishModal, { lessonState: state(), record, onClose: vi.fn() });
    await fireEvent.click(screen.getByTestId('lesson-publish-resource'));
    await fireEvent.click(screen.getByTestId('lesson-publish-submit'));
    await waitFor(() => expect(screen.getByTestId('lesson-publish-failed')).toBeTruthy());
    const [, opts] = h.publish.mock.calls[0];
    expect(opts).toMatchObject({ asResource: false, licence: 'CC BY 4.0', record });
    expect(screen.getByTestId('lesson-publish-submit').textContent).toContain(
      'Fehlende veröffentlichen'
    );
  });

  it('all out: the success line and the share sheet for the 30040', async () => {
    const pub = naddr(30040, 'series');
    const s = state({ publication: pub, resource: naddr(30142, 'r') });
    s.parts.overview.naddr = naddr(30023, 'o');
    s.parts.lessons[0].naddr = naddr(30023, 'l1');
    const onClose = vi.fn();
    render(LessonPublishModal, { lessonState: s, record: vi.fn(), onClose });
    expect(screen.getByTestId('lesson-publish-done').textContent).toContain('Veröffentlicht');
    expect(screen.queryByTestId('lesson-publish-submit')).toBeNull();
    await fireEvent.click(screen.getByTestId('lesson-publish-share'));
    expect(h.openModal).toHaveBeenCalledWith('shareByNaddr', {
      naddr: pub,
      allowedKinds: [30040]
    });
    expect(onClose).toHaveBeenCalled();
  });
});
