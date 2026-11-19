/**
 * Termi skill catalogue and pure router helpers.
 *
 * This module is shared by a server route (`/api/termi`, Task 4) and the
 * chat window (Task 6) — it MUST stay importable from server code, so it
 * never imports Paraglide messages, icon components or Svelte component files.
 * Because of that, the 11 create-action ids are hardcoded below instead of
 * imported from `$lib/config/create-actions.js` (which pulls in both);
 * `termi-skills.test.js` cross-checks them against `CREATE_ACTIONS`.
 */
/**
 * @typedef {Object} TermiSkill
 * @property {string} id
 * @property {'navigate'|'create'|'help'} kind
 * @property {{ de: string[], en: string[] }} phrases
 * @property {string} [href]
 * @property {string} [actionId]
 * @property {1|2|3|4} [helpIndex]
 * @property {boolean} [requiresUser]
 */

/** @type {TermiSkill[]} */
const NAVIGATE_SKILLS = [
  {
    id: 'home',
    kind: 'navigate',
    href: '/c/',
    phrases: {
      de: [
        'Zur Startseite',
        'Geh zur Startseite',
        'Bring mich nach Hause',
        'Startseite öffnen',
        'Wie komme ich zur Startseite?'
      ],
      en: [
        'Go to the homepage',
        'Take me home',
        'Open the start page',
        'Show me the homepage',
        'How do I get to the homepage?'
      ]
    }
  },
  {
    id: 'my-content',
    kind: 'navigate',
    href: 'profile',
    requiresUser: true,
    phrases: {
      de: [
        'Wo sind meine Beiträge?',
        'Zeig mir meine Inhalte',
        'Meine Beiträge anzeigen',
        'Was habe ich veröffentlicht?',
        'Zu meinem Profil'
      ],
      en: [
        'Where are my posts?',
        'Show me my content',
        'What have I published?',
        'Take me to my profile',
        'Show my contributions'
      ]
    }
  },
  {
    id: 'bookmarks',
    kind: 'navigate',
    href: 'profile?tab=bookmarks',
    requiresUser: true,
    phrases: {
      de: [
        'Zeig meine Lesezeichen',
        'Wo sind meine gespeicherten Beiträge?',
        'Meine Bookmarks öffnen',
        'Was habe ich gespeichert?',
        'Gespeicherte Inhalte anzeigen'
      ],
      en: [
        'Show my bookmarks',
        'Where are my saved posts?',
        'Open my saved items',
        'What have I bookmarked?',
        'Show saved content'
      ]
    }
  },
  {
    id: 'calendar',
    kind: 'navigate',
    href: '/calendar',
    phrases: {
      de: [
        'Zeig mir den Kalender',
        'Was ist diese Woche los?',
        'Kalender öffnen',
        'Welche Veranstaltungen gibt es?',
        'Zum Veranstaltungskalender'
      ],
      en: [
        'Show me the calendar',
        "What's happening this week?",
        'Open the calendar',
        'What events are there?',
        'Take me to the events calendar'
      ]
    }
  },
  {
    id: 'inbox',
    kind: 'navigate',
    href: '/inbox',
    requiresUser: true,
    phrases: {
      de: [
        'Zeig mein Postfach',
        'Habe ich neue Nachrichten?',
        'Posteingang öffnen',
        "Was gibt's Neues für mich?",
        'Zu meinen Benachrichtigungen'
      ],
      en: [
        'Show my inbox',
        'Do I have new messages?',
        'Open my notifications',
        "What's new for me?",
        'Take me to my inbox'
      ]
    }
  },
  {
    id: 'settings',
    kind: 'navigate',
    href: '/settings',
    phrases: {
      de: [
        'Zu den Einstellungen',
        'Wie ändere ich meine Einstellungen?',
        'Einstellungen öffnen',
        'Wo kann ich das Theme ändern?',
        'Zeig mir meine Kontoeinstellungen'
      ],
      en: [
        'Go to settings',
        'How do I change my settings?',
        'Open settings',
        'Where can I change the theme?',
        'Show my account settings'
      ]
    }
  },
  {
    id: 'my-communities',
    kind: 'navigate',
    href: '/communities',
    phrases: {
      de: [
        'Zeig meine Communities',
        'Welchen Communities bin ich beigetreten?',
        'Meine Gruppen anzeigen',
        'Zu meinen Communities',
        'Wo finde ich meine Communities?'
      ],
      en: [
        'Show my communities',
        'Which communities have I joined?',
        'Show my groups',
        'Take me to my communities',
        'Where can I find my communities?'
      ]
    }
  }
];

/**
 * Create-action ids, hardcoded (see module docstring). Verified against
 * `CREATE_ACTIONS` by `termi-skills.test.js`.
 */
const CREATE_ACTION_PHRASES = {
  resource: {
    de: [
      'Ich möchte eine Bildungsressource erstellen',
      'Wie veröffentliche ich ein Lernmaterial?',
      'Neue Ressource anlegen',
      'Ich will ein OER teilen',
      'Erstelle eine Bildungsressource'
    ],
    en: [
      'I want to create a learning resource',
      'How do I publish learning material?',
      'Create a new resource',
      'I want to share an OER',
      'Add a new educational resource'
    ]
  },
  article: {
    de: [
      'Ich möchte einen Artikel schreiben',
      'Wie veröffentliche ich einen Blogbeitrag?',
      'Neuen Artikel erstellen',
      'Ich will einen Beitrag verfassen',
      'Artikel schreiben'
    ],
    en: [
      'I want to write an article',
      'How do I publish a blog post?',
      'Create a new article',
      'I want to write a post',
      'Write an article'
    ]
  },
  wiki: {
    de: [
      'Ich möchte einen Wiki-Artikel anlegen',
      'Wie erstelle ich eine Wiki-Seite?',
      'Neuen Wiki-Beitrag schreiben',
      'Wiki-Eintrag erstellen',
      'Ich will einen enzyklopädischen Artikel schreiben'
    ],
    en: [
      'I want to create a wiki article',
      'How do I create a wiki page?',
      'Write a new wiki entry',
      'Create a wiki page',
      'I want to write an encyclopedia-style article'
    ]
  },
  bookmark: {
    de: [
      'Ich möchte einen Link speichern',
      'Wie füge ich ein Lesezeichen hinzu?',
      'Lesezeichen erstellen',
      'Ich will eine Seite bookmarken',
      'Speichere diesen Link für mich'
    ],
    en: [
      'I want to save a link',
      'How do I add a bookmark?',
      'Create a bookmark',
      'I want to bookmark a page',
      'Save this link for me'
    ]
  },
  share: {
    de: [
      'Ich möchte einen Beitrag teilen',
      'Wie reposte ich etwas?',
      'Vorhandenen Beitrag teilen',
      'Ich will etwas weiterverbreiten',
      'Teile diesen Beitrag für mich'
    ],
    en: [
      'I want to share a post',
      'How do I repost something?',
      'Share an existing post',
      'I want to spread this content',
      'Repost this for me'
    ]
  },
  event: {
    de: [
      'Ich möchte eine Veranstaltung erstellen',
      'Wie lege ich einen Termin an?',
      'Neues Event anlegen',
      'Ich will ein Webinar ankündigen',
      'Erstelle eine Veranstaltung'
    ],
    en: [
      'I want to create an event',
      'How do I add an appointment?',
      'Add a new event',
      'I want to announce a webinar',
      'Create an event'
    ]
  },
  calendar: {
    de: [
      'Ich möchte einen eigenen Kalender anlegen',
      'Wie erstelle ich einen Veranstaltungskalender?',
      'Neuen Kalender erstellen',
      'Ich will meine Events bündeln',
      'Kalender anlegen'
    ],
    en: [
      'I want to create my own calendar',
      'How do I create an events calendar?',
      'Create a new calendar',
      'I want to bundle my events',
      'Set up a calendar'
    ]
  },
  poll: {
    de: [
      'Ich möchte eine Umfrage erstellen',
      'Wie starte ich eine Abstimmung?',
      'Neue Umfrage anlegen',
      'Ich will eine Poll starten',
      'Erstelle eine Abstimmung'
    ],
    en: [
      'I want to create a poll',
      'How do I start a vote?',
      'Add a new poll',
      'I want to start a survey',
      'Create a poll'
    ]
  },
  form: {
    de: [
      'Ich möchte ein Formular erstellen',
      'Wie lege ich ein Beitrittsformular an?',
      'Neues Formular anlegen',
      'Ich will ein Antragsformular erstellen',
      'Formular erstellen'
    ],
    en: [
      'I want to create a form',
      'How do I set up a membership form?',
      'Add a new form',
      'I want to create an application form',
      'Create a form'
    ]
  },
  note: {
    de: [
      'Ich möchte eine Notiz schreiben',
      'Wie poste ich einen kurzen Beitrag?',
      'Neue Notiz erstellen',
      'Ich will etwas kurz posten',
      'Schreibe eine Notiz'
    ],
    en: [
      'I want to write a note',
      'How do I post a short update?',
      'Create a new note',
      'I want to post something quick',
      'Write a note'
    ]
  },
  publication: {
    de: [
      'Ich möchte eine Publikation erstellen',
      'Wie veröffentliche ich eine wissenschaftliche Arbeit?',
      'Neue Publikation anlegen',
      'Ich will ein Paper veröffentlichen',
      'Erstelle eine Publikation'
    ],
    en: [
      'I want to create a publication',
      'How do I publish a scientific paper?',
      'Add a new publication',
      'I want to publish a paper',
      'Create a publication'
    ]
  }
};

/** @type {TermiSkill[]} */
const CREATE_SKILLS = Object.entries(CREATE_ACTION_PHRASES).map(([actionId, phrases]) => ({
  id: `create.${actionId}`,
  kind: 'create',
  actionId,
  phrases
}));

/** @type {TermiSkill[]} */
const HELP_SKILLS = [
  {
    id: 'help.1',
    kind: 'help',
    helpIndex: 1,
    phrases: {
      de: [
        'Was kannst du?',
        'Was kann Termi?',
        'Wobei kannst du mir helfen?',
        'Was machst du eigentlich?',
        'Zeig mir, was du kannst'
      ],
      en: [
        'What can you do?',
        'What is Termi capable of?',
        'What can you help me with?',
        'What do you actually do?',
        'Show me what you can do'
      ]
    }
  },
  {
    id: 'help.2',
    kind: 'help',
    helpIndex: 2,
    phrases: {
      de: [
        'Wie veröffentliche ich auf Nostr?',
        'Wie funktioniert das Veröffentlichen hier?',
        'Was ist Nostr überhaupt?',
        'Wie funktioniert diese Plattform?',
        'Erklär mir, wie Nostr funktioniert'
      ],
      en: [
        'How do I publish on Nostr?',
        'How does publishing work here?',
        'What even is Nostr?',
        'How does this platform work?',
        'Explain how Nostr works'
      ]
    }
  },
  {
    id: 'help.3',
    kind: 'help',
    helpIndex: 3,
    phrases: {
      de: [
        'Wie fange ich an?',
        "Ich bin neu hier, wie geht's los?",
        'Wo finde ich eine Anleitung?',
        'Wie komme ich hier zurecht?',
        'Gibt es eine Erste-Schritte-Anleitung?'
      ],
      en: [
        'How do I get started?',
        "I'm new here, where do I begin?",
        'Where can I find a guide?',
        'How do I find my way around?',
        'Is there a getting-started guide?'
      ]
    }
  },
  {
    id: 'help.4',
    kind: 'help',
    helpIndex: 4,
    phrases: {
      de: [
        'Wer bist du?',
        'Was bist du eigentlich?',
        'Bist du eine KI?',
        'Wer oder was ist Termi?',
        'Mit wem spreche ich hier?'
      ],
      en: [
        'Who are you?',
        'What are you exactly?',
        'Are you an AI?',
        'Who or what is Termi?',
        'Who am I talking to?'
      ]
    }
  }
];

/**
 * Only navigate/create/help: anything else is a content question and goes
 * to Termi's content path (tier 1 search or the `ask` chat), not the router.
 * @type {TermiSkill[]}
 */
export const TERMI_SKILLS = [...NAVIGATE_SKILLS, ...CREATE_SKILLS, ...HELP_SKILLS];

/**
 * Leading-strip regexes per locale, in priority order. The first pattern
 * that matches a leading chunk of the (trimmed) input has that chunk
 * removed; the rest is the extracted query.
 */
const LEADING_PATTERNS = {
  de: [
    /^ich\s+such(?:e)?\s+(?:nach\s+)?(?:materialien|material|ressourcen|ressource|artikel|leute|personen|jemanden)?\s*(?:zur|zu|über|nach|von|namens|mit\s+dem\s+namen)?\s*(?:(?:die|den|das|der|einen|eine)\s+)?/i,
    // Knowledge questions (scripts/fixtures/termi-questions.json)
    /^(?:wissen\s+sie,?\s+)?wer\s+(?:\S+\s+)?sich\s+(?:mit|um)\s+/i,
    /^welche\s+\S*com+unit\S*\s+(?:\S+\s+)?sich\s+mit\s+/i,
    /^welche\s+projekte\s+.*?\bim\s+bereich\s+/i,
    /^wie\s+\S+\s+(?:ich|sie|man)\s+(?:mich|sich)\s+(?:am\s+besten\s+)?(?:auf|für)\s+(?:(?:den|die|das|dem|der)\s+)?/i,
    /^suche\s+(?:nach\s+)?/i,
    /^finde\s+(?:mir\s+)?(?:materialien|material|ressourcen|ressource|artikel|leute|personen|jemanden)?\s*(?:zur|zu|über|nach|von|namens|mit\s+dem\s+namen)?\s*/i,
    /^wo\s+finde\s+ich\s+(?:leute|personen|jemanden)?\s*(?:namens|mit\s+dem\s+namen)?\s*/i,
    /^zeig(?:e)?\s+mir\s+/i
  ],
  en: [
    /^(?:i'?m\s+)?looking\s+for\s+(?:resources?|materials?|articles?|people)?\s*(?:about|on|named)?\s*(?:(?:the|an?)\s+)?/i,
    /^who\s+(?:works|is\s+working|deals)\s+(?:on|with)\s+/i,
    /^which\s+communit(?:y|ies)\s+\S+\s+(?:on|with)\s+/i,
    /^find\s+(?:resources?|materials?|articles?|people)?\s*(?:about|on|named)?\s*/i,
    /^where\s+can\s+i\s+find\s+(?:someone|people)?\s*(?:named)?\s*/i,
    /^search\s+(?:for\s+)?/i,
    /^show\s+me\s+/i
  ]
};

/** Trailing chunks of a knowledge question that are not part of the topic (de only so far). */
const TRAILING_PATTERNS = [
  /,?\s*(?:können|könnten)\s+sie\s+mir\s+helfen$/i,
  /,?\s*was\s+(?:kann|können|soll)\s+(?:ich|sie|man)\b.*$/i,
  /\s+(?:vor|durchgeführt|beschäftigt|befasst)$/i
];

/** "… zum Thema X" — X is the topic. */
const TOPIC_RE = /(?:^|\s)(?:zum|zu\s+dem|dem|das)\s+thema\s+(.+)$/i;

/** Bare filler words meaning "something"/"someone" — a leading-strip that leaves only one of these found nothing real. */
const FILLER_WORDS = new Set([
  'was',
  'etwas',
  'jemand',
  'jemanden',
  'something',
  'someone',
  'stuff'
]);

/**
 * Strip a locale-specific search lead-in ("ich suche …", "looking for …")
 * off free text, leaving the actual query.
 *
 * @param {string} text
 * @param {'de'|'en'} locale
 * @returns {string}
 */
export function extractQuery(text, locale) {
  let s = String(text ?? '').trim();
  const patterns = LEADING_PATTERNS[locale] ?? [];
  for (const re of patterns) {
    const stripped = s.replace(re, '');
    if (stripped !== s) {
      s = stripped;
      break;
    }
  }
  s = s
    .trim()
    .replace(/[?!.]+$/, '')
    .trim();
  for (const re of TRAILING_PATTERNS) s = s.replace(re, '').trim();
  s = (s.match(TOPIC_RE)?.[1] ?? s).trim();
  if (FILLER_WORDS.has(s.toLowerCase())) return '';
  return s;
}

/**
 * Which extra Termi knowledge sources a sentence asks for.
 *
 * @param {string} text
 * @returns {{ event: boolean, person: boolean, community: boolean, question: boolean }}
 */
export function questionCues(text) {
  const s = String(text ?? '');
  return {
    event:
      /fortbildung|veranstaltung|\btermin|workshop|tagung|webinar|konferenz|seminar\s+am|kurs\s+am|\bevents?\b|training/i.test(
        s
      ),
    // a quoted phrase alone is a topic ("Material zu „Klimawandel“"), not a person
    person: /\bwer\b|\bwho\b|\bnamens\b|\bnamed\b/i.test(s),
    community: /com+unit(?:y|ies)|gemeinschaft/i.test(s),
    question:
      /\b(?:wie|was|warum|wieso|weshalb|kann\s+ich|soll(?:te)?\s+ich|verbessern|tipps|how|what|why|can\s+i|should\s+i|improve)\b/i.test(
        s
      )
  };
}

/**
 * @param {string} text
 * @returns {string}
 */
function foldUmlauts(text) {
  return text.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

/** Short function/pronoun words with no discriminative value for keyword scoring. */
const STOPWORDS = new Set([
  // German
  'wo',
  'sind',
  'meine',
  'mein',
  'meinen',
  'ich',
  'ist',
  'du',
  'dein',
  'deine',
  'der',
  'die',
  'das',
  'ein',
  'eine',
  'einen',
  'und',
  'oder',
  'mit',
  'von',
  'auf',
  'im',
  'in',
  'an',
  'am',
  'bin',
  'bist',
  'es',
  'fuer',
  'um',
  'ueber',
  'nach',
  'bei',
  'sich',
  'zu',
  'dass',
  'wie',
  'mir',
  'mich',
  'dir',
  'dich',
  'was',
  'wer',
  'welche',
  'welcher',
  'gibt',
  // English
  'the',
  'a',
  'an',
  'is',
  'are',
  'my',
  'to',
  'of',
  'for',
  'do',
  'i',
  'you',
  'your',
  'me',
  'this',
  'that',
  'on',
  'at',
  'with',
  'and',
  'or',
  'am',
  'be',
  'what',
  'who',
  'which',
  'there'
]);

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return foldUmlauts(text.toLowerCase()).match(/[a-z0-9]+/g) ?? [];
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function contentTokens(text) {
  return tokenize(text).filter((/** @type {string} */ t) => !STOPWORDS.has(t));
}

/**
 * Score every skill's best phrase match (share of a phrase's non-stopword
 * tokens present in the input) and return the top 5, descending. `full`
 * marks a skill with a phrase of ≥2 content words matched completely, or one
 * the input equals word for word.
 *
 * @param {string} text
 * @param {TermiSkill[]} skills
 * @param {'de'|'en'} locale
 * @returns {Array<{ skill: string, score: number, full?: boolean }>}
 */
export function keywordMatch(text, skills, locale) {
  const inputTokens = new Set(tokenize(text));
  const sentence = tokenize(text).join(' ');
  const scored = skills.map((skill) => {
    const phrases = skill.phrases?.[locale] ?? [];
    let best = 0;
    let full = false;
    for (const phrase of phrases) {
      // The sentence IS the phrase (a chip, "Was kannst du?"): a full match however few
      // content words it has — the one-word rule below would send it to the material search.
      if (sentence && sentence === tokenize(phrase).join(' ')) {
        best = 1;
        full = true;
        continue;
      }
      const tokens = contentTokens(phrase);
      if (tokens.length === 0) continue;
      const hits = tokens.filter((t) => inputTokens.has(t)).length;
      const score = hits / tokens.length;
      if (score > best) best = score;
      // A one-word phrase ("kannst", "eigentlich") matched in full proves nothing.
      if (hits === tokens.length && tokens.length >= 2) full = true;
    }
    return full ? { skill: skill.id, score: best, full } : { skill: skill.id, score: best };
  });
  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * Filter the catalogue down to what this user may currently use.
 *
 * @param {TermiSkill[]} skills
 * @param {{ loggedIn: boolean }} ctx
 * @returns {TermiSkill[]}
 */
export function availableSkills(skills, { loggedIn }) {
  return skills.filter((skill) => !skill.requiresUser || loggedIn);
}

/**
 * Score thresholds of the embed path (the keyword path decides on full
 * phrases, see `decide`). Still the initial values — the embed path hasn't
 * been run through `scripts/termi-eval.js` against the real service yet.
 */
export const THRESHOLDS = {
  embed: { CONFIDENT: 0.82, MAYBE: 0.72, MARGIN: 0.05 }
};

/**
 * Turn ranked matches into a routing decision.
 *
 * Keyword mode counts only multi-word catalogue phrases matched in full:
 * exactly one such skill = confident, several = maybe, none = `none` (the
 * content path). Partial overlap ("termine", "wer") would otherwise let a
 * navigate/create/help skill capture a content question.
 *
 * @param {Array<{ skill: string, score: number, full?: boolean }>} matches
 * @param {{ mode: 'embed'|'keyword' }} opts
 * @returns {{ kind: 'confident', skill: string } | { kind: 'maybe', skills: string[] } | { kind: 'none' }}
 */
export function decide(matches, { mode }) {
  if (!matches || matches.length === 0) return { kind: 'none' };
  const sorted = [...matches].sort((a, b) => b.score - a.score);
  if (mode === 'keyword') {
    const full = sorted.filter((m) => m.full);
    if (full.length === 1) return { kind: 'confident', skill: full[0].skill };
    if (full.length > 1) return { kind: 'maybe', skills: full.slice(0, 3).map((m) => m.skill) };
    return { kind: 'none' };
  }
  const t = THRESHOLDS.embed;
  const [top, second] = sorted;
  const clearLead = !second || top.score - second.score >= t.MARGIN;
  if (top.score >= t.CONFIDENT && clearLead) {
    return { kind: 'confident', skill: top.skill };
  }
  if (top.score >= t.MAYBE) {
    const skills = sorted
      .filter((m) => m.score >= t.MAYBE)
      .slice(0, 3)
      .map((m) => m.skill);
    return { kind: 'maybe', skills };
  }
  return { kind: 'none' };
}
