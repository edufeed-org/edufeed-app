/**
 * validateEventForm — the event dialog's submit check speaks the UI language.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { validateEventForm } from '$lib/helpers/calendar.js';
import * as m from '$lib/paraglide/messages';

const valid = {
  title: 'Treffen',
  startDate: '2026-10-07',
  startTime: '14:30',
  endDate: '2026-10-07',
  endTime: '15:30',
  eventType: 'time'
};

describe('validateEventForm', () => {
  it('accepts a valid timed event', () => {
    expect(validateEventForm(/** @type {any} */ (valid))).toEqual([]);
  });

  it('reports a missing title, start date and start time with localized messages', () => {
    const errors = validateEventForm(
      /** @type {any} */ ({ ...valid, title: ' ', startDate: '', startTime: '', endDate: '' })
    );
    expect(errors).toEqual([
      m.event_modal_error_title_required(),
      m.event_modal_error_start_date_required(),
      m.event_modal_error_start_time_required()
    ]);
  });

  it('reports an end date before the start date', () => {
    expect(validateEventForm(/** @type {any} */ ({ ...valid, endDate: '2026-10-06' }))).toEqual([
      m.event_modal_error_end_date_before_start()
    ]);
  });

  it('reports a same-day end time not after the start time', () => {
    expect(validateEventForm(/** @type {any} */ ({ ...valid, endTime: '14:30' }))).toEqual([
      m.event_modal_error_end_time_before_start()
    ]);
  });

  it('never returns the old hardcoded English strings', () => {
    const errors = validateEventForm(
      /** @type {any} */ ({ ...valid, title: '', endDate: '2026-10-07', endTime: '13:00' })
    );
    expect(errors.join(' ')).not.toMatch(/Event title is required$|same-day events/);
    expect(errors).toHaveLength(2);
  });
});
