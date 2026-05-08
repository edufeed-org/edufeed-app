/**
 * Calendar Helper Functions
 * Utilities for date formatting, event management, and calendar operations
 */

import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { getSeenRelays, normalizeURL } from 'applesauce-core/helpers';

/**
 * @typedef {import('../types/calendar.js').CalendarEvent} CalendarEvent
 * @typedef {import('../types/calendar.js').EventFormData} EventFormData
 */

/** ISO 8601 date pattern for NIP-52 kind 31922 (date-based) events */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a NIP-52 calendar event time value to a Unix timestamp (seconds).
 * Handles both formats per NIP-52 spec:
 * - Kind 31922 (date-based): ISO 8601 date string "YYYY-MM-DD" → midnight UTC
 * - Kind 31923 (time-based): Unix timestamp string "1704067200"
 *
 * @param {string | undefined} value - The tag value to parse
 * @param {number} [_eventKind] - Optional event kind for format hints
 * @returns {number} Unix timestamp in seconds, or 0 if invalid
 */
export function parseCalendarTimestamp(value, _eventKind) {
  if (!value) return 0;

  // Date-based format: "YYYY-MM-DD" → midnight UTC
  if (ISO_DATE_PATTERN.test(value)) {
    const date = new Date(value + 'T00:00:00Z');
    return isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
  }

  // Time-based format: Unix timestamp string
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Format a unix timestamp as a relative time string (e.g. "3m ago", "2d ago")
 * Falls back to short date format (e.g. "Mar 6") for dates older than a week.
 * @param {number} unixSeconds - Unix timestamp in seconds
 * @returns {string} Relative time string
 */
export function formatRelativeTime(unixSeconds) {
  const diff = Date.now() - unixSeconds * 1000;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return formatCalendarDate(new Date(unixSeconds * 1000), 'short');
}

/**
 * Format a date for calendar display using configured locale
 * @param {Date} date - Date to format
 * @param {string} format - Format string ('YYYY-MM-DD', 'MM/DD', 'full', 'long', 'short', 'time')
 * @returns {string} Formatted date string
 */
export function formatCalendarDate(date, format) {
  if (!date || !(date instanceof Date)) return '';

  const locale = runtimeConfig.calendar.locale;
  const use24Hour = runtimeConfig.calendar.timeFormat === '24h';

  switch (format) {
    case 'YYYY-MM-DD':
      return date.toISOString().split('T')[0];
    case 'MM/DD':
      // For European format, use DD.MM
      return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    case 'full':
    case 'long':
      return date.toLocaleDateString(locale, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    case 'short':
      return date.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric'
      });
    case 'month':
      return date.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long'
      });
    case 'time':
      return date.toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: !use24Hour
      });
    default:
      return date.toLocaleDateString(locale);
  }
}

/**
 * Get array of dates for week view
 * @param {Date} date - Reference date (any day in the week)
 * @returns {Date[]} Array of 7 dates representing the week
 */
export function getWeekDates(date) {
  const weekStartDay = runtimeConfig.calendar.weekStartDay;
  const startOfWeek = new Date(date);
  const day = startOfWeek.getDay();

  // Calculate difference to get to the configured start of week
  const diff = startOfWeek.getDate() - ((day - weekStartDay + 7) % 7);
  startOfWeek.setDate(diff);

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const weekDate = new Date(startOfWeek);
    weekDate.setDate(startOfWeek.getDate() + i);
    weekDates.push(weekDate);
  }
  return weekDates;
}

/**
 * Get array of dates for month view (including padding days)
 * @param {Date} date - Reference date (any day in the month)
 * @returns {Date[]} Array of dates for calendar grid (42 days)
 */
export function getMonthDates(date) {
  const weekStartDay = runtimeConfig.calendar.weekStartDay;
  const year = date.getFullYear();
  const month = date.getMonth();

  // First day of the month
  const firstDay = new Date(year, month, 1);

  // Start from the configured start day of the week containing the first day
  const startDate = new Date(firstDay);
  const firstDayOfWeek = firstDay.getDay();
  const diff = (firstDayOfWeek - weekStartDay + 7) % 7;
  startDate.setDate(firstDay.getDate() - diff);

  // Generate 42 days (6 weeks) for consistent grid
  const monthDates = [];
  for (let i = 0; i < 42; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    monthDates.push(currentDate);
  }

  return monthDates;
}

/**
 * Check if an event falls within a date range using UTC comparisons
 * @param {CalendarEvent} event - Calendar event to check
 * @param {Date} start - Start of date range (should be UTC date with time precision)
 * @param {Date} end - End of date range (should be UTC date with time precision)
 * @returns {boolean} True if event overlaps with date range
 */
export function isEventInDateRange(event, start, end) {
  if (!event || !event.start) return false;

  // Convert UNIX timestamps to UTC dates for comparison
  // event.start and event.end are UNIX timestamps (seconds)
  const eventStartDateUTC = new Date(event.start * 1000);
  const eventEndDateUTC = event.end
    ? new Date(event.end * 1000) // Exclusive end date
    : eventStartDateUTC; // Same day if no end

  // Use the provided date range directly - they already have proper time precision
  // Previously, we were recreating UTC dates which lost the time information (00:00:00 always)
  // This caused events to be filtered out incorrectly in list view

  // Check for overlap: eventStart < rangeEnd AND eventEnd > rangeStart
  // Note: NIP-52 end date is exclusive, so we use > instead of >=
  return eventStartDateUTC < end && eventEndDateUTC > start;
}

/**
 * Group events by date for calendar display
 * Only includes valid events that pass NIP-52 validation
 * @param {CalendarEvent[]} events - Array of calendar events
 * @returns {Map<string, CalendarEvent[]>} Map of date strings to event arrays
 */
export function groupEventsByDate(events) {
  // Defensive check for undefined/null or invalid input
  if (!events || !Array.isArray(events)) {
    console.warn('📅 groupEventsByDate: Invalid events array:', events);
    return new Map();
  }

  const groupedEvents = new Map();

  events.forEach((event) => {
    // Validate event against NIP-52 specifications
    // This ensures only valid events are displayed in the calendar
    // if (!validateCalendarEvent(event.originalEvent || event)) {
    // 	return; // Skip invalid events
    // }

    if (!event.start) return;

    // Validate that start is a valid number
    const startTimestamp =
      typeof event.start === 'number' ? event.start : parseCalendarTimestamp(String(event.start));
    if (!startTimestamp) {
      console.warn(
        '📅 groupEventsByDate: Invalid event start timestamp:',
        event.start,
        'for event:',
        event.title || event.id
      );
      return;
    }

    // Convert UNIX timestamp to UTC date and create consistent date key
    const eventDate = new Date(startTimestamp * 1000);
    const dateKey = createDateKey(eventDate); // Use consistent UTC-based key generation

    if (!groupedEvents.has(dateKey)) {
      groupedEvents.set(dateKey, []);
    }
    groupedEvents.get(dateKey).push(event);
  });

  // Sort events within each date by start timestamp
  groupedEvents.forEach((dayEvents) => {
    dayEvents.sort(
      /** @param {CalendarEvent} a @param {CalendarEvent} b */
      (a, b) => (a.start || 0) - (b.start || 0)
    );
  });

  return groupedEvents;
}

/**
 * Validate event form data
 * @param {EventFormData} formData - Form data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateEventForm(formData) {
  const errors = [];

  if (!formData.title?.trim()) {
    errors.push('Event title is required');
  }

  if (!formData.startDate) {
    errors.push('Start date is required');
  }

  if (formData.eventType === 'time' && !formData.startTime) {
    errors.push('Start time is required for time-based events');
  }

  if (formData.endDate && formData.startDate) {
    const startDate = new Date(formData.startDate);
    const endDate = new Date(formData.endDate);
    if (endDate < startDate) {
      errors.push('End date cannot be before start date');
    }
  }

  if (formData.eventType === 'time' && formData.endTime && formData.startTime) {
    const startTime = new Date(`2000-01-01T${formData.startTime}`);
    const endTime = new Date(`2000-01-01T${formData.endTime}`);
    if (endTime <= startTime && formData.startDate === formData.endDate) {
      errors.push('End time must be after start time for same-day events');
    }
  }

  return errors;
}

/**
 * Convert form data to calendar event object
 * @param {EventFormData} formData - Form data to convert
 * @param {string} communityPubkey - Target community public key
 * @returns {Partial<CalendarEvent>} Partial calendar event object
 */
export function convertFormDataToEvent(formData, communityPubkey) {
  /** @type {Partial<CalendarEvent>} */
  const event = {
    title: formData.title.trim(),
    summary: formData.summary?.trim() || '',
    image: formData.image?.trim() || '',
    communityPubkey,
    location: formData.location?.trim() || '',
    hashtags: [],
    references: formData.references || [],
    participants: []
  };

  // Handle date/time conversion
  if (formData.eventType === 'date' || formData.isAllDay) {
    // Date-based event (kind 31922)
    event.kind = 31922;
    const startDate = new Date(formData.startDate);
    event.start = Math.floor(startDate.getTime() / 1000);

    if (formData.endDate) {
      const endDate = new Date(formData.endDate);
      event.end = Math.floor(endDate.getTime() / 1000);
    }
  } else {
    // Time-based event (kind 31923)
    event.kind = 31923;
    const startDateTime = new Date(`${formData.startDate}T${formData.startTime}`);
    event.start = Math.floor(startDateTime.getTime() / 1000);

    if (formData.endDate && formData.endTime) {
      const endDateTime = new Date(`${formData.endDate}T${formData.endTime}`);
      event.end = Math.floor(endDateTime.getTime() / 1000);
    }

    // Add timezone information
    if (formData.startTimezone) {
      event.startTimezone = formData.startTimezone;
    }
    if (formData.endTimezone) {
      event.endTimezone = formData.endTimezone;
    }
  }

  return event;
}

/**
 * Get current user's timezone
 * @returns {string} IANA timezone identifier
 */
export function getCurrentTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Check if a date is today
 * @param {Date} date - Date to check
 * @returns {boolean} True if date is today
 */
export function isToday(date) {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

/**
 * Check if a date is in the current month
 * @param {Date} date - Date to check
 * @param {Date} referenceDate - Reference date for current month
 * @returns {boolean} True if date is in the same month as reference
 */
export function isCurrentMonth(date, referenceDate) {
  return (
    date.getMonth() === referenceDate.getMonth() &&
    date.getFullYear() === referenceDate.getFullYear()
  );
}

/**
 * Get the next occurrence of a weekday
 * @param {number} weekday - Day of week (0 = Sunday, 6 = Saturday)
 * @param {Date} [fromDate] - Starting date (defaults to today)
 * @returns {Date} Next occurrence of the weekday
 */
export function getNextWeekday(weekday, fromDate = new Date()) {
  const date = new Date(fromDate);
  const currentDay = date.getDay();
  const daysUntilTarget = (weekday - currentDay + 7) % 7;

  if (daysUntilTarget === 0) {
    // If it's the same weekday, get next week's occurrence
    date.setDate(date.getDate() + 7);
  } else {
    date.setDate(date.getDate() + daysUntilTarget);
  }

  return date;
}

/**
 * Create a UTC-based date key for consistent event grouping and lookup
 * @param {Date} date - Local date object
 * @returns {string} UTC date key in YYYY-MM-DD format
 */
export function createDateKey(date) {
  // Validate the date is valid
  if (!date || isNaN(date.getTime())) {
    console.warn('📅 createDateKey: Invalid date passed:', date);
    // Return today's date as fallback
    const today = new Date();
    const utcDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    return utcDate.toISOString().split('T')[0];
  }

  // Convert local date to UTC date for consistent key generation
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return utcDate.toISOString().split('T')[0];
}

/**
 * Get weekday headers based on the configured week start day
 * @returns {string[]} Array of weekday abbreviations starting from configured day
 */
export function getWeekdayHeaders() {
  const weekStartDay = runtimeConfig.calendar.weekStartDay;
  const fullWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Rotate the array to start from the configured day
  const rotatedWeekdays = [
    ...fullWeekdays.slice(weekStartDay),
    ...fullWeekdays.slice(0, weekStartDay)
  ];

  return rotatedWeekdays;
}

/**
 * Filter events based on view mode and current date
 * @param {CalendarEvent[]} events - Array of calendar events
 * @param {'all' | 'day' | 'week' | 'month'} viewMode - Current view mode
 * @param {Date} currentDate - Current reference date
 * @returns {CalendarEvent[]} Filtered and sorted events
 */
export function filterEventsByViewMode(events, viewMode, currentDate) {
  // If viewMode is 'all', return all events sorted
  if (viewMode === 'all') {
    // Sort by start date/time (chronological order) - create copy before sorting
    return [...events].sort((a, b) => (a.start || 0) - (b.start || 0));
  }

  if (!currentDate) return events;

  // For day view, use the same date-key approach as CalendarGrid for timezone consistency
  if (viewMode === 'day') {
    const groupedEvents = groupEventsByDate(events);
    const dateKey = createDateKey(currentDate);
    const dayEvents = groupedEvents.get(dateKey) || [];
    // Already sorted by groupEventsByDate
    return dayEvents;
  }

  // Calculate date range based on viewMode (for week/month)
  let startDate, endDate;

  switch (viewMode) {
    case 'week': {
      // Get week dates in local time
      const weekDates = getWeekDates(currentDate);

      // Convert first day to UTC start
      const firstDay = weekDates[0];
      startDate = new Date(
        Date.UTC(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate(), 0, 0, 0, 0)
      );

      // Convert last day to UTC end
      const lastDay = weekDates[weekDates.length - 1];
      endDate = new Date(
        Date.UTC(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59, 999)
      );
      break;
    }
    case 'month': {
      // Get month dates in local time
      const monthDates = getMonthDates(currentDate);

      // Convert first day to UTC start
      const firstDay = monthDates[0];
      startDate = new Date(
        Date.UTC(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate(), 0, 0, 0, 0)
      );

      // Convert last day to UTC end
      const lastDay = monthDates[monthDates.length - 1];
      endDate = new Date(
        Date.UTC(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59, 999)
      );
      break;
    }
    default:
      return events;
  }

  // Filter events that fall within the date range
  const filtered = events.filter((event) => isEventInDateRange(event, startDate, endDate));

  // Sort by start date/time (chronological order) - filtered array is already a new array from .filter()
  return filtered.sort((a, b) => (a.start || 0) - (b.start || 0));
}

/**
 * Narrow a list of events to those whose underlying raw NostrEvent was seen
 * on at least one of the user-selected relays.
 *
 * Items may be CalendarEvent wrappers (with `.originalEvent`) or raw events —
 * applesauce stores seen-relay metadata via a Symbol on the raw event, so we
 * unwrap before calling getSeenRelays. Both sides are normalized so that
 * casing / trailing-slash differences between the UI selection and the
 * applesauce-stored URL don't cause false negatives.
 *
 * @template T
 * @param {T[]} events
 * @param {string[]} selectedRelays
 * @returns {T[]}
 */
export function filterEventsBySelectedRelays(events, selectedRelays) {
  if (!selectedRelays || selectedRelays.length === 0) return events;
  const normSet = new Set(selectedRelays.map((r) => normalizeURL(r)));
  return events.filter((e) => {
    const raw = /** @type {any} */ (e)?.originalEvent ?? e;
    const seen = getSeenRelays(/** @type {any} */ (raw));
    if (!seen) return false;
    for (const r of seen) if (normSet.has(normalizeURL(r))) return true;
    return false;
  });
}

/**
 * Detect calendar identifier type
 * @param {string} identifier - Calendar identifier (naddr, npub, or hex pubkey)
 * @returns {'naddr' | 'pubkey' | 'unknown'} Identifier type
 */
export function detectCalendarIdentifierType(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    return 'unknown';
  }

  // Check if it's an naddr
  if (identifier.startsWith('naddr1')) {
    return 'naddr';
  }

  // Check if it's an npub or hex pubkey (64 hex chars)
  if (identifier.startsWith('npub1') || /^[0-9a-f]{64}$/i.test(identifier)) {
    return 'pubkey';
  }

  return 'unknown';
}

/**
 * Fetch all calendar events for a community
 * Consolidates events from both direct (#h tagged) and targeted publications (#p tagged)
 * @param {string} communityPubkey - Community public key
 * @param {string[]} [relays] - Optional relay URLs to query
 * @returns {Promise<import('nostr-tools').NostrEvent[]>} Array of calendar events
 */
export async function fetchCommunityCalendarEvents(communityPubkey, relays = []) {
  const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
  const { communityCalendarTimelineLoader, communityTargetedPublicationsLoader, addressLoader } =
    await import('$lib/loaders');
  const { getTagValue } = await import('applesauce-core/helpers');
  const { bufferTime, mergeMap, firstValueFrom } = await import('rxjs');

  /** @type {import('nostr-tools').NostrEvent[]} */
  const allEvents = [];
  /** @type {Set<string>} */
  const eventIds = new Set(); // For deduplication

  try {
    // Fetch direct community calendar events (#h tagged)
    // Use bufferTime to wait for events from multiple relays (3 seconds)
    const directTimeline$ = communityCalendarTimelineLoader(communityPubkey)();
    /** @type {import('nostr-tools').NostrEvent[]} */
    const directEventsBuffered = await firstValueFrom(
      directTimeline$.pipe(
        bufferTime(3000), // Wait 3 seconds to collect events from relays
        mergeMap((bufferedArrays) => {
          // Flatten the array of arrays into a single array
          const flattened = bufferedArrays.flat();
          return [flattened];
        })
      ),
      { defaultValue: [] }
    );

    // Flatten and deduplicate direct events
    /** @type {import('nostr-tools').NostrEvent[]} */
    const directEventsArray = Array.isArray(directEventsBuffered)
      ? directEventsBuffered.flat()
      : [];

    for (const event of directEventsArray) {
      if (!eventIds.has(event.id)) {
        eventIds.add(event.id);
        allEvents.push(event);
      }
    }

    // Fetch targeted publication events (#p tagged with #k for calendar)
    // Use bufferTime to wait for events from multiple relays (3 seconds)
    const targetedPubTimeline$ = communityTargetedPublicationsLoader(
      communityPubkey,
      [31922, 31923]
    )();
    /** @type {import('nostr-tools').NostrEvent[]} */
    const targetedPubsBuffered = await firstValueFrom(
      targetedPubTimeline$.pipe(
        bufferTime(3000), // Wait 3 seconds to collect events from relays
        mergeMap((bufferedArrays) => {
          // Flatten the array of arrays into a single array
          const flattened = bufferedArrays.flat();
          return [flattened];
        })
      ),
      { defaultValue: [] }
    );

    // Flatten and deduplicate targeted publications
    /** @type {import('nostr-tools').NostrEvent[]} */
    const targetedPubsArray = Array.isArray(targetedPubsBuffered)
      ? targetedPubsBuffered.flat()
      : [];

    // Resolve referenced events from targeted publications
    // Now using addressable references ('a' tags) instead of event IDs ('e' tags)
    const referencedEventPromises = [];

    for (const pubEvent of targetedPubsArray) {
      try {
        // Look for 'a' tag (addressable reference) instead of 'e' tag (event ID)
        const aTag = getTagValue(pubEvent, 'a');
        if (!aTag) {
          // Fallback to 'e' tag for backward compatibility with old shares
          const eTag = getTagValue(pubEvent, 'e');
          if (!eTag) continue;

          console.warn(
            `📅 fetchCommunityCalendarEvents: Found old-style share with 'e' tag: ${eTag}`
          );
          // Handle old-style event ID reference (will be deprecated)
          if (eventIds.has(eTag)) continue;

          let referencedEvent = eventStore.getEvent(eTag);
          if (referencedEvent && !eventIds.has(referencedEvent.id)) {
            eventIds.add(referencedEvent.id);
            allEvents.push(referencedEvent);
          }
          continue;
        }

        // Parse address: kind:pubkey:dtag
        const parts = aTag.split(':');
        if (parts.length < 3) {
          console.warn(`📅 fetchCommunityCalendarEvents: Invalid address format: ${aTag}`);
          continue;
        }

        const [kindStr, pubkey, dTag] = parts;
        const kind = parseInt(kindStr);

        // Validate it's a calendar event kind
        if (kind !== 31922 && kind !== 31923) {
          console.warn(`📅 fetchCommunityCalendarEvents: Invalid calendar event kind: ${kind}`);
          continue;
        }

        // Try to get from event store first using address
        const existingEvent = eventStore.replaceable({ kind, pubkey, identifier: dTag });

        // If we have it in store, use it immediately
        if (existingEvent && typeof existingEvent === 'object' && 'id' in existingEvent) {
          const /** @type {any} */ cachedEvent = existingEvent;
          if (!eventIds.has(cachedEvent.id)) {
            eventIds.add(cachedEvent.id);
            allEvents.push(cachedEvent);
          }
        } else {
          // If not in store, create a promise to load it by address
          /** @type {string[]} */
          let relayList = relays;
          // Use default relays as fallback if no relays provided
          if (relayList.length === 0) {
            relayList = [
              ...(runtimeConfig.appRelays?.calendar || []),
              ...(runtimeConfig.fallbackRelays || [])
            ];
          }

          const loadPromise = firstValueFrom(
            addressLoader({ kind, pubkey, identifier: dTag, relays: relayList }).pipe(
              bufferTime(2000)
            ),
            { defaultValue: null }
          )
            .then((bufferedEvents) => {
              if (bufferedEvents && Array.isArray(bufferedEvents)) {
                const loadedEvent = bufferedEvents.find((e) => e && e.kind === kind);
                if (loadedEvent && !eventIds.has(loadedEvent.id)) {
                  eventIds.add(loadedEvent.id);
                  allEvents.push(loadedEvent);
                }
              } else if (
                bufferedEvents &&
                typeof bufferedEvents === 'object' &&
                'id' in bufferedEvents
              ) {
                // Single event returned
                const /** @type {any} */ singleEvent = bufferedEvents;
                if (!eventIds.has(singleEvent.id)) {
                  eventIds.add(singleEvent.id);
                  allEvents.push(singleEvent);
                }
              }
            })
            .catch((err) => {
              console.warn(
                `📅 fetchCommunityCalendarEvents: Failed to load referenced event ${aTag}:`,
                err
              );
            });

          referencedEventPromises.push(loadPromise);
        }
      } catch (err) {
        console.warn(
          `📅 fetchCommunityCalendarEvents: Failed to resolve targeted publication ${pubEvent.id}:`,
          err
        );
      }
    }

    // Wait for all referenced events to be resolved
    await Promise.all(referencedEventPromises);

    return allEvents;
  } catch (error) {
    console.error(
      '📅 fetchCommunityCalendarEvents: Error fetching community calendar events:',
      error
    );
    return [];
  }
}

/**
 * Build NIP-52 compliant tags for a calendar event.
 * Pure function — no signing, no publishing, no stores.
 *
 * @param {EventFormData} formData - Raw form data (startDate as "YYYY-MM-DD")
 * @param {Partial<CalendarEvent>} eventData - Converted event data from convertFormDataToEvent
 * @param {string} dTag - The d-tag identifier
 * @param {string | string[]} [hTag] - Optional community h-tag(s)
 * @returns {string[][]} Array of NIP-52 compliant tags
 */
export function buildCalendarEventTags(formData, eventData, dTag, hTag) {
  /** @type {string[][]} */
  const tags = [];

  // d-tag (addressable/replaceable event identifier)
  tags.push(['d', dTag]);

  // h-tag(s) for community targeting (Communikey spec)
  if (hTag) {
    const hTags = Array.isArray(hTag) ? hTag : [hTag];
    for (const h of hTags) {
      if (h) tags.push(['h', h]);
    }
  }

  // Title
  tags.push(['title', eventData.title || '']);

  // Start/end tags — format depends on event kind
  if (eventData.kind === 31922) {
    // Kind 31922 (date-based): NIP-52 requires ISO 8601 date strings
    tags.push(['start', formData.startDate]);
    if (formData.endDate) {
      tags.push(['end', formData.endDate]);
    }
  } else {
    // Kind 31923 (time-based): Unix timestamp strings
    if (eventData.start) {
      tags.push(['start', eventData.start.toString()]);
    }
    if (eventData.end) {
      tags.push(['end', eventData.end.toString()]);
    }
  }

  // Timezone tags — only for kind 31923, using NIP-52 compliant names
  if (eventData.kind === 31923) {
    if (eventData.startTimezone) {
      tags.push(['start_tzid', eventData.startTimezone]);
    }
    if (eventData.endTimezone) {
      tags.push(['end_tzid', eventData.endTimezone]);
    }
  }

  // D tags (day-granularity) — only for kind 31923
  if (eventData.kind === 31923 && eventData.start) {
    const startDay = Math.floor(eventData.start / 86400);
    const endDay = eventData.end ? Math.floor(eventData.end / 86400) : startDay;
    for (let day = startDay; day <= endDay; day++) {
      tags.push(['D', day.toString()]);
    }
  }

  // Optional properties
  if (eventData.image) {
    tags.push(['image', eventData.image]);
  }
  if (eventData.location) {
    tags.push(['location', eventData.location]);
  }

  // Hashtags
  if (eventData.hashtags) {
    eventData.hashtags.forEach((hashtag) => {
      if (hashtag) tags.push(['t', hashtag]);
    });
  }

  // References
  if (eventData.references) {
    eventData.references.forEach((reference) => {
      if (reference) tags.push(['r', reference]);
    });
  }

  // Geohash
  if (eventData.geohash) {
    tags.push(['g', eventData.geohash]);
  }

  return tags;
}

/**
 * Padding in days to add before/after the view range to catch multi-day events
 * that span view boundaries
 * @type {number}
 */
export const VIEW_RANGE_PADDING_DAYS = 7;

/**
 * Check if a raw Nostr event falls within a date range
 * This works with raw events from relay (not CalendarEvent objects).
 * Extracts start/end timestamps from event tags.
 *
 * @param {import('nostr-tools').NostrEvent} event - Raw Nostr event
 * @param {number} rangeStart - Start of range as Unix timestamp (seconds)
 * @param {number} rangeEnd - End of range as Unix timestamp (seconds)
 * @returns {boolean} True if event overlaps with date range
 */
export function isRawEventInDateRange(event, rangeStart, rangeEnd) {
  if (!event || !event.tags) return false;

  // Extract start timestamp from tags (handles both date strings and Unix timestamps)
  const startTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'start');
  if (!startTag || !startTag[1]) return false;

  const eventStart = parseCalendarTimestamp(startTag[1], event.kind);
  if (!eventStart) return false;

  // Extract end timestamp from tags (optional)
  const endTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'end');
  const eventEnd = endTag && endTag[1] ? parseCalendarTimestamp(endTag[1], event.kind) : eventStart;

  // Check for overlap: eventStart < rangeEnd AND eventEnd >= rangeStart
  return eventStart < rangeEnd && eventEnd >= rangeStart;
}

/**
 * Check if an event's start time is after a given timestamp
 * Used for client-side filtering when paginating calendar events by start time.
 *
 * @param {import('nostr-tools').NostrEvent} event - Raw Nostr event
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {boolean} True if event start is after the timestamp
 */
export function isEventStartAfter(event, timestamp) {
  if (!event || !event.tags) return false;
  const startTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'start');
  const eventStart = startTag ? parseCalendarTimestamp(startTag[1], event.kind) : 0;
  return eventStart > timestamp;
}

/**
 * Get the start timestamp from an event
 * @param {import('nostr-tools').NostrEvent} event - Raw Nostr event
 * @returns {number} The start timestamp, or 0 if not found
 */
export function getEventStartTimestamp(event) {
  if (!event || !event.tags) return 0;
  const startTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'start');
  return startTag ? parseCalendarTimestamp(startTag[1], event.kind) : 0;
}

/**
 * Get the end timestamp from an event
 * @param {import('nostr-tools').NostrEvent} event - Raw Nostr event
 * @returns {number} The end timestamp, or 0 if not found
 */
export function getEventEndTimestamp(event) {
  if (!event || !event.tags) return 0;
  const endTag = event.tags.find((/** @type {string[]} */ tag) => tag[0] === 'end');
  return endTag ? parseCalendarTimestamp(endTag[1], event.kind) : 0;
}

/**
 * Check if a calendar event overlaps with a date range
 * Works with CalendarEvent objects (processed events with start/end properties).
 * An event overlaps if it starts before range end AND ends after range start.
 *
 * @param {{start?: number, end?: number}} event - Calendar event with start/end properties (Unix seconds)
 * @param {number} rangeStart - Range start timestamp (Unix seconds)
 * @param {number} rangeEnd - Range end timestamp (Unix seconds)
 * @returns {boolean} True if event overlaps with the date range
 */
export function eventOverlapsDateRange(event, rangeStart, rangeEnd) {
  const eventStart = event.start || 0;
  const eventEnd = event.end || eventStart;
  // Event overlaps if it starts before range end AND ends after range start
  return eventStart <= rangeEnd && eventEnd >= rangeStart;
}

/**
 * Get the date range for a given view (with padding for multi-day events)
 * Returns Unix timestamps suitable for relay queries.
 *
 * The padding catches multi-day events that:
 * - Start before the view but extend into it
 * - Start in the view but extend past it
 *
 * @param {Date} currentDate - The current viewing date
 * @param {'month' | 'week' | 'day'} viewMode - The view mode
 * @returns {{ start: number, end: number }} Unix timestamps (seconds)
 */
export function getViewDateRange(currentDate, viewMode) {
  let viewStart, viewEnd;

  switch (viewMode) {
    case 'day': {
      // Single day view
      viewStart = new Date(currentDate);
      viewStart.setHours(0, 0, 0, 0);
      viewEnd = new Date(currentDate);
      viewEnd.setHours(23, 59, 59, 999);
      break;
    }
    case 'week': {
      // Week view - use getWeekDates for consistency with grid display
      const weekDates = getWeekDates(currentDate);
      viewStart = new Date(weekDates[0]);
      viewStart.setHours(0, 0, 0, 0);
      viewEnd = new Date(weekDates[weekDates.length - 1]);
      viewEnd.setHours(23, 59, 59, 999);
      break;
    }
    case 'month':
    default: {
      // Month view - use getMonthDates for consistency with grid display (42 days)
      const monthDates = getMonthDates(currentDate);
      viewStart = new Date(monthDates[0]);
      viewStart.setHours(0, 0, 0, 0);
      viewEnd = new Date(monthDates[monthDates.length - 1]);
      viewEnd.setHours(23, 59, 59, 999);
      break;
    }
  }

  // Add padding to catch multi-day events spanning boundaries
  const paddingMs = VIEW_RANGE_PADDING_DAYS * 24 * 60 * 60 * 1000;
  const startWithPadding = new Date(viewStart.getTime() - paddingMs);
  const endWithPadding = new Date(viewEnd.getTime() + paddingMs);

  return {
    start: Math.floor(startWithPadding.getTime() / 1000),
    end: Math.floor(endWithPadding.getTime() / 1000)
  };
}

/**
 * Get community calendar metadata for ICS generation
 * @param {string} communityPubkey - Community public key
 * @returns {Promise<{title: string, summary: string, relays: string[]}>} Calendar metadata
 */
export async function getCommunityCalendarMetadata(communityPubkey) {
  const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
  const { firstValueFrom } = await import('rxjs');

  try {
    // Get community profile (kind 0)
    const profile$ = eventStore.profile(communityPubkey);
    const profileEvent = await firstValueFrom(profile$, { defaultValue: null });

    let title = 'Community Calendar';
    let summary = '';

    if (profileEvent) {
      // profileEvent is already ProfileContent from eventStore.profile()
      const displayName = profileEvent?.name || profileEvent?.display_name || '';
      title = displayName ? `${displayName} Calendar` : 'Community Calendar';
      summary = profileEvent?.about || '';
    }

    // Get community definition (kind 10222) for relays
    const communityDef$ = eventStore.replaceable({ kind: 10222, pubkey: communityPubkey });
    const communityDefEvent = await firstValueFrom(communityDef$, { defaultValue: null });

    /** @type {string[]} */
    let relays = [];
    if (communityDefEvent) {
      relays = communityDefEvent.tags
        .filter(/** @param {string[]} tag */ (tag) => tag[0] === 'r')
        .map(/** @param {string[]} tag */ (tag) => tag[1]);

      // Check for description override
      const descTag = communityDefEvent.tags.find(
        /** @param {string[]} tag */ (tag) => tag[0] === 'description'
      );
      if (descTag && descTag[1]) {
        summary = descTag[1];
      }
    }

    return { title, summary, relays };
  } catch (error) {
    console.error('📅 getCommunityCalendarMetadata: Error fetching metadata:', error);
    return {
      title: 'Community Calendar',
      summary: '',
      relays: []
    };
  }
}
