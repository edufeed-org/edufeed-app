import { nip19 } from 'nostr-tools';
import { eventLoader, addressLoader } from '$lib/loaders';
import { firstValueFrom, timeout, catchError, of } from 'rxjs';
import { getSeenRelays } from 'applesauce-core/helpers';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { getCalendarEventStart } from 'applesauce-common/helpers';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte.js';
import { parseCalendarTimestamp } from '$lib/helpers/calendar.js';

/**
 * Parse a Nostr 'a' tag value into an AddressPointer
 * Correctly handles d-tags that contain colons (like URLs)
 *
 * This is a workaround for the broken getAddressPointerFromATag() from applesauce-core
 * which naively splits by ':' and breaks when identifiers contain colons.
 *
 * @param {string[]|string} aTag - The 'a' tag array [tag, value, ...] or just the value string
 * @returns {{kind: number, pubkey: string, identifier: string}|null}
 */
export function parseAddressPointerFromATag(aTag) {
  const value = Array.isArray(aTag) ? aTag[1] : aTag;
  if (!value) return null;

  const firstColon = value.indexOf(':');
  const secondColon = value.indexOf(':', firstColon + 1);

  if (firstColon === -1 || secondColon === -1) return null;

  return {
    kind: parseInt(value.substring(0, firstColon), 10),
    pubkey: value.substring(firstColon + 1, secondColon),
    identifier: value.substring(secondColon + 1) // Everything after second colon
  };
}

/**
 * Convert hex pubkey to npub format
 * @param {string} hex - 64-character hex pubkey
 * @returns {string|null} npub string or null if invalid
 */
export function hexToNpub(hex) {
  if (!hex || typeof hex !== 'string') return null;
  // Validate hex format (64 chars, hex only)
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;

  try {
    return nip19.npubEncode(hex);
  } catch (error) {
    console.error('Error encoding npub:', error);
    return null;
  }
}

/**
 * Convert npub to hex pubkey
 * @param {string} npub - npub1... identifier
 * @returns {string|null} hex pubkey or null if invalid
 */
export function npubToHex(npub) {
  if (!npub || typeof npub !== 'string') return null;
  if (!npub.startsWith('npub1')) return null;

  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === 'npub') {
      return decoded.data;
    }
    return null;
  } catch (error) {
    console.error('Error decoding npub:', error);
    return null;
  }
}

/**
 * Normalize pubkey identifier to hex format
 * Accepts both hex and npub, returns hex
 * @param {string} identifier - hex pubkey or npub
 * @returns {string|null} hex pubkey or null if invalid
 */
export function normalizeToHex(identifier) {
  if (!identifier || typeof identifier !== 'string') return null;

  // Already hex format
  if (/^[0-9a-f]{64}$/i.test(identifier)) {
    return identifier.toLowerCase();
  }

  // Try decoding as npub
  return npubToHex(identifier);
}

/**
 * Extract NIP-19 identifiers from text
 * Pattern matches both plain and nostr: URI formats:
 * - Plain: npub1..., nprofile1..., note1..., nevent1..., naddr1...
 * - URI: nostr:npub1..., nostr:naddr1..., etc. (NIP-21)
 * @param {string} text - Text to search for identifiers
 * @returns {Array<{identifier: string, type: string, start: number, end: number}>} Array of found identifiers
 */
export function extractNostrIdentifiers(text) {
  if (!text || typeof text !== 'string') return [];

  // Match both plain identifiers and nostr: URI scheme (NIP-21)
  // Captures optional "nostr:" prefix and the identifier
  const regex = /\b(?:nostr:)?(npub|nprofile|note|nevent|naddr)1[a-z0-9]+\b/gi;
  const matches = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const fullMatch = match[0]; // May include "nostr:" prefix
    const identifier = fullMatch.startsWith('nostr:')
      ? fullMatch.substring(6) // Remove "nostr:" prefix
      : fullMatch;

    matches.push({
      identifier: identifier,
      type: match[1].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length
    });
  }

  return matches;
}

/**
 * Decode NIP-19 identifier and extract entity info
 * @param {string} identifier - NIP-19 identifier to decode
 * @returns {{success: boolean, type?: string, data?: any, identifier: string, error?: string}}
 */
export function decodeNostrIdentifier(identifier) {
  try {
    const decoded = nip19.decode(identifier);
    return {
      success: true,
      type: decoded.type,
      data: decoded.data,
      identifier
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      identifier
    };
  }
}

/**
 * Check if identifier points to a calendar event
 * @param {ReturnType<typeof decodeNostrIdentifier>} decoded - Decoded identifier
 * @returns {boolean}
 */
export function isCalendarEventIdentifier(decoded) {
  return (
    decoded.success &&
    decoded.type === 'naddr' &&
    (decoded.data.kind === 31922 || decoded.data.kind === 31923)
  );
}

/**
 * Check if identifier points to a calendar
 * @param {ReturnType<typeof decodeNostrIdentifier>} decoded - Decoded identifier
 * @returns {boolean}
 */
export function isCalendarIdentifier(decoded) {
  return decoded.success && decoded.type === 'naddr' && decoded.data.kind === 31924;
}

/**
 * Check if identifier points to a wiki event (NIP-54)
 * @param {ReturnType<typeof decodeNostrIdentifier>} decoded - Decoded identifier
 * @returns {boolean}
 */
export function isWikiIdentifier(decoded) {
  return decoded.success && decoded.type === 'naddr' && decoded.data.kind === 30818;
}

/**
 * Fetches a Nostr event using various identifier types
 *
 * @param identifier {string} - Can be an event ID, naddr, or other identifier
 * @returns Promise that resolves to the event or null if not found
 */
export const fetchEventById = async (identifier) => {
  try {
    // Handle different identifier types using applesauce loaders
    if (identifier.startsWith('naddr')) {
      // If it's an naddr, decode it to get the components
      try {
        const decoded = nip19.decode(identifier);
        if (decoded.type === 'naddr') {
          const data = decoded.data;

          // CHECK EVENTSTORE FIRST for optimistically added events
          const localEvent = eventStore.getReplaceable(data.kind, data.pubkey, data.identifier);
          if (localEvent) {
            return localEvent;
          }

          // Create address pointer with relay hints
          /** @type {{ kind: number; pubkey: string; identifier: string; relays?: string[] }} */
          const addressPointer = {
            kind: data.kind,
            pubkey: data.pubkey,
            identifier: data.identifier
          };

          // Include relay hints if present (addressLoader will prioritize them)
          if (data.relays && data.relays.length > 0) {
            addressPointer.relays = data.relays;
          } else {
            // No relay hints in naddr — provide lookup relays explicitly.
            // addressLoader's lookupRelays config is captured at module init
            // (before runtimeConfig loads), so we must pass relays in the pointer.
            addressPointer.relays = getAllLookupRelays();
          }

          // Use addressLoader for addressable events (fetches from relays)
          const event$ = addressLoader(addressPointer).pipe(
            timeout(3000),
            catchError(() => of(null))
          );
          const event = await firstValueFrom(event$, { defaultValue: null });
          return event || null;
        } else {
          throw new Error('Invalid naddr format');
        }
      } catch (error) {
        console.error('Error decoding naddr:', error);
        return null;
      }
    } else if (identifier.startsWith('nevent')) {
      // If it's a nevent, decode it to get the event pointer
      try {
        const decoded = nip19.decode(identifier);
        if (decoded.type === 'nevent') {
          const data = decoded.data;

          // Check EventStore first
          const localEvent = eventStore.getEvent(data.id);
          if (localEvent) return localEvent;

          // Union hint relays with lookup relays (hints may point to dead relays)
          const hintRelays = data.relays?.length ? data.relays : [];
          const lookupRelays = getAllLookupRelays();
          const relays = [...new Set([...hintRelays, ...lookupRelays])];
          const event$ = eventLoader({ id: data.id, relays }).pipe(
            timeout(3000),
            catchError(() => of(null))
          );
          const event = await firstValueFrom(event$, { defaultValue: null });
          return event || null;
        } else {
          throw new Error('Invalid nevent format');
        }
      } catch (error) {
        console.error('Error decoding nevent:', error);
        return null;
      }
    } else if (identifier.startsWith('note')) {
      // If it's a note ID
      try {
        const decoded = nip19.decode(identifier);
        if (decoded.type === 'note') {
          // Use eventLoader for event IDs
          const event$ = eventLoader({ id: decoded.data }).pipe(
            timeout(3000),
            catchError(() => of(null))
          );
          const event = await firstValueFrom(event$, { defaultValue: null });
          return event || null;
        } else {
          throw new Error('Invalid note format');
        }
      } catch (error) {
        console.error('Error decoding note:', error);
        return null;
      }
    } else {
      // Assume it's a raw event ID - use eventLoader
      try {
        const event$ = eventLoader({ id: identifier }).pipe(
          timeout(3000),
          catchError(() => of(null))
        );
        const event = await firstValueFrom(event$, { defaultValue: null });
        return event || null;
      } catch (error) {
        console.error('Error fetching event by ID:', error);
        return null;
      }
    }
  } catch (error) {
    console.error('Error fetching event:', error);
    return null;
  }
};

/**
 * Fetches and categorizes calendar events from a main calendar event
 *
 * @param {import('nostr-tools').NostrEvent} calendarEvent - The main calendar event (kind 31924)
 * @returns {Promise<{upcoming: import('nostr-tools').NostrEvent[], past: import('nostr-tools').NostrEvent[]}>} Object containing sorted upcoming and past events
 */
export const fetchCalendarEvents = async (calendarEvent) => {
  const now = Math.floor(Date.now() / 1000);
  /** @type {import('nostr-tools').NostrEvent[]} */
  const upcoming = [];
  /** @type {import('nostr-tools').NostrEvent[]} */
  const past = [];
  /** @type {string[]} */
  const deletedEventRefs = [];

  if (!calendarEvent || calendarEvent.kind !== 31924) {
    return { upcoming, past };
  }

  const eventRefs = calendarEvent.tags.filter((/** @type {string[]} */ tag) => tag[0] === 'a');
  // could we also use merge from rxjs here?
  const fetchPromises = eventRefs.map(async (/** @type {string[]} */ tag) => {
    const parts = tag[1].split(':');
    if (parts.length < 3) return null;

    const [kindStr, pubkey, dTag] = parts;
    const kind = parseInt(kindStr);

    if (kind !== 31922 && kind !== 31923) return null;

    try {
      // Use addressLoader for addressable calendar events
      const event$ = addressLoader({
        kind: kind,
        pubkey: pubkey,
        identifier: dTag
      });
      const event = await firstValueFrom(event$, { defaultValue: null });

      if (!event) return null;

      // Check for deletion events (NIP-09)
      const isDeleted = await checkForDeletionEvents(event);

      if (isDeleted) {
        deletedEventRefs.push(tag[1]);
        return null; // Skip deleted events
      }

      const startTime = parseCalendarTimestamp(
        event.tags.find((/** @type {string[]} */ t) => t[0] === 'start')?.[1],
        event.kind
      );

      return { event, startTime };
    } catch (error) {
      console.error('Error fetching calendar event:', error);
      return null;
    }
  });

  const results = await Promise.all(fetchPromises);

  results.forEach((result) => {
    if (!result) return;

    if (result.startTime > now) {
      upcoming.push(result.event);
    } else {
      past.push(result.event);
    }
  });

  // If we found deleted events, update the calendar to remove their references
  if (deletedEventRefs.length > 0) {
    removeDeletedEventsFromCalendar(calendarEvent, deletedEventRefs);
  }

  // Sort functions
  /**
   * @param {import('nostr-tools').NostrEvent} a
   * @param {import('nostr-tools').NostrEvent} b
   */
  const sortAsc = (a, b) => (getCalendarEventStart(a) || 0) - (getCalendarEventStart(b) || 0);

  /**
   * @param {import('nostr-tools').NostrEvent} a
   * @param {import('nostr-tools').NostrEvent} b
   */
  const sortDesc = (a, b) => (getCalendarEventStart(b) || 0) - (getCalendarEventStart(a) || 0);

  return {
    upcoming: upcoming.sort(sortAsc),
    past: past.sort(sortDesc)
  };
};

/**
 * Removes deleted event references from a calendar and publishes the updated calendar
 *
 * @param {import('nostr-tools').NostrEvent} calendarEvent - The calendar event to update
 * @param {string[]} deletedEventRefs - Array of deleted event coordinate strings to remove
 */
async function removeDeletedEventsFromCalendar(calendarEvent, deletedEventRefs) {
  try {
    console.log(`Removing ${deletedEventRefs.length} deleted events from calendar`);

    // TODO: Implement calendar update functionality using existing publisher utilities
    // This would require integrating with the publisher.js utilities in the project
    // For now, just log the action that would be taken
    console.log(
      `Would update calendar ${calendarEvent.id} to remove deleted event references:`,
      deletedEventRefs
    );

    // The actual implementation would:
    // 1. Create updated calendar event with filtered tags
    // 2. Use the existing publisher utilities to sign and publish
    // 3. Update the calendar in the EventStore
  } catch (error) {
    console.error('Error updating calendar to remove deleted events:', error);
  }
}

/**
 * Checks if an event has been deleted according to NIP-09
 *
 * @param {import('nostr-tools').NostrEvent} event - The event to check
 * @returns {Promise<boolean>} True if the event has been deleted
 */
async function checkForDeletionEvents(event) {
  try {
    // For now, return false as deletion event checking with applesauce
    // would require more complex timeline loader setup
    // This maintains the same behavior as before (no deletion checking)
    // TODO: Implement proper deletion event checking with applesauce timeline loaders
    console.log(`Checking deletion for event ${event.id} - skipping for now`);
    return false;
  } catch (error) {
    console.error('Error checking for deletion events:', error);
    return false; // On error, assume not deleted
  }
}

/**
 * Encodes an addressable event into a NIP-19 naddr format
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string[]} [relays] - Optional array of relay URLs to include in the naddr
 */
export const encodeEventToNaddr = (event, relays = []) => {
  try {
    // Extract d tag for the identifier
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1] || '';

    // Get relay hints from seen relays if not explicitly provided
    let relayHints = relays;
    if (!relayHints || relayHints.length === 0) {
      const seenRelays = getSeenRelays(event);
      if (seenRelays && seenRelays.size > 0) {
        // Convert Set to Array and limit to 3 relays (NIP-19 recommendation)
        relayHints = Array.from(seenRelays).slice(0, 3);
      }
    }

    // Build naddr data with optional relays
    /** @type {{ identifier: string; pubkey: string; kind: number; relays?: string[] }} */
    const naddrData = {
      identifier: dTag,
      pubkey: event.pubkey,
      kind: event.kind
    };

    // Add relays if we have any
    if (relayHints && relayHints.length > 0) {
      naddrData.relays = relayHints;
    }

    return nip19.naddrEncode(naddrData);
  } catch (error) {
    console.error('Error encoding event to naddr:', error);
    return '';
  }
};

/**
 * NIP-C1 core: convert a hue (0-359) to RGB using fixed saturation
 * and adaptive brightness. Shared by pubkey and kind color functions.
 *
 * @param {number} hue - Hue value (0-359)
 * @returns {{r: number, g: number, b: number}}
 */
function hueToRGB(hue) {
  const s = 0.7;
  const v = hue >= 32 && hue <= 204 ? 0.75 : hue >= 216 && hue <= 273 ? 0.96 : 0.9;

  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let r1, g1, b1;
  if (hue < 60) [r1, g1, b1] = [c, x, 0];
  else if (hue < 120) [r1, g1, b1] = [x, c, 0];
  else if (hue < 180) [r1, g1, b1] = [0, c, x];
  else if (hue < 240) [r1, g1, b1] = [0, x, c];
  else if (hue < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  };
}

/**
 * Generate deterministic RGB values from a pubkey (NIP-C1).
 *
 * @param {string} pubkey - Hex public key
 * @returns {{r: number, g: number, b: number}} RGB values (0-255)
 */
export function generateAuthorColorRGB(pubkey) {
  if (!pubkey || typeof pubkey !== 'string') return { r: 128, g: 128, b: 128 };
  const hue = Number(BigInt('0x' + pubkey) % 360n);
  return hueToRGB(hue);
}

/**
 * Generate deterministic RGB values from a Nostr event kind number.
 * Uses Knuth multiplicative hash for good hue distribution of small integers.
 *
 * @param {number} kind - Nostr event kind
 * @returns {{r: number, g: number, b: number}}
 */
export function generateKindColorRGB(kind) {
  if (kind === undefined || kind === null) return { r: 128, g: 128, b: 128 };
  const hue = Number((BigInt(kind) * 2654435761n) % 360n);
  return hueToRGB(hue);
}

/**
 * Generate a deterministic CSS color string from a Nostr event kind number.
 *
 * @param {number} kind - Nostr event kind
 * @returns {string} CSS rgb() color string
 */
export function generateKindColor(kind) {
  const { r, g, b } = generateKindColorRGB(kind);
  return `rgb(${r},${g},${b})`;
}

/**
 * Generate a deterministic CSS color from a pubkey (NIP-C1).
 *
 * @param {string} pubkey - Hex public key
 * @returns {string} CSS rgb() color string
 */
export function generateAuthorColor(pubkey) {
  const { r, g, b } = generateAuthorColorRGB(pubkey);
  return `rgb(${r},${g},${b})`;
}
