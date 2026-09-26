// Vercel Edge Function: /api/stream
// Proxies media CDN requests, adding CORS headers for browser HLS.js compatibility.
// Usage: /api/stream?url=<encoded_cdn_url>&cookie=<encoded_cookie_value>

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');
  const cookie = searchParams.get('cookie') || '';

  if (!targetUrl) {
    return new Response('Missing url param', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  // Only allow hakunaymatata CDN domains for security
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response('Invalid url', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  if (!parsed.hostname.endsWith('hakunaymatata.com')) {
    return new Response('Forbidden domain', { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://mzfi.me/',
    'Origin': 'https://mzfi.me',
    'x-requested-with': 'com.community.oneroom',
  };

  if (cookie) {
    headers['Cookie'] = decodeURIComponent(cookie);
  }

  if (req.headers.get('range')) {
    headers['Range'] = req.headers.get('range');
  }

  try {
    const upstream = await fetch(targetUrl, { method: req.method, headers });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
