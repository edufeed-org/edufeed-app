/**
 * followStartDate — where the event dialog's end date goes when the user
 * moves the start date (GitHub #9: a new event ends the day it starts, and
 * the end tags along with the start until the user picks an end themselves).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { followStartDate } from '$lib/helpers/event-form-dates.js';

describe('followStartDate — end date not edited by the user', () => {
  it('moves a same-day end along with the start', () => {
    expect(
      followStartDate({
        previousStart: '2026-10-05',
        nextStart: '2026-10-08',
        endDate: '2026-10-05',
        endEdited: false
      })
    ).toBe('2026-10-08');
  });

  it('keeps the day offset between start and end', () => {
    expect(
      followStartDate({
        previousStart: '2026-10-05',
        nextStart: '2026-10-30',
        endDate: '2026-10-07',
        endEdited: false
      })
    ).toBe('2026-11-01');
  });

  it('moves backwards too', () => {
    expect(
      followStartDate({
        previousStart: '2026-10-05',
        nextStart: '2026-10-01',
        endDate: '2026-10-05',
        endEdited: false
      })
    ).toBe('2026-10-01');
  });

  it('is not thrown off by a DST change in between', () => {
    expect(
      followStartDate({
        previousStart: '2026-10-20',
        nextStart: '2026-10-26',
        endDate: '2026-10-21',
        endEdited: false
      })
    ).toBe('2026-10-27');
  });

  it('fills an empty end with the start', () => {
    expect(
      followStartDate({
        previousStart: '',
        nextStart: '2026-10-08',
        endDate: '',
        endEdited: false
      })
    ).toBe('2026-10-08');
  });

  it('falls back to the start when the previous start is unknown', () => {
    expect(
      followStartDate({
        previousStart: '',
        nextStart: '2026-10-08',
        endDate: '2026-10-05',
        endEdited: false
      })
    ).toBe('2026-10-08');
  });
});

describe('followStartDate — end date edited by the user', () => {
  it('leaves an end on or after the new start alone', () => {
    expect(
      followStartDate({
        previousStart: '2026-10-05',
        nextStart: '2026-10-06',
        endDate: '2026-10-10',
        endEdited: true
      })
    ).toBe('2026-10-10');
    expect(
      followStartDate({
        previousStart: '2026-10-05',
        nextStart: '2026-10-10',
        endDate: '2026-10-10',
        endEdited: true
      })
    ).toBe('2026-10-10');
  });

  it('pulls the end up to the start so it never lies before it', () => {
    expect(
      followStartDate({
        previousStart: '2026-10-05',
        nextStart: '2026-10-12',
        endDate: '2026-10-10',
        endEdited: true
      })
    ).toBe('2026-10-12');
  });

  it('leaves an intentionally empty end empty', () => {
    expect(
      followStartDate({
        previousStart: '2026-10-05',
        nextStart: '2026-10-12',
        endDate: '',
        endEdited: true
      })
    ).toBe('');
  });
});

describe('followStartDate — incomplete start input', () => {
  it('keeps the end while the start is not a valid date (mid-typing)', () => {
    expect(
      followStartDate({
        previousStart: '2026-10-05',
        nextStart: '',
        endDate: '2026-10-05',
        endEdited: false
      })
    ).toBe('2026-10-05');
    expect(
      followStartDate({
        previousStart: '2026-10-05',
        nextStart: '2026-13-45',
        endDate: '2026-10-07',
        endEdited: true
      })
    ).toBe('2026-10-07');
  });
});
