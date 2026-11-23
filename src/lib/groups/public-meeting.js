// A channel meeting that is ALSO listed on the public calendar (issue
// wc9uqsc0). Offered in open channels only: there the meeting is readable by
// anyone anyway, so a public calendar entry discloses nothing new.
//
// The meeting itself stays what it is (kind 31923, one `h` tag, group relay
// only, dropped from every generic calendar by isChannelMeeting). Listing adds
// a SECOND event: an ordinary public kind 31923 by the same author, with no
// `h` tag, the channel link as its location and the d-tag `public-<meeting d>`.
// A different d-tag on purpose: with the same one the two would be one
// replaceable event and the public copy would replace the meeting in every
// store. The meeting carries `["listed", "public"]` so an edit or delete knows
// there is a copy to keep in step, without asking a relay first.
//
// Plain module (no runes), tested in node.

/** @param {{tags?: string[][]} | null | undefined} event */
function dTagOf(event) {
  return event?.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
}

/** Whether a channel meeting says it has a public calendar entry. */
/** @param {{tags?: string[][]} | null | undefined} event */
export function isPubliclyListed(event) {
  return (event?.tags ?? []).some((t) => t[0] === 'listed' && t[1] === 'public');
}

/** The d-tag of a meeting's public calendar entry. */
/** @param {{tags?: string[][]}} meeting */
export function publicCopyDTag(meeting) {
  return `public-${dTagOf(meeting)}`;
}

/**
 * Create, update or remove the public calendar entry so it matches `want`.
 * Runs AFTER the meeting itself was published; the caller treats a throw as
 * "meeting saved, public entry failed" and never undoes the meeting.
 *
 * @param {{
 *   want: boolean,
 *   meeting: {tags: string[][]},
 *   formData: import('../types/calendar.js').EventFormData,
 *   channelUrl: string,
 *   findCopy: (dTag: string) => Promise<any | null>,
 *   createEvent: (formData: any, communities: string[], community: null, options: {dTag: string, awaitPublish: boolean}) => Promise<any>,
 *   updateEvent: (formData: any, existing: any) => Promise<any>,
 *   deleteEvent: (existing: any) => Promise<{success: boolean, error?: string}>
 * }} p
 * @returns {Promise<'created' | 'updated' | 'removed' | 'none'>}
 */
export async function syncPublicCopy({
  want,
  meeting,
  formData,
  channelUrl,
  findCopy,
  createEvent,
  updateEvent,
  deleteEvent
}) {
  const dTag = publicCopyDTag(meeting);
  const existing = await findCopy(dTag);
  if (!want) {
    if (!existing) return 'none';
    const result = await deleteEvent(existing);
    if (!result.success) throw new Error(result.error || 'public calendar entry not removed');
    return 'removed';
  }
  // Never the educational attributes or communities of a generic event, and
  // always the channel as the place to go.
  const form = {
    ...formData,
    eventType: 'time',
    isAllDay: false,
    attributes: undefined,
    location: channelUrl
  };
  if (existing) {
    await updateEvent(form, existing);
    return 'updated';
  }
  await createEvent(form, [], null, { dTag, awaitPublish: true });
  return 'created';
}
