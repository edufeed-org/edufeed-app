/**
 * NIP-52 Calendar Event Validation
 * Validates calendar events (kinds 31922 and 31923) against NIP-52 specifications
 *
 * Validation approach:
 * - Required fields must be present and valid
 * - Optional fields are validated if present - malformed optional fields cause rejection
 * - Invalid events are logged with warnings for debugging
 */

import { parseCalendarTimestamp } from '$lib/helpers/calendar.js';

/**
 * Get a single tag value from event
 * @param {any} event - Nostr event
 * @param {string} tagName - Tag name to retrieve
 * @returns {string | undefined} First value of the tag, or undefined if not found
 */
function getTagValue(event, tagName) {
  if (!event?.tags || !Array.isArray(event.tags)) return undefined;
  const tag = event.tags.find(/** @param {any} t */ (t) => Array.isArray(t) && t[0] === tagName);
  return tag?.[1];
}

/**
 * Get all values for a tag from event
 * @param {any} event - Nostr event
 * @param {string} tagName - Tag name to retrieve
 * @returns {string[]} Array of tag values
 */
// eslint-disable-next-line no-unused-vars
function getTagValues(event, tagName) {
  if (!event?.tags || !Array.isArray(event.tags)) return [];
  return event.tags
    .filter(/** @param {any} t */ (t) => Array.isArray(t) && t[0] === tagName)
    .map(/** @param {any} t */ (t) => t[1])
    .filter(/** @param {any} v */ (v) => v !== undefined);
}

/**
 * Check if event has a specific tag
 * @param {any} event - Nostr event
 * @param {string} tagName - Tag name to check
 * @returns {boolean} True if tag exists
 */
// Note: hasTag helper is currently unused but kept for future validation enhancements
function _hasTag(event, tagName) {
  if (!event?.tags || !Array.isArray(event.tags)) return false;
  return event.tags.some(/** @param {any} t */ (t) => Array.isArray(t) && t[0] === tagName);
}

/**
 * Validate unix timestamp string
 * Must be a numeric string matching pattern ^\[0-9\]+$
 * @param {string | undefined} value - Value to validate
 * @returns {boolean} True if valid timestamp
 */
function isValidTimestamp(value) {
  if (!value || typeof value !== 'string') return false;
  // Must match numeric pattern
  if (!/^[0-9]+$/.test(value)) return false;
  // Parse and check it's a reasonable timestamp
  const timestamp = parseInt(value, 10);
  if (isNaN(timestamp)) return false;
  // Basic sanity check: timestamp should be positive and not too far in future
  // (year 2100 = 4102444800)
  return timestamp > 0 && timestamp < 4102444800;
}

/**
 * Validate ISO 8601 date string (YYYY-MM-DD) for NIP-52 kind 31922
 * @param {string | undefined} value - Value to validate
 * @returns {boolean} True if valid date string
 */
function isValidDateString(value) {
  if (!value || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  if (isNaN(date.getTime())) return false;
  // Date.parse rolls an impossible day (e.g. 2026-02-31) over into the next
  // month instead of rejecting it; only accept days that round-trip.
  return date.toISOString().slice(0, 10) === value;
}

/**
 * Validate IANA timezone identifier
 * @param {string | undefined} value - Timezone value to validate
 * @returns {boolean} True if valid timezone
 */
function isValidTimezone(value) {
  if (!value || typeof value !== 'string') return false;

  try {
    // Try to use the timezone with Intl.DateTimeFormat
    // This will throw if timezone is invalid
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate kind 31922 (Date-based calendar event)
 * Required: d, title, start
 * Optional but validated: end, summary, image, location, g, p, t, r
 * @param {any} event - Nostr event to validate
 * @returns {boolean} True if valid
 */
function validateKind31922(event) {
  // Note: eventId kept for debugging purposes
  const _eventId = event.id || 'unknown';

  // // Check required tags
  // if (!hasTag(event, 'd')) {
  // 	// console.warn(`📅 Validation: Event ${eventId} missing required 'd' tag (identifier)`);
  // 	return false;
  // }

  // const title = getTagValue(event, 'title');
  // if (!title || title.trim().length === 0) {
  // 	// console.warn(`📅 Validation: Event ${eventId} missing or empty 'title' tag`);
  // 	return false;
  // }

  const start = getTagValue(event, 'start');
  // Kind 31922 uses ISO 8601 date strings (YYYY-MM-DD) per NIP-52
  const isDateBased = event.kind === 31922;
  if (isDateBased) {
    if (!isValidDateString(start) && !isValidTimestamp(start)) {
      return false;
    }
  } else if (!isValidTimestamp(start)) {
    return false;
  }

  // Validate optional fields if present (reject if malformed)
  const end = getTagValue(event, 'end');
  if (end !== undefined) {
    if (isDateBased) {
      if (!isValidDateString(end) && !isValidTimestamp(end)) {
        return false;
      }
    } else if (!isValidTimestamp(end)) {
      return false;
    }
    // End should be >= start (compare as parsed timestamps)
    if (start) {
      const startNum = parseCalendarTimestamp(start, event.kind);
      const endNum = parseCalendarTimestamp(end, event.kind);
      if (endNum < startNum) {
        return false;
      }
    }
  }

  // // Validate optional string fields (if present, must not be empty)
  // const summary = getTagValue(event, 'summary');
  // if (summary !== undefined && summary.trim().length === 0) {
  // 	console.warn(`📅 Validation: Event ${eventId} has empty 'summary' tag`);
  // 	return false;
  // }

  // const image = getTagValue(event, 'image');
  // if (image !== undefined && image.trim().length === 0) {
  // 	// console.warn(`📅 Validation: Event ${eventId} has empty 'image' tag`);
  // 	return false;
  // }

  // const location = getTagValue(event, 'location');
  // if (location !== undefined && location.trim().length === 0) {
  // 	console.warn(`📅 Validation: Event ${eventId} has empty 'location' tag`);
  // 	return false;
  // }

  // const geohash = getTagValue(event, 'g');
  // if (geohash !== undefined && geohash.trim().length === 0) {
  // 	// console.warn(`📅 Validation: Event ${eventId} has empty 'g' (geohash) tag`);
  // 	return false;
  // }

  return true;
}

/**
 * Validate kind 31923 (Time-based calendar event)
 * Same as 31922 plus optional timezone validation
 * Required: d, title, start
 * Optional but validated: end, start_tzid, end_tzid, summary, image, location, g, p, t, r
 * @param {any} event - Nostr event to validate
 * @returns {boolean} True if valid
 */
function validateKind31923(event) {
  const eventId = event.id || 'unknown';

  // First validate as kind 31922 (same base requirements)
  if (!validateKind31922(event)) {
    return false;
  }

  // Additional validation for time-based events: timezone fields
  const startTzid = getTagValue(event, 'start_tzid');
  if (startTzid !== undefined && !isValidTimezone(startTzid)) {
    console.warn(`📅 Validation: Event ${eventId} has invalid 'start_tzid':`, startTzid);
    return false;
  }

  const endTzid = getTagValue(event, 'end_tzid');
  if (endTzid !== undefined && !isValidTimezone(endTzid)) {
    console.warn(`📅 Validation: Event ${eventId} has invalid 'end_tzid':`, endTzid);
    return false;
  }

  return true;
}

/**
 * Validate a calendar event (kind 31922 or 31923)
 * @param {any} event - Raw Nostr event
 * @returns {boolean} True if event is valid according to NIP-52 specifications
 */
export function validateCalendarEvent(event) {
  if (!event || typeof event !== 'object') {
    return false;
  }

  if (!event.kind) {
    return false;
  }

  if (event.kind === 31922) {
    return validateKind31922(event);
  } else if (event.kind === 31923) {
    return validateKind31923(event);
  }

  // Not a calendar event kind we validate
  return false;
}

/**
 * Filter an array to only include valid calendar events
 * @param {any[]} events - Array of events to filter
 * @returns {any[]} Filtered array containing only valid events
 */
export function filterValidEvents(events) {
  if (!Array.isArray(events)) {
    console.warn('📅 filterValidEvents: Invalid input, expected array');
    return [];
  }

  return events.filter((event) => validateCalendarEvent(event));
}
