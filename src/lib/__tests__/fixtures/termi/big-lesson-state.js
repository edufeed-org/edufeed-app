// A realistic phase-5 lesson state (~4.5 KB): over the 4 KB patch cap, under the 16 KB state cap.
const naddr = (/** @type {number} */ n) => `naddr1${'q'.repeat(70)}${'acdefgh'[n % 7]}`;

export const bigLessonState = () => ({
  phase: 5,
  frame: {
    subject: 'Mathematik',
    grade: 4,
    state: 'Nordrhein-Westfalen',
    schoolType: 'Grundschule',
    lessons: 8,
    minutes: 45,
    topic: 'Brüche als Teile eines Ganzen'
  },
  competences: Array.from({ length: 12 }, (_, i) => ({
    uri: `https://w3id.org/lehrplan/nrw/gs/mathe/kompetenz-${i + 1}`,
    label: `Kompetenz ${i + 1}: Brüche darstellen, vergleichen und begründen`
  })),
  didactics: {
    phasing: 'Einstieg, Erarbeitung, Sicherung',
    methods: ['Think-Pair-Share', 'Stationenlernen', 'Lerntheke'],
    differentiation: 'gestufte Hilfen'
  },
  plan: Array.from({ length: 8 }, (_, i) => ({
    n: i + 1,
    goal: `Stunde ${i + 1}: Die Lernenden deuten Brüche an Alltagsbeispielen und begründen ihre Wahl.`,
    phases: ['Einstieg mit Bildimpuls', 'Erarbeitung in Partnerarbeit', 'Sicherung im Plenum']
  })),
  parts: {
    lessons: Array.from({ length: 8 }, (_, i) => ({
      n: i + 1,
      title: `Stunde ${i + 1}`,
      naddr: naddr(i)
    }))
  }
});
