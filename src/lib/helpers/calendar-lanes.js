/**
 * Week-lane layout for spanning multi-day event bars (Google-Calendar style).
 *
 * A month/week grid renders one bar per multi-day event per week row,
 * spanning the covered day columns. Overlapping bars stack into lanes; a bar
 * keeps its lane across its whole span, and days where only higher lanes are
 * occupied carry explicit empty slots so bars stay vertically aligned.
 */

import { getEventDaySpan } from '$lib/helpers/calendar.js';

const SECONDS_PER_DAY = 86400;

/**
 * @typedef {Object} LaneSegment
 * @property {any} event
 * @property {number} lane
 * @property {boolean} continuesLeft - span continues before this day (arrow cap)
 * @property {boolean} continuesRight - span continues after this day (arrow cap)
 * @property {boolean} clippedLeft - the span started before this week (chevron cap on the first piece)
 * @property {boolean} clippedRight - the span ends after this week (chevron cap on the last piece)
 * @property {boolean} showTitle - render the title on this day (first visible day of the week span)
 */

/**
 * @param {any} event
 * @returns {boolean} true when the event covers more than one UTC day
 */
export function isMultiDayEvent(event) {
  if (!event?.start) return false;
  const { startDay, endDay } = getEventDaySpan(event);
  return endDay > startDay;
}

/**
 * @param {string} dateKey - YYYY-MM-DD (UTC)
 * @returns {number} integer UTC day index
 */
function dayIndexFromKey(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 1000 / SECONDS_PER_DAY);
}

/**
 * Lay out multi-day events over one week row.
 *
 * @param {string[]} weekDayKeys - the week's 7 date keys (YYYY-MM-DD, UTC)
 * @param {any[]} events - multi-day events (deduplicated) to consider
 * @returns {{laneCount: number, cells: Map<string, Array<LaneSegment | null>>}}
 *   cells: per date key, an array indexed by lane (null = empty spacer slot).
 *   Every array has laneCount entries.
 */
export function layoutWeekLanes(weekDayKeys, events) {
  const weekStart = dayIndexFromKey(weekDayKeys[0]);
  const weekEnd = dayIndexFromKey(weekDayKeys[weekDayKeys.length - 1]);

  // Clip each event to the week; drop non-overlapping ones.
  const segments = [];
  for (const event of events) {
    if (!event?.start) continue;
    const { startDay, endDay } = getEventDaySpan(event);
    if (endDay < startDay || endDay < weekStart || startDay > weekEnd) continue;
    segments.push({
      event,
      startDay,
      endDay,
      segStart: Math.max(startDay, weekStart),
      segEnd: Math.min(endDay, weekEnd)
    });
  }

  // Earlier starts first; ties broken by longer span, then id for stability.
  segments.sort(
    (a, b) =>
      a.startDay - b.startDay ||
      b.endDay - b.startDay - (a.endDay - a.startDay) ||
      String(a.event.id).localeCompare(String(b.event.id))
  );

  // Greedy lane assignment: first lane free over the segment's day range.
  /** @type {number[][]} laneOccupancy[lane] = list of occupied day indices */
  const laneEnds = []; // per lane: array of [segStart, segEnd] ranges
  for (const seg of segments) {
    let lane = 0;
    for (; lane < laneEnds.length; lane++) {
      const clashes = laneEnds[lane].some(([s, e]) => seg.segStart <= e && seg.segEnd >= s);
      if (!clashes) break;
    }
    if (lane === laneEnds.length) laneEnds.push([]);
    laneEnds[lane].push([seg.segStart, seg.segEnd]);
    seg.lane = lane;
  }

  const laneCount = laneEnds.length;
  /** @type {Map<string, Array<LaneSegment | null>>} */
  const cells = new Map(weekDayKeys.map((key) => [key, Array(laneCount).fill(null)]));

  for (const seg of segments) {
    for (let day = seg.segStart; day <= seg.segEnd; day++) {
      const key = weekDayKeys[day - weekStart];
      const slots = cells.get(key);
      if (!slots) continue;
      slots[seg.lane] = {
        event: seg.event,
        lane: seg.lane,
        continuesLeft: day > seg.startDay,
        continuesRight: day < seg.endDay,
        clippedLeft: day === seg.segStart && seg.startDay < seg.segStart,
        clippedRight: day === seg.segEnd && seg.endDay > seg.segEnd,
        showTitle: day === seg.segStart
      };
    }
  }

  return { laneCount, cells };
}
