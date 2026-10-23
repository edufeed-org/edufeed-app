/** @type {import('./$types').RequestHandler} */
export function GET({ url }) {
  // Allow everything (as the former static/robots.txt did) and point crawlers
  // at the sitemap of whichever origin serves this deployment.
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${url.origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}
