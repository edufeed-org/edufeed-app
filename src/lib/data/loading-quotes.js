/**
 * Loading screen quotes — shown while the app initializes.
 * Real quotes with attribution, keyed by language.
 * Add new quotes or languages here.
 */
export const loadingQuotes = {
  de: [
    {
      text: 'Bildung ist die mächtigste Waffe, die du verwenden kannst, um die Welt zu verändern.',
      author: 'Nelson Mandela'
    },
    {
      text: 'Wer aufhört zu lernen, ist alt. Er mag zwanzig oder achtzig sein.',
      author: 'Henry Ford'
    },
    {
      text: 'Der Verstand ist kein Gefäß, das gefüllt, sondern ein Feuer, das entzündet werden will.',
      author: 'Plutarch'
    },
    {
      text: 'Ich habe keine besondere Begabung, sondern bin nur leidenschaftlich neugierig.',
      author: 'Albert Einstein'
    },
    {
      text: 'Lernen ist Erfahrung. Alles andere ist einfach nur Information.',
      author: 'Albert Einstein'
    },
    {
      text: 'Erziehung ist organisierte Verteidigung der Erwachsenen gegen die Jugend.',
      author: 'Mark Twain'
    },
    {
      text: 'Man kann einen Menschen nichts lehren, man kann ihm nur helfen, es in sich selbst zu entdecken.',
      author: 'Galileo Galilei'
    },
    {
      text: 'Das Ziel der Erziehung ist nicht, den Geist zu füllen, sondern ihn zu öffnen.',
      author: 'Aristoteles'
    },
    {
      text: 'Das Geheimnis des Vorwärtskommens ist, den ersten Schritt zu tun.',
      author: 'Mark Twain'
    },
    { text: 'Neugier ist die wichtigste Eigenschaft eines Gebildeten.', author: 'Marie Curie' }
  ],
  en: [
    {
      text: 'Education is the most powerful weapon which you can use to change the world.',
      author: 'Nelson Mandela'
    },
    {
      text: 'Anyone who stops learning is old, whether at twenty or eighty.',
      author: 'Henry Ford'
    },
    {
      text: 'The mind is not a vessel to be filled, but a fire to be kindled.',
      author: 'Plutarch'
    },
    {
      text: 'I have no special talent. I am only passionately curious.',
      author: 'Albert Einstein'
    },
    {
      text: 'Learning is experience. Everything else is just information.',
      author: 'Albert Einstein'
    },
    { text: 'Education is the organized defense of adults against youth.', author: 'Mark Twain' },
    {
      text: 'You cannot teach a man anything; you can only help him find it within himself.',
      author: 'Galileo Galilei'
    },
    { text: 'The aim of education is not to fill the mind, but to open it.', author: 'Aristotle' },
    { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    {
      text: 'Curiosity is the most important quality of an educated person.',
      author: 'Marie Curie'
    }
  ]
};

/**
 * Pick a random quote for the given language.
 * Falls back to English if language not found.
 * @param {string} lang
 * @returns {{ text: string, author: string }}
 */
export function getRandomQuote(lang) {
  const list = loadingQuotes[/** @type {keyof typeof loadingQuotes} */ (lang)] || loadingQuotes.en;
  return list[Math.floor(Math.random() * list.length)];
}
