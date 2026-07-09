import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { isPdfResponse, extractPdfContent } from '$lib/helpers/pdfExtractor.js';
import { extractMetadataFromHtml } from '$lib/server/metadataExtraction.js';
import { isHedgedocPage, extractHedgedocArticle } from '$lib/helpers/hedgedocExtractor.js';
import { parseHttpUrl, fetchGuardedRedirects } from '$lib/server/httpUrl.js';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const FETCH_TIMEOUT = 10_000;

/**
 * @param {URL} parsedUrl
 * @returns {boolean}
 */
function isPrivateIp(parsedUrl) {
  const hostname = parsedUrl.hostname;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('172.') ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local')
  );
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ url }) {
  const articleUrl = url.searchParams.get('url');
  const mode = url.searchParams.get('mode'); // 'metadata' for AMB/OG extraction; default = full Readability

  if (!articleUrl) {
    return Response.json({ success: false, error: 'Missing url parameter' }, { status: 400 });
  }

  const parsedUrl = parseHttpUrl(articleUrl);
  if (!parsedUrl) {
    return Response.json(
      { success: false, error: 'URL must be a valid http or https URL' },
      { status: 400 }
    );
  }

  if (isPrivateIp(parsedUrl)) {
    return Response.json(
      { success: false, error: 'Private/local URLs are not allowed' },
      { status: 400 }
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetchGuardedRedirects(articleUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html, application/pdf',
        'User-Agent': 'Mozilla/5.0 (compatible; ReaderBot/1.0)'
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return Response.json(
        { success: false, error: `Fetch failed with status ${response.status}` },
        { status: 502 }
      );
    }

    // Metadata mode + PDF: short-circuit. PDFs carry no AMB JSON-LD or Open
    // Graph (those live in HTML <head>), so there's nothing to extract here —
    // and the size cap below would otherwise reject any PDF >5MB before the
    // wizard could fall through to the AI-enrich path that knows how to
    // handle large PDFs.
    if (mode === 'metadata' && isPdfResponse(response.headers, articleUrl)) {
      return Response.json(
        { success: true, metadata: { source: 'none' } },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_SIZE) {
      return Response.json({ success: false, error: 'Content too large' }, { status: 502 });
    }

    // PDF branch
    if (isPdfResponse(response.headers, articleUrl)) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_SIZE) {
        return Response.json({ success: false, error: 'Content too large' }, { status: 502 });
      }

      const pdfArticle = await extractPdfContent(buffer);

      if (!pdfArticle.textContent) {
        return Response.json(
          { success: false, error: 'Could not extract text from PDF (may be image-only)' },
          { status: 422 }
        );
      }

      return Response.json(
        {
          success: true,
          article: {
            title: pdfArticle.title,
            content: pdfArticle.content,
            textContent: pdfArticle.textContent,
            byline: pdfArticle.byline,
            siteName: parsedUrl.hostname
          }
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=3600'
          }
        }
      );
    }

    // HTML branch
    const html = await response.text();
    if (html.length > MAX_SIZE) {
      return Response.json({ success: false, error: 'Content too large' }, { status: 502 });
    }

    // Metadata-only branch: skip Readability, extract AMB JSON-LD or Open Graph
    if (mode === 'metadata') {
      const metadata = extractMetadataFromHtml(html);
      return Response.json(
        { success: true, metadata },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    const { document } = parseHTML(html);

    // HedgeDoc serves raw markdown as text inside #doc.markdown-body and
    // relies on client-side JS to render it. Detect that and render the
    // markdown ourselves before falling through to Readability.
    if (isHedgedocPage(document)) {
      const hedgedocArticle = extractHedgedocArticle(document, parsedUrl);
      if (hedgedocArticle) {
        return Response.json(
          { success: true, article: hedgedocArticle },
          { headers: { 'Cache-Control': 'public, max-age=3600' } }
        );
      }
    }

    const reader = new Readability(document);
    const article = reader.parse();

    if (!article) {
      return Response.json(
        { success: false, error: 'Could not extract article content' },
        { status: 422 }
      );
    }

    return Response.json(
      {
        success: true,
        article: {
          title: article.title,
          content: article.content,
          textContent: article.textContent,
          byline: article.byline,
          siteName: article.siteName
        }
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600'
        }
      }
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return Response.json({ success: false, error: 'Fetch timed out' }, { status: 504 });
    }
    return Response.json({ success: false, error: 'Failed to process article' }, { status: 502 });
  }
}
