import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode, naddrEncode, nsecEncode } from 'nostr-tools/nip19';

/**
 * Convert Uint8Array to hex string
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const AUTHOR_COUNT = 4;
const COMMUNITY_COUNT = 30;

/**
 * Create a deterministic private key from a seed string.
 * Uses a simple hash-like approach so keys are identical across processes.
 * @param {number} index
 * @param {string} prefix
 * @returns {Uint8Array}
 */
function deterministicKey(index, prefix) {
  const sk = new Uint8Array(32);
  // Fill with a deterministic pattern based on prefix and index
  const seed = `${prefix}-${index}`;
  for (let i = 0; i < 32; i++) {
    sk[i] = (seed.charCodeAt(i % seed.length) + i * 7 + index * 13) & 0xff;
  }
  // Ensure valid secp256k1 scalar (must be < curve order, non-zero)
  // Setting first byte to reasonable range avoids exceeding curve order
  sk[0] = (sk[0] % 127) + 1;
  return sk;
}

// Deterministic keypairs (same across processes)
const contentAuthors = Array.from({ length: AUTHOR_COUNT }, (_, i) => {
  const sk = deterministicKey(i, 'content');
  return { sk, pk: getPublicKey(sk) };
});

const communityAuthors = Array.from({ length: COMMUNITY_COUNT }, (_, i) => {
  const sk = deterministicKey(i, 'community');
  return { sk, pk: getPublicKey(sk) };
});

const NOW = Math.floor(Date.now() / 1000);
const BASE = NOW - 30 * 24 * 3600; // 30 days ago

// Date range test helpers
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Format a Date as ISO 8601 date string (YYYY-MM-DD) for NIP-52 kind 31922
 * @param {Date} date
 * @returns {string}
 */
function formatISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get the start of the current month as a Unix timestamp (seconds)
 * @returns {number}
 */
function _getStartOfCurrentMonth() {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

/**
 * Get the start of next month as a Unix timestamp (seconds)
 * @returns {number}
 */
function getStartOfNextMonth() {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() / 1000);
}

/**
 * Get the start of previous month as a Unix timestamp (seconds)
 * @returns {number}
 */
function _getStartOfPreviousMonth() {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime() / 1000);
}

/**
 * Get the end of current month as a Unix timestamp (seconds)
 * @returns {number}
 */
function getEndOfCurrentMonth() {
  const now = new Date();
  return Math.floor(
    new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime() / 1000
  );
}

// Relay URLs matching docker-compose.e2e.yml - using 17xxx range to avoid port conflicts
export const RELAY_URLS = {
  amb: 'ws://localhost:17001',
  calendar: 'ws://localhost:17002',
  strfry: 'ws://localhost:17003'
};

const adjectives = [
  'Introduction to',
  'Advanced',
  'Fundamentals of',
  'Guide to',
  'Exploring',
  'Practical',
  'Modern',
  'Essential',
  'Beginner',
  'Deep Dive into'
];
const subjects = [
  'Mathematics',
  'Physics',
  'History',
  'Programming',
  'Biology',
  'Chemistry',
  'Literature',
  'Economics',
  'Psychology',
  'Art'
];

/**
 * Create a signed Nostr event
 * @param {{sk: Uint8Array, pk: string}} author
 * @param {number} kind
 * @param {string[][]} tags
 * @param {string} content
 * @param {number} createdAt
 * @returns {object}
 */
function make(author, kind, tags, content, createdAt) {
  return finalizeEvent(
    {
      kind,
      tags,
      content: content || '',
      created_at: createdAt
    },
    author.sk
  );
}

/**
 * Generate all test events for the mock relay.
 * @returns {object[]}
 */
export function generateTestEvents() {
  const events = [];

  // 50 kind 30023 articles
  for (let i = 0; i < 50; i++) {
    const a = contentAuthors[i % AUTHOR_COUNT];
    const title = `${adjectives[i % adjectives.length]} ${subjects[i % subjects.length]} #${i}`;
    events.push(
      make(
        a,
        30023,
        [
          ['d', `article-${i}`],
          ['title', title],
          ['summary', `Summary of ${title}`],
          ['published_at', String(BASE + i * 600)],
          ['t', subjects[i % subjects.length].toLowerCase()],
          ['t', 'test']
        ],
        `# ${title}\n\nContent for article ${i}.`,
        BASE + i * 600
      )
    );
  }

  // 50 kind 30142 AMB educational resources
  for (let i = 0; i < 50; i++) {
    const a = contentAuthors[i % AUTHOR_COUNT];
    const name = `Resource: ${subjects[i % subjects.length]} ${adjectives[i % adjectives.length]} #${i}`;
    events.push(
      make(
        a,
        30142,
        [
          ['d', `https://example.com/resource-${i}`],
          ['name', name],
          ['description', `Educational resource about ${subjects[i % subjects.length]}`],
          ['learningResourceType.id', 'https://w3id.org/kim/hcrt/text'],
          ['learningResourceType.prefLabel.de', 'Text'],
          ['learningResourceType.prefLabel.en', 'Text'],
          ['about.id', 'https://w3id.org/kim/hochschulfaechersystematik/n01'],
          ['about.prefLabel.de', 'Informatik'],
          ['about.prefLabel.en', 'Computer Science'],
          ['inLanguage', 'en'],
          ['license.id', 'https://creativecommons.org/licenses/by/4.0/'],
          ['license.prefLabel.en', 'CC BY 4.0'],
          ['keywords', subjects[i % subjects.length].toLowerCase()],
          ['datePublished', String(BASE + (50 + i) * 600)]
        ],
        '',
        BASE + (50 + i) * 600
      )
    );
  }

  // 25 kind 31922 date-based calendar events
  // NIP-52: kind 31922 uses ISO 8601 date strings (YYYY-MM-DD) for start/end
  // Track first event for comments/reactions
  let firstCalendarEvent = null;
  for (let i = 0; i < 25; i++) {
    const a = contentAuthors[i % AUTHOR_COUNT];
    const startDate = new Date((NOW + (i + 1) * 86400) * 1000); // future dates
    const event = make(
      a,
      31922,
      [
        ['d', `date-event-${i}`],
        ['title', `Date Event: ${subjects[i % subjects.length]} Workshop #${i}`],
        ['start', formatISODate(startDate)],
        ['t', 'workshop']
      ],
      `Workshop about ${subjects[i % subjects.length]}`,
      BASE + (100 + i) * 600
    );
    events.push(event);
    if (i === 0) firstCalendarEvent = event;
  }

  // 25 kind 31923 time-based calendar events
  for (let i = 0; i < 25; i++) {
    const a = contentAuthors[i % AUTHOR_COUNT];
    const startTs = NOW + (i + 30) * 86400;
    const endTs = startTs + 7200;
    events.push(
      make(
        a,
        31923,
        [
          ['d', `time-event-${i}`],
          ['title', `Time Event: ${subjects[i % subjects.length]} Lecture #${i}`],
          ['start', String(startTs)],
          ['end', String(endTs)],
          ['t', 'lecture']
        ],
        '',
        BASE + (125 + i) * 600
      )
    );
  }

  // === Date Range Test Events ===
  // These events have specific dates for testing date range filtering
  // Kind 31922 (date-based) uses ISO 8601 date strings per NIP-52
  // Kind 31923 (time-based) uses Unix timestamps per NIP-52

  const now = new Date();
  const currentMonthEnd = getEndOfCurrentMonth();
  const nextMonthStart = getStartOfNextMonth();

  // Date helpers for kind 31922 (date-based) events
  const previousMonth10th = new Date(now.getFullYear(), now.getMonth() - 1, 10);
  const currentMonth15th = new Date(now.getFullYear(), now.getMonth(), 15);
  const nextMonth6th = new Date(now.getFullYear(), now.getMonth() + 1, 6);

  // Event in the previous month (should NOT appear in current month view)
  // Kind 31922: start tag uses ISO 8601 date string per NIP-52
  events.push(
    make(
      contentAuthors[0],
      31922,
      [
        ['d', 'date-range-past-month'],
        ['title', 'Past Month Event: History Seminar'],
        ['start', formatISODate(previousMonth10th)], // e.g. "2026-02-10"
        ['t', 'daterange-test'],
        ['t', 'past-month']
      ],
      'This event was in the previous month.',
      BASE + 300 * 600
    )
  );

  // Event in the current month (should appear in current month view)
  // Kind 31922: start tag uses ISO 8601 date string per NIP-52
  events.push(
    make(
      contentAuthors[1],
      31922,
      [
        ['d', 'date-range-current-month'],
        ['title', 'Current Month Event: Science Fair'],
        ['start', formatISODate(currentMonth15th)], // e.g. "2026-03-15"
        ['t', 'daterange-test'],
        ['t', 'current-month']
      ],
      'This event is in the current month.',
      BASE + 301 * 600
    )
  );

  // Event in the next month (should NOT appear in current month view, but appear after navigation)
  // Kind 31922: start tag uses ISO 8601 date string per NIP-52
  events.push(
    make(
      contentAuthors[2],
      31922,
      [
        ['d', 'date-range-next-month'],
        ['title', 'Next Month Event: Art Exhibition'],
        ['start', formatISODate(nextMonth6th)], // e.g. "2026-04-06"
        ['t', 'daterange-test'],
        ['t', 'next-month']
      ],
      'This event is in the next month.',
      BASE + 302 * 600
    )
  );

  // Multi-day event spanning from current month to next month
  // Kind 31923 (time-based): uses Unix timestamps per NIP-52
  // Starts 2 days before month end, ends 2 days into next month
  events.push(
    make(
      contentAuthors[3],
      31923,
      [
        ['d', 'date-range-spanning-event'],
        ['title', 'Spanning Event: Multi-Day Conference'],
        ['start', String(currentMonthEnd - 2 * DAY_SECONDS)], // 2 days before month end
        ['end', String(nextMonthStart + 2 * DAY_SECONDS)], // 2 days into next month
        ['t', 'daterange-test'],
        ['t', 'spanning']
      ],
      'This event spans from the current month into the next month.',
      BASE + 303 * 600
    )
  );

  // 30 kind 10222 community definitions (one per unique keypair)
  // Community 1 gets profile-list-gated content sections for access filtering tests
  for (let i = 0; i < COMMUNITY_COUNT; i++) {
    const a = communityAuthors[i];

    if (i === 1) {
      // Community 1: gated forum (Posts) + open chat
      const profileListAddress = `30000:${a.pk}:forum-members`;
      events.push(
        make(
          a,
          10222,
          [
            ['d', ''],
            ['name', `Test Community ${i}: ${subjects[i % subjects.length]}`],
            ['about', `A gated community about ${subjects[i % subjects.length]}`],
            // Posts section (kind 11) gated by profile list
            ['content', 'Posts'],
            ['k', '11'],
            ['a', profileListAddress],
            // Chat section (kind 9) — open, no profile list
            ['content', 'Chat'],
            ['k', '9']
          ],
          JSON.stringify({
            name: `Test Community ${i}: ${subjects[i % subjects.length]}`,
            about: `A gated community about ${subjects[i % subjects.length]}`
          }),
          BASE + (150 + i) * 600
        )
      );
    } else {
      events.push(
        make(
          a,
          10222,
          [
            ['d', ''],
            ['name', `Test Community ${i}: ${subjects[i % subjects.length]}`],
            ['about', `A community about ${subjects[i % subjects.length]}`]
          ],
          JSON.stringify({
            name: `Test Community ${i}: ${subjects[i % subjects.length]}`,
            about: `A community about ${subjects[i % subjects.length]}`
          }),
          BASE + (150 + i) * 600
        )
      );
    }
  }

  // Kind 30000 profile list for community 1's forum-members gate
  // Only contentAuthors[0] (TEST_AUTHOR) is a member
  events.push(
    make(
      communityAuthors[1],
      30000,
      [
        ['d', 'forum-members'],
        ['p', contentAuthors[0].pk]
      ],
      '',
      BASE + 170 * 600
    )
  );

  // Forum threads (kind 11) targeting community 1
  // Thread from contentAuthors[0] (member) — should be visible in gated forum
  events.push(
    make(
      contentAuthors[0],
      11,
      [
        ['h', communityAuthors[1].pk],
        ['title', 'Member Thread: Welcome to the Forum']
      ],
      'This is a thread from an approved member.',
      BASE + 171 * 600
    )
  );
  // Thread from contentAuthors[1] (non-member) — should be hidden in gated forum
  events.push(
    make(
      contentAuthors[1],
      11,
      [
        ['h', communityAuthors[1].pk],
        ['title', 'Non-Member Thread: Hello World']
      ],
      'This is a thread from a non-member.',
      BASE + 172 * 600
    )
  );

  // Chat messages (kind 9) targeting community 1 — both should be visible (open section)
  events.push(
    make(
      contentAuthors[0],
      9,
      [['h', communityAuthors[1].pk]],
      'Chat from member author',
      BASE + 173 * 600
    )
  );
  events.push(
    make(
      contentAuthors[1],
      9,
      [['h', communityAuthors[1].pk]],
      'Chat from non-member author',
      BASE + 174 * 600
    )
  );

  // Kind 0 profiles for content authors
  for (let i = 0; i < AUTHOR_COUNT; i++) {
    events.push(
      make(
        contentAuthors[i],
        0,
        [],
        JSON.stringify({
          name: `Test Author ${i}`,
          about: `Bio for test author ${i}`,
          picture: `https://robohash.org/${contentAuthors[i].pk}`
        }),
        BASE + (200 + i) * 600
      )
    );
  }

  // 5 community-tagged AMB resources (kind 30142 with #h tag for community 0)
  for (let i = 0; i < 5; i++) {
    const a = contentAuthors[i % AUTHOR_COUNT];
    const name = `Community Resource: ${subjects[i % subjects.length]} #${i}`;
    events.push(
      make(
        a,
        30142,
        [
          ['d', `community-resource-${i}`],
          ['name', name],
          ['description', `Community educational resource about ${subjects[i % subjects.length]}`],
          ['h', communityAuthors[0].pk],
          ['learningResourceType.id', 'https://w3id.org/kim/hcrt/text'],
          ['learningResourceType.prefLabel.de', 'Text'],
          ['learningResourceType.prefLabel.en', 'Text'],
          ['about.id', 'https://w3id.org/kim/hochschulfaechersystematik/n01'],
          ['about.prefLabel.de', 'Informatik'],
          ['about.prefLabel.en', 'Computer Science'],
          ['inLanguage', 'en'],
          ['license.id', 'https://creativecommons.org/licenses/by/4.0/'],
          ['license.prefLabel.en', 'CC BY 4.0'],
          ['keywords', subjects[i % subjects.length].toLowerCase()],
          ['datePublished', String(BASE + (180 + i) * 600)]
        ],
        '',
        BASE + (180 + i) * 600
      )
    );
  }

  // 5 community chat messages (kind 9 with #h tag for community 0)
  for (let i = 0; i < 5; i++) {
    const a = contentAuthors[i % AUTHOR_COUNT];
    events.push(
      make(
        a,
        9,
        [['h', communityAuthors[0].pk]],
        `Hello from Test Author ${i % AUTHOR_COUNT}! Message #${i}`,
        BASE + (190 + i) * 600
      )
    );
  }

  // Kind 1 text notes for content authors (5 per author)
  for (let i = 0; i < AUTHOR_COUNT; i++) {
    for (let j = 0; j < 5; j++) {
      const noteIndex = i * 5 + j;
      events.push(
        make(
          contentAuthors[i],
          1,
          [],
          `Test note ${j} from Author ${i}: Discussing ${subjects[noteIndex % subjects.length]}`,
          BASE + (195 + noteIndex) * 600
        )
      );
    }
  }

  // Kind 0 profiles for community authors
  for (let i = 0; i < COMMUNITY_COUNT; i++) {
    events.push(
      make(
        communityAuthors[i],
        0,
        [],
        JSON.stringify({
          name: `Community Host ${i}`,
          picture: `https://robohash.org/${communityAuthors[i].pk}`
        }),
        BASE + (210 + i) * 600
      )
    );
  }

  // Comments and reactions on first calendar event (date-event-0)
  if (firstCalendarEvent) {
    const calendarEventAddress = `31922:${contentAuthors[0].pk}:date-event-0`;
    const calendarEventId = firstCalendarEvent.id;
    const calendarEventAuthor = contentAuthors[0].pk;

    // 3 kind 1111 comments (NIP-22) from authors 1, 2, 3
    const commentEvents = [];
    for (let i = 1; i <= 3; i++) {
      const author = contentAuthors[i % AUTHOR_COUNT];
      const comment = make(
        author,
        1111,
        [
          // Root scope tags (UPPERCASE) - point to original event
          ['A', calendarEventAddress, RELAY_URLS.calendar],
          ['K', '31922'],
          ['P', calendarEventAuthor, RELAY_URLS.calendar],
          // Parent scope tags (lowercase) - for top-level, same as root
          ['a', calendarEventAddress, RELAY_URLS.calendar],
          ['e', calendarEventId, RELAY_URLS.calendar],
          ['k', '31922'],
          ['p', calendarEventAuthor, RELAY_URLS.calendar]
        ],
        `This is test comment ${i} on the calendar event.`,
        BASE + (250 + i) * 600
      );
      events.push(comment);
      commentEvents.push(comment);
    }

    // 1 reply to the first comment (nested threading)
    if (commentEvents.length > 0) {
      const firstComment = commentEvents[0];
      const replyAuthor = contentAuthors[2];
      events.push(
        make(
          replyAuthor,
          1111,
          [
            // Root scope tags - still point to original calendar event
            ['A', calendarEventAddress, RELAY_URLS.calendar],
            ['K', '31922'],
            ['P', calendarEventAuthor, RELAY_URLS.calendar],
            // Parent scope tags - point to the comment being replied to
            ['e', firstComment.id, RELAY_URLS.strfry],
            ['k', '1111'], // Parent is a comment
            ['p', firstComment.pubkey, RELAY_URLS.strfry]
          ],
          'This is a reply to the first comment.',
          BASE + 254 * 600
        )
      );
    }

    // 3 kind 7 reactions (NIP-25) on the calendar event
    const reactionEmojis = ['❤️', '👍', '🎉'];
    for (let i = 0; i < 3; i++) {
      const author = contentAuthors[(i + 1) % AUTHOR_COUNT];
      events.push(
        make(
          author,
          7,
          [
            ['e', calendarEventId, RELAY_URLS.calendar, calendarEventAuthor],
            ['p', calendarEventAuthor, RELAY_URLS.calendar],
            ['a', calendarEventAddress, RELAY_URLS.calendar, calendarEventAuthor],
            ['k', '31922']
          ],
          reactionEmojis[i],
          BASE + (260 + i) * 600
        )
      );
    }
  }

  return events;
}

/** First test community info for community page E2E tests */
export const TEST_COMMUNITY = {
  pubkey: communityAuthors[0].pk,
  npub: npubEncode(communityAuthors[0].pk)
};

/** Second test community with profile-list-gated forum section */
export const TEST_COMMUNITY_GATED = {
  pubkey: communityAuthors[1].pk,
  npub: npubEncode(communityAuthors[1].pk)
};

/** First test author info for profile page E2E tests */
export const TEST_AUTHOR = {
  pubkey: contentAuthors[0].pk,
  npub: npubEncode(contentAuthors[0].pk),
  name: 'Test Author 0',
  /** Secret key as hex string for E2E login fixture */
  secretKeyHex: bytesToHex(contentAuthors[0].sk),
  /** Secret key as nsec for UI login */
  nsec: nsecEncode(contentAuthors[0].sk)
};

/** Second test author for multi-account E2E tests */
export const TEST_AUTHOR_2 = {
  pubkey: contentAuthors[1].pk,
  npub: npubEncode(contentAuthors[1].pk),
  name: 'Test Author 1',
  /** Secret key as hex string */
  secretKeyHex: bytesToHex(contentAuthors[1].sk),
  /** Secret key as nsec for UI login */
  nsec: nsecEncode(contentAuthors[1].sk)
};

/** Pre-encoded naddr strings for event detail page E2E tests.
 * Include relay hint so addressLoader knows where to fetch from. */
export const TEST_NADDRS = {
  article: naddrEncode({
    kind: 30023,
    pubkey: contentAuthors[0].pk,
    identifier: 'article-0',
    relays: [RELAY_URLS.strfry]
  }),
  calendarDate: naddrEncode({
    kind: 31922,
    pubkey: contentAuthors[0].pk,
    identifier: 'date-event-0',
    relays: [RELAY_URLS.calendar]
  }),
  calendarTime: naddrEncode({
    kind: 31923,
    pubkey: contentAuthors[0].pk,
    identifier: 'time-event-0',
    relays: [RELAY_URLS.calendar]
  }),
  amb: naddrEncode({
    kind: 30142,
    pubkey: contentAuthors[0].pk,
    identifier: 'https://example.com/resource-0',
    relays: [RELAY_URLS.amb]
  })
};

/** Event counts for test assertions */
export const TEST_COUNTS = {
  articles: 50,
  amb: 50,
  calendarDate: 25,
  calendarTime: 25,
  calendarTotal: 50,
  communities: 30,
  communityAMB: 5,
  communityChat: 5,
  notesPerAuthor: 5,
  /** Comments on first calendar event (date-event-0) */
  commentsOnCalendarEvent: 3,
  /** Replies to the first comment */
  repliesOnFirstComment: 1,
  /** Total comments including replies */
  totalCommentsOnCalendarEvent: 4,
  /** Reactions on first calendar event (date-event-0) */
  reactionsOnCalendarEvent: 3,
  /** Date range test events */
  dateRangeTestEvents: 4,
  /** Gated community forum threads (1 member + 1 non-member) */
  gatedForumThreads: 2,
  /** Gated community chat messages (both visible, open section) */
  gatedChatMessages: 2
};

/** Date range test event identifiers and titles for E2E assertions */
export const DATE_RANGE_TEST_EVENTS = {
  pastMonth: {
    identifier: 'date-range-past-month',
    title: 'Past Month Event: History Seminar',
    tag: 'past-month'
  },
  currentMonth: {
    identifier: 'date-range-current-month',
    title: 'Current Month Event: Science Fair',
    tag: 'current-month'
  },
  nextMonth: {
    identifier: 'date-range-next-month',
    title: 'Next Month Event: Art Exhibition',
    tag: 'next-month'
  },
  spanning: {
    identifier: 'date-range-spanning-event',
    title: 'Spanning Event: Multi-Day Conference',
    tag: 'spanning'
  }
};

/** naddr for date range test events */
export const DATE_RANGE_NADDRS = {
  pastMonth: naddrEncode({
    kind: 31922,
    pubkey: contentAuthors[0].pk,
    identifier: 'date-range-past-month',
    relays: [RELAY_URLS.calendar]
  }),
  currentMonth: naddrEncode({
    kind: 31922,
    pubkey: contentAuthors[1].pk,
    identifier: 'date-range-current-month',
    relays: [RELAY_URLS.calendar]
  }),
  nextMonth: naddrEncode({
    kind: 31922,
    pubkey: contentAuthors[2].pk,
    identifier: 'date-range-next-month',
    relays: [RELAY_URLS.calendar]
  }),
  spanning: naddrEncode({
    kind: 31923,
    pubkey: contentAuthors[3].pk,
    identifier: 'date-range-spanning-event',
    relays: [RELAY_URLS.calendar]
  })
};
