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

  it('a part never saved: "fehlt" and a hint that it is left out; the saved ones can still go out', () => {
    const s = state();
    s.parts.lessons.push({ n: 2, title: 'Stunde 2' });
    render(LessonPublishModal, { lessonState: s, record: vi.fn(), onClose: vi.fn() });
    expect(screen.getByText('fehlt')).toBeTruthy();
    expect(screen.getByTestId('lesson-publish-missing-hint').textContent).toContain(
      'nicht veröffentlicht'
    );
    expect(screen.getByTestId('lesson-publish-submit').disabled).toBe(false);
  });

  it('nothing saved: publishing is disabled', () => {
    const s = state();
    s.parts = { lessons: [{ n: 1, title: 'Stunde 1' }] };
    render(LessonPublishModal, { lessonState: s, record: vi.fn(), onClose: vi.fn() });
    expect(screen.getByTestId('lesson-publish-submit').disabled).toBe(true);
  });

  it('done when every saved part is out, even with a missing one', () => {
    const s = state({ publication: naddr(30040, 'series'), resource: naddr(30142, 'r') });
    s.parts.overview.naddr = naddr(30023, 'o');
    s.parts.lessons[0].naddr = naddr(30023, 'l1');
    s.parts.lessons.push({ n: 2, title: 'Stunde 2' });
    render(LessonPublishModal, { lessonState: s, record: vi.fn(), onClose: vi.fn() });
    expect(screen.getByTestId('lesson-publish-done')).toBeTruthy();
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

  describe('parts only written in the chat', () => {
    const KINDS = [
      ['overview'],
      ...[1, 2, 3, 4, 5, 6].map((n) => ['lesson', n]),
      ['worksheets'],
      ['summary'],
      ['module'],
      ['sources']
    ];
    const keyOf = ([kind, n]) => (kind === 'lesson' ? `lesson-${n}` : kind);
    // overview + lessons in one answer each, phase 6's four parts in one answer
    const turnParts = KINDS.map(([kind, n], i) => ({
      turnId: i < 7 ? `t${i}` : 't-phase6',
      part: { kind, ...(n ? { n } : {}), title: `Titel ${keyOf([kind, n])}`, text: '# x' }
    }));
    const bare = () => ({ phase: 7, frame: {}, competences: [], didactics: {}, plan: [] });

    it('no parts in the state: all 11 listed as "fehlt", the series row too, save-first is the primary action', () => {
      render(LessonPublishModal, {
        lessonState: bare(),
        turnParts,
        saveParts: vi.fn(),
        record: vi.fn(),
        onClose: vi.fn()
      });
      expect(keys()).toEqual(KINDS.map(keyOf));
      expect(screen.getAllByText('fehlt')).toHaveLength(11);
      expect(screen.getByText('Reihe (Inhaltsverzeichnis)')).toBeTruthy();
      const save = screen.getByTestId('lesson-publish-save-missing');
      expect(save.textContent).toContain('Erst speichern, dann veröffentlichen');
      expect(save.className).toContain('btn-primary');
      expect(screen.queryByTestId('lesson-publish-submit')).toBeNull();
    });

    it('saves every missing part in reading order, one turn per call; then publishing is enabled', async () => {
      const saved = [];
      const saveParts = vi.fn(async (turnId, parts, onStart) => {
        for (const p of parts) {
          onStart(keyOf([p.kind, p.n]));
          saved.push(keyOf([p.kind, p.n]));
        }
      });
      const view = render(LessonPublishModal, {
        lessonState: bare(),
        turnParts,
        saveParts,
        record: vi.fn(),
        onClose: vi.fn()
      });
      await fireEvent.click(screen.getByTestId('lesson-publish-save-missing'));
      await waitFor(() => expect(saved).toHaveLength(11));
      expect(saved).toEqual(KINDS.map(keyOf));
      expect(saveParts.mock.calls.map((c) => c[0])).toEqual([
        't0',
        't1',
        't2',
        't3',
        't4',
        't5',
        't6',
        't-phase6'
      ]);
      // the wraps reach the modal through its props (recordPartWrap → the state)
      await view.rerender({
        draftWraps: Object.fromEntries(saved.map((k) => [k, naddr(31234, k)]))
      });
      expect(screen.queryAllByText('fehlt')).toHaveLength(0);
      expect(screen.queryByTestId('lesson-publish-save-missing')).toBeNull();
      expect(screen.getByTestId('lesson-publish-submit').disabled).toBe(false);
    });

    it('a part that already has a wrap is not saved again; publishing stays possible', async () => {
      const saveParts = vi.fn(async () => {});
      render(LessonPublishModal, {
        lessonState: state(),
        turnParts: turnParts.slice(0, 3),
        saveParts,
        record: vi.fn(),
        onClose: vi.fn()
      });
      expect(keys()).toEqual(['overview', 'lesson-1', 'lesson-2']);
      const save = screen.getByTestId('lesson-publish-save-missing');
      expect(save.textContent).toContain('Fehlende Teile speichern');
      expect(screen.getByTestId('lesson-publish-submit').disabled).toBe(false);
      await fireEvent.click(save);
      await waitFor(() => expect(saveParts).toHaveBeenCalledTimes(1));
      expect(saveParts.mock.calls[0][0]).toBe('t2');
      expect(saveParts.mock.calls[0][1].map((p) => p.n)).toEqual([2]);
    });
  });
});
