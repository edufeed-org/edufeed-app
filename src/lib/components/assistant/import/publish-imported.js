/**
 * Publishes ticked import rows one by one (a NIP-46 signer asks per event, and
 * parallel prompts would pile up). Each row keeps its stable `dTag`, so a retry
 * replaces instead of duplicating.
 */

/**
 * The Termi window's import message state (`{ role: 'bot', import }`).
 * @typedef {{
 *   source: string, size: string,
 *   status: 'consent'|'extracting'|'preview'|'publishing'|'done'|'failed',
 *   events?: import('$lib/helpers/calendar-import/events.js').ImportEvent[],
 *   selected?: Set<string>, already?: Set<string>,
 *   withDescriptions: boolean, truncated?: boolean, tz?: string, done: number,
 *   quota?: 'user' | 'global',
 *   result?: { ok: string[], failed: { key: string, error: string }[] }
 * }} ImportState
 */

/**
 * @param {import('$lib/helpers/calendar-import/events.js').ImportEvent[]} events
 * @param {{
 *   createEvent: (formData: any, communityPubkeys: string[], communityEvent: null, options: { dTag?: string, awaitPublish: boolean }) => Promise<unknown>,
 *   withDescriptions: boolean,
 *   tz: string,
 *   onProgress?: (done: number) => void
 * }} opts
 * @returns {Promise<{ ok: string[], failed: { key: string, error: string }[] }>}
 */
export async function publishImportedEvents(
  events,
  { createEvent, withDescriptions, tz, onProgress }
) {
  /** @type {string[]} */
  const ok = [];
  /** @type {{ key: string, error: string }[]} */
  const failed = [];
  for (const e of events) {
    const formData = {
      title: e.title,
      summary: withDescriptions ? (e.description ?? '') : '',
      startDate: e.startDate,
      startTime: e.startTime ?? '',
      endDate: e.endDate,
      endTime: e.endTime ?? '',
      startTimezone: tz,
      endTimezone: tz,
      location: e.location ?? '',
      isAllDay: e.allDay,
      eventType: e.allDay ? 'date' : 'time',
      image: ''
    };
    try {
      await createEvent(formData, [], null, { dTag: e.dTag, awaitPublish: true });
      ok.push(e.key);
    } catch (err) {
      failed.push({ key: e.key, error: err instanceof Error ? err.message : String(err) });
    }
    onProgress?.(ok.length + failed.length);
  }
  return { ok, failed };
}
