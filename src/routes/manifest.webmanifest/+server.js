import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';

export function GET() {
  const appName = env.APP_NAME || 'ComCal';

  return json({
    name: appName,
    short_name: appName,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#E9570D',
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png'
      }
    ]
  });
}
