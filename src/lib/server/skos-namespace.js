/**
 * The document behind the concept URIs this app mints
 * (`https://edufeed.org/ns/educationalLevel#erwachsenenbildung`): one small
 * SKOS scheme, served as HTML, JSON-LD or Turtle by `/ns/educationalLevel`.
 * The concepts are the ones the resource form offers, so the two cannot drift.
 */
import { BILDUNGSBEREICHE } from '$lib/helpers/educational/bildungsbereich.js';

/**
 * @typedef {{ id: string, labels: Record<string, string>, definition?: Record<string, string>, closeMatch?: string[] }} NsConcept
 * @typedef {{ id: string, title: Record<string, string>, description: Record<string, string>, concepts: NsConcept[] }} NsScheme
 */

/** @type {NsScheme} */
export const EDUCATIONAL_LEVEL_SCHEME = {
  id: 'https://edufeed.org/ns/educationalLevel',
  title: { de: 'Bildungsstufen (edufeed-Ergänzung)', en: 'Educational levels (edufeed additions)' },
  description: {
    de: 'Bildungsstufen, die in der KIM-Liste https://w3id.org/kim/educationalLevel/ fehlen. Sie gelten, bis es dort ein passendes Konzept gibt.',
    en: 'Educational levels missing from the KIM list https://w3id.org/kim/educationalLevel/. They apply until that list has a fitting concept.'
  },
  concepts: Object.values(BILDUNGSBEREICHE).flatMap(
    (b) => /** @type {NsConcept[]} */ (b.extraEducationalLevels ?? [])
  )
};

const SKOS = 'http://www.w3.org/2004/02/skos/core#';

/**
 * @param {string | null} accept
 * @returns {'html' | 'jsonld' | 'turtle'}
 */
export function negotiate(accept) {
  // shortcut: first listed type wins, q-values ignored; upgrade if a client needs them
  for (const part of (accept ?? '').split(',')) {
    const type = part.split(';')[0].trim().toLowerCase();
    if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
    if (type === 'text/turtle') return 'turtle';
    if (type === 'application/ld+json' || type === 'application/json') return 'jsonld';
  }
  return 'html';
}

/** @param {NsScheme} scheme */
export function toJsonLd(scheme) {
  return {
    '@context': {
      id: '@id',
      type: '@type',
      '@vocab': SKOS,
      dct: 'http://purl.org/dc/terms/',
      title: { '@id': 'dct:title', '@container': '@language' },
      description: { '@id': 'dct:description', '@container': '@language' },
      prefLabel: { '@container': '@language' },
      definition: { '@container': '@language' },
      inScheme: { '@type': '@id' },
      topConceptOf: { '@type': '@id' },
      hasTopConcept: { '@type': '@id' },
      closeMatch: { '@type': '@id' }
    },
    '@graph': [
      {
        id: scheme.id,
        type: 'ConceptScheme',
        title: scheme.title,
        description: scheme.description,
        hasTopConcept: scheme.concepts.map((c) => c.id)
      },
      ...scheme.concepts.map((c) => ({
        id: c.id,
        type: 'Concept',
        prefLabel: c.labels,
        ...(c.definition && Object.keys(c.definition).length ? { definition: c.definition } : {}),
        inScheme: scheme.id,
        topConceptOf: scheme.id,
        ...(c.closeMatch?.length ? { closeMatch: c.closeMatch } : {})
      }))
    ]
  };
}

/** @param {Record<string, string>} byLang */
const literals = (byLang) =>
  Object.entries(byLang)
    .map(([lang, v]) => `${JSON.stringify(v)}@${lang}`)
    .join(', ');

/** @param {NsScheme} scheme */
export function toTurtle(scheme) {
  const lines = [
    `@prefix skos: <${SKOS}> .`,
    '@prefix dct: <http://purl.org/dc/terms/> .',
    '',
    `<${scheme.id}> a skos:ConceptScheme ;`,
    `  dct:title ${literals(scheme.title)} ;`,
    `  dct:description ${literals(scheme.description)} ;`,
    `  skos:hasTopConcept ${scheme.concepts.map((c) => `<${c.id}>`).join(', ')} .`
  ];
  for (const c of scheme.concepts) {
    lines.push('', `<${c.id}> a skos:Concept ;`, `  skos:prefLabel ${literals(c.labels)} ;`);
    if (c.definition && Object.keys(c.definition).length) {
      lines.push(`  skos:definition ${literals(c.definition)} ;`);
    }
    if (c.closeMatch?.length) {
      lines.push(`  skos:closeMatch ${c.closeMatch.map((u) => `<${u}>`).join(', ')} ;`);
    }
    lines.push(`  skos:topConceptOf <${scheme.id}> ;`, `  skos:inScheme <${scheme.id}> .`);
  }
  return lines.join('\n') + '\n';
}

/** @param {string} s */
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** @param {NsScheme} scheme */
export function toHtml(scheme) {
  const concepts = scheme.concepts
    .map((c) => {
      const fragment = c.id.split('#')[1] ?? '';
      const labels = Object.entries(c.labels)
        .map(([lang, v]) => `<li><span lang="${esc(lang)}">${esc(v)}</span> (${esc(lang)})</li>`)
        .join('');
      const definition = Object.entries(c.definition ?? {})
        .map(([lang, v]) => `<p lang="${esc(lang)}">${esc(v)}</p>`)
        .join('');
      const matches = (c.closeMatch ?? [])
        .map((u) => `<li>skos:closeMatch <a href="${esc(u)}">${esc(u)}</a></li>`)
        .join('');
      return `<section id="${esc(fragment)}">
<h2>${esc(c.labels.de ?? Object.values(c.labels)[0] ?? fragment)}</h2>
<p><code>${esc(c.id)}</code></p>
<ul>${labels}</ul>
${definition}
<ul>${matches}</ul>
</section>`;
    })
    .join('\n');
  // "<" escaped so a label can never close the script element
  const jsonLd = JSON.stringify(toJsonLd(scheme), null, 2).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(scheme.title.de)}</title>
<link rel="alternate" type="application/ld+json" href="${esc(scheme.id)}">
<link rel="alternate" type="text/turtle" href="${esc(scheme.id)}">
<script type="application/ld+json">
${jsonLd}
</script>
<style>body{font-family:system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;line-height:1.5}code{word-break:break-all}section{border-top:1px solid #ccc;margin-top:2rem}</style>
</head>
<body>
<h1>${esc(scheme.title.de)}</h1>
<p><code>${esc(scheme.id)}</code> · SKOS ConceptScheme</p>
<p lang="de">${esc(scheme.description.de)}</p>
<p lang="en">${esc(scheme.description.en)}</p>
<p>Maschinenlesbar mit dem Accept-Header <code>application/ld+json</code> oder <code>text/turtle</code>.</p>
${concepts}
</body>
</html>
`;
}
