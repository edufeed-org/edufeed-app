/**
 * Server-side proxy for LiveKit token requests.
 * Avoids CORS issues when the app is accessed through tunnels or different origins.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { operatorUrl, room, community } = body;
  if (!operatorUrl || !room || !community) {
    return json(
      { error: 'Missing required fields: operatorUrl, room, community' },
      { status: 400 }
    );
  }

  const endpoint = `${operatorUrl.replace(/\/$/, '')}/token`;
  const authHeader = request.headers.get('Authorization');

  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const operatorBody = JSON.stringify({ room, community });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: operatorBody
    });
  } catch (err) {
    return json(
      {
        error: `Failed to reach operator: ${err instanceof Error ? err.message : 'unknown error'}`
      },
      { status: 502 }
    );
  }

  const text = await response.text();

  if (!response.ok) {
    return json(
      { error: `Operator returned ${response.status}: ${text}` },
      { status: response.status }
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return json({ error: 'Invalid JSON from operator' }, { status: 502 });
  }

  if (!data.token || !data.url) {
    return json({ error: 'Operator response missing required fields' }, { status: 502 });
  }

  // When running behind a tunnel, rewrite the LiveKit URL to use the tunnel origin
  // so the browser connects via Vite's WebSocket proxy instead of unreachable localhost
  if (env.TUNNEL && data.url) {
    try {
      const livekitUrl = new URL(data.url);
      if (livekitUrl.hostname === 'localhost' || livekitUrl.hostname === '127.0.0.1') {
        const appOrigin = new URL(request.url);
        // Only rewrite when accessed via tunnel — localhost can reach LiveKit directly
        if (appOrigin.hostname !== 'localhost' && appOrigin.hostname !== '127.0.0.1') {
          data.url = `wss://${appOrigin.host}/livekit-ws`;
        }
      }
    } catch {
      // If URL parsing fails, return the original url unchanged
    }
  }

  return json(data);
}
