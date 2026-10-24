/** @vitest-environment node */
// Convention: a Nostr event (or an array of them) never lives in a deep
// `$state`. Svelte's deep proxy rejects the non-enumerable descriptors that
// applesauce's helpers use to memoize on the event (`state_descriptors_fixed`
// → the whole route dies behind "Diese Seite hat einen Fehler"). Events are
// replaced whole, never mutated in place, so `$state.raw` is always right.
// See CLAUDE.md "$state.raw() for Event Arrays with Symbol Data".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(
  "git ls-files 'src/**/*.svelte' 'src/**/*.svelte.js' | grep -v __tests__ | grep -v __mocks__",
  { encoding: 'utf8' }
)
  .split('\n')
  .filter(Boolean);

// Identifiers that hold a Nostr event or a list of them.
const EVENT_NAME =
  /^(?:.*(?:Event|Events|event|events|Note|note)|resolvedTarget|replyTarget|threadRoot|reactions|rsvps|globalCommunities|editResource)$/;
// `let <name> = $state(<not raw>)`
const DEEP_STATE = /\blet\s+([A-Za-z_$][\w$]*)\s*=\s*\$state\((?!\.raw)/g;
// Names matched by EVENT_NAME that are known not to be events.
const NOT_EVENTS = new Set([
  'eventCount',
  'eventsDateRangeStart',
  'eventsDateRangeEnd',
  'eventStart',
  'eventEnd',
  'noteText',
  'noteInput',
  'noteDraft',
  'eventTitle',
  'eventDescription',
  'eventLocation',
  'eventDate',
  'eventTime',
  'eventType',
  'eventKind',
  'noteLength',
  'eventsLoaded',
  'hasEvents',
  'showEvents',
  // Free-text inputs
  'note',
  'rsvpNote',
  // CalendarStore's `{ events: [] }` holder is reassigned by property; its
  // CalendarEvent objects are app-side wrappers (see calendar-events.svelte.js)
  'cEvents'
]);

// Second net, by value instead of by name: an assignment that stores one of
// these identifiers AS A VALUE (not a property of it, not a call argument)
// into a deep $state holder. Catches `messages = events`,
// `existingResponse = events?.[0]`, `[...calendars, event]`,
// `{ event: latest }`, `threads = loaded || []`.
// Not matched: a property read (`event.id`), a call argument (`f(event)`), a
// condition (`event ? … : …`, `event && …`) and words inside string literals.
const EVENT_VALUE =
  /(?:^|[\s[,:(|&])(event|events|loaded|latest|timeline|rawEvent|originalEvent)\b(?!\s*[.?]\s*[A-Za-z_$])(?!\s*\))(?!\s*\?)(?!\s*&&)/;
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
// Holders the value rule flags that store a derived primitive, with the reason.
const NOT_EVENT_VALUES = new Map([]);

/**
 * Every `name = <rhs>` assignment in the source (top-level or inside a callback).
 * @param {string} source
 * @param {string} name
 */
function assignmentsOf(source, name) {
  const re = new RegExp(`(?:^|[;{\\s])${name.replace(/\$/g, '\\$')}\\s*=(?!=)\\s*([^;\\n]*)`, 'g');
  return [...source.matchAll(re)].map((m) => m[1]);
}

describe('Nostr events are never held in deep $state', () => {
  it('every $state that is assigned an event value is $state.raw', () => {
    /** @type {string[]} */
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(DEEP_STATE)) {
        const name = match[1];
        if (NOT_EVENT_VALUES.has(name)) continue;
        const hit = assignmentsOf(source, name).find((rhs) =>
          EVENT_VALUE.test(rhs.replace(STRING_LITERAL, "''"))
        );
        if (!hit) continue;
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} let ${name} = $state(…) <- ${hit.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every event-holding $state in src is $state.raw', () => {
    /** @type {string[]} */
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(DEEP_STATE)) {
        const name = match[1];
        if (!EVENT_NAME.test(name) || NOT_EVENTS.has(name)) continue;
        // Booleans and flags named after events (isDeletingEvent, hasEvent, …)
        if (/^(is|has|show|can|should)[A-Z]/.test(name)) continue;
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} let ${name} = $state(…)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
