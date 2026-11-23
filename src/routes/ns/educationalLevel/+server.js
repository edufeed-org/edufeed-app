import {
  EDUCATIONAL_LEVEL_SCHEME,
  negotiate,
  toJsonLd,
  toTurtle,
  toHtml
} from '$lib/server/skos-namespace.js';

// Resolves https://edufeed.org/ns/educationalLevel#<concept> (the fragment
// never reaches the server): HTML for people, JSON-LD or Turtle by Accept.
/** @type {import('./$types').RequestHandler} */
export function GET({ request }) {
  const format = negotiate(request.headers.get('accept'));
  const [body, type] =
    format === 'turtle'
      ? [toTurtle(EDUCATIONAL_LEVEL_SCHEME), 'text/turtle']
      : format === 'jsonld'
        ? [JSON.stringify(toJsonLd(EDUCATIONAL_LEVEL_SCHEME), null, 2), 'application/ld+json']
        : [toHtml(EDUCATIONAL_LEVEL_SCHEME), 'text/html'];
  return new Response(body, {
    headers: {
      'content-type': `${type}; charset=utf-8`,
      vary: 'Accept',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600'
    }
  });
}
