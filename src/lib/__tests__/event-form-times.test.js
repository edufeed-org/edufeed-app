/**
 * followStartTime — where the event dialog's end time (and, past midnight,
 * end date) goes when the user moves the start time of a timed event.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { followStartTime } from '$lib/helpers/event-form-dates.js';

const base = {
  startDate: '2026-10-07',
  endDate: '2026-10-07',
  previousStartTime: '14:30',
  endTime: '15:30'
};

describe('followStartTime — end not edited by the user', () => {
  it('keeps the duration when the start moves later', () => {
    expect(followStartTime({ ...base, nextStartTime: '16:00', endEdited: false })).toEqual({
      endDate: '2026-10-07',
      endTime: '17:00'
    });
  });

  it('keeps the duration when the start moves earlier', () => {
    expect(followStartTime({ ...base, nextStartTime: '09:15', endEdited: false })).toEqual({
      endDate: '2026-10-07',
      endTime: '10:15'
    });
  });

  it('rolls the end date past midnight', () => {
    expect(followStartTime({ ...base, nextStartTime: '23:30', endEdited: false })).toEqual({
      endDate: '2026-10-08',
      endTime: '00:30'
    });
  });

  it('brings a rolled end date back when the start moves back before midnight', () => {
    expect(
      followStartTime({
        startDate: '2026-10-07',
        endDate: '2026-10-08',
        previousStartTime: '23:30',
        endTime: '00:30',
        nextStartTime: '10:00',
        endEdited: false
      })
    ).toEqual({ endDate: '2026-10-07', endTime: '11:00' });
  });

  it('keeps a multi-day duration', () => {
    expect(
      followStartTime({
        ...base,
        endDate: '2026-10-09',
        nextStartTime: '16:00',
        endEdited: false
      })
    ).toEqual({ endDate: '2026-10-09', endTime: '17:00' });
  });

  it('falls back to one hour when the previous end was not after the start', () => {
    expect(
      followStartTime({ ...base, endTime: '14:00', nextStartTime: '16:00', endEdited: false })
    ).toEqual({ endDate: '2026-10-07', endTime: '17:00' });
  });

  it('crosses month and year boundaries', () => {
    expect(
      followStartTime({
        startDate: '2026-12-31',
        endDate: '2026-12-31',
        previousStartTime: '20:00',
        endTime: '22:00',
        nextStartTime: '23:00',
        endEdited: false
      })
    ).toEqual({ endDate: '2027-01-01', endTime: '01:00' });
  });
});

describe('followStartTime — end edited by the user', () => {
  it('leaves the end alone while the start stays before it', () => {
    expect(followStartTime({ ...base, nextStartTime: '15:00', endEdited: true })).toEqual({
      endDate: '2026-10-07',
      endTime: '15:30'
    });
  });

  it('pushes the end to start + previous duration when the start reaches it', () => {
    expect(followStartTime({ ...base, nextStartTime: '16:00', endEdited: true })).toEqual({
      endDate: '2026-10-07',
      endTime: '17:00'
    });
  });

  it('pushes the end when the start equals it', () => {
    expect(followStartTime({ ...base, nextStartTime: '15:30', endEdited: true })).toEqual({
      endDate: '2026-10-07',
      endTime: '16:30'
    });
  });

  it('pushes by one hour when the previous duration was not positive', () => {
    expect(
      followStartTime({ ...base, endTime: '14:00', nextStartTime: '14:15', endEdited: true })
    ).toEqual({ endDate: '2026-10-07', endTime: '15:15' });
  });

  it('rolls the pushed end past midnight', () => {
    expect(followStartTime({ ...base, nextStartTime: '23:45', endEdited: true })).toEqual({
      endDate: '2026-10-08',
      endTime: '00:45'
    });
  });

  it('leaves a later end day alone', () => {
    expect(
      followStartTime({ ...base, endDate: '2026-10-08', nextStartTime: '20:00', endEdited: true })
    ).toEqual({ endDate: '2026-10-08', endTime: '15:30' });
  });
});

describe('followStartTime — incomplete input', () => {
  it('keeps the end while the new start time is not valid (mid-typing)', () => {
    expect(followStartTime({ ...base, nextStartTime: '', endEdited: false })).toEqual({
      endDate: '2026-10-07',
      endTime: '15:30'
    });
  });

  it('keeps an empty end date empty (the event has no end) but moves the time', () => {
    expect(
      followStartTime({ ...base, endDate: '', nextStartTime: '16:00', endEdited: false })
    ).toEqual({ endDate: '', endTime: '17:00' });
  });

  it('moves only the time when the start date is not a valid day', () => {
    expect(
      followStartTime({ ...base, startDate: '', nextStartTime: '23:30', endEdited: false })
    ).toEqual({ endDate: '2026-10-07', endTime: '00:30' });
  });

  it('uses one hour when there is no previous start time', () => {
    expect(
      followStartTime({ ...base, previousStartTime: '', nextStartTime: '16:00', endEdited: false })
    ).toEqual({ endDate: '2026-10-07', endTime: '17:00' });
  });
});
