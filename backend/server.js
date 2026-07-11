import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3001);
const SECRET_KEY = '76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O';

const API_BASE_HEADERS = {
  'x-play-mode': '2',
  'x-family-mode': '0',
  'x-content-mode': '0',
  'x-client-status': '1',
  'X-Forwarded-For': '103.119.165.10',
  'X-Real-IP': '103.119.165.10',
  'CF-Connecting-IP': '103.119.165.10',
  authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjIxNTM1NzgzMjg0NjMxMzY1OTIsImV4cCI6MTc5MTM1OTY0OCwiaWF0IjoxNzgzNTgzMzQ4fQ.piIbpdfhG3t8rz7rRFssiO3eqHtq6der3nOyzTyh9XU',
  'x-client-info': '{"package_name":"com.community.mbox.in","version_name":"3.0.11.1230.03","version_code":50020080,"os":"android","os_version":"14","install_ch":"google-play","device_id":"70556139be024c59d04661c0a2502499","install_store":"gp","gaid":"1a8144c7-c3b6-4d10-a57e-7aaace20211d","brand":"OnePlus","model":"HD1910","system_language":"en","net":"NETWORK_WIFI","region":"IN","timezone":"Asia/Kolkata","sp_code":"","X-Play-Mode":"2","X-Family-Mode":"0","X-Content-Mode":"0"}',
};

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function generateSignature(method, url, body = null, accept = '', contentType = '') {
  const timestamp = Date.now().toString();
  const contentLength = body ? Buffer.byteLength(body).toString() : '0';
  const bodyMd5Hex = body
    ? crypto.createHash('md5').update(body.slice(0, 102400)).digest('hex').toLowerCase()
    : '';

  const urlObj = new URL(url, 'https://apii.inmoviebox.com');
  const keys = Array.from(urlObj.searchParams.keys()).sort();
  const sortedQuery = keys.length
    ? `?${keys.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(urlObj.searchParams.get(key) || '')}`).join('&')}`
    : '';

  const signatureString = [
    method.toUpperCase(),
    accept,
    contentType,
    contentLength === '0' ? '' : contentLength,
    timestamp,
    bodyMd5Hex,
    `${urlObj.pathname}${sortedQuery}`,
  ].join('\n');

  const hmac = crypto.createHmac('md5', Buffer.from(SECRET_KEY, 'base64')).update(signatureString).digest('base64');
  return `${timestamp}|2|${hmac}`;
}

async function movieBoxRequest(method, path, bodyObject = null) {
  const body = bodyObject ? JSON.stringify(bodyObject) : null;
  const accept = 'application/json';
  const contentType = body ? 'application/json; charset=utf-8' : '';
  const signature = generateSignature(method, path, body, accept, contentType);

  const response = await fetch(`https://apii.inmoviebox.com${path}`, {
    method,
    headers: {
      ...API_BASE_HEADERS,
      accept,
      'user-agent': 'okhttp/4.12.0',
      'x-tr-signature': signature,
      ...(body ? { 'content-type': contentType } : {}),
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`MovieBox API error ${response.status} on ${path}:`, text);
    throw new Error(`MovieBox API error: ${response.status}`);
  }

  return response.json();
}

async function tryMovieBoxRequest(method, path, bodyObject = null) {
  try {
    return await movieBoxRequest(method, path, bodyObject);
  } catch (error) {
    console.warn(`MovieBox fallback failed for ${method} ${path}:`, error.message);
    return null;
  }
}

function extractSearchSubjects(payload) {
  const data = payload?.data || {};
  const candidates = [];

  const addItem = (item) => {
    if (!item) return;
    if (Array.isArray(item.subjects)) {
      item.subjects.forEach(addItem);
      return;
    }
    candidates.push(item.subject || item);
  };

  [
    data.results,
    data.items,
    data.subjects,
    data.list,
  ].forEach((collection) => {
    if (Array.isArray(collection)) {
      collection.forEach(addItem);
    }
  });

  const seen = new Set();
  return candidates.filter((subject) => {
    const id = subject?.id || subject?.subjectId || subject?.title;
    if (!id || seen.has(String(id))) return false;
    seen.add(String(id));
    return true;
  });
}

function proxyMediaRequest(req, res, routePrefix, authParams = '') {
  const rawUrl = req.url || '';
  const mediaPath = rawUrl.slice(routePrefix.length).replace(/^\/+/, '');
  const [pathWithHost, query = ''] = mediaPath.split('?');
  const [host, ...pathParts] = pathWithHost.split('/');
  
  const allQueries = [query, authParams].filter(Boolean).join('&');
  const queryParams = new URLSearchParams(allQueries);
  let cookieHeader = '';
  
  if (queryParams.has('Auth')) {
    cookieHeader = queryParams.get('Auth');
    queryParams.delete('Auth');
  }

  const finalQuery = queryParams.toString();
  const path = `/${pathParts.join('/')}${finalQuery ? `?${finalQuery}` : ''}`;

  if (!host || pathParts.length === 0 || !/^[a-z0-9.-]+$/i.test(host)) {
    res.writeHead(400, { 'access-control-allow-origin': '*' });
    res.end('Invalid CDN URL');
    return;
  }

  const headers = { 'user-agent': 'okhttp/4.12.0' };
  if (req.headers.range) {
    headers.range = req.headers.range;
  }
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const upstream = https.request({ hostname: host, path, method: req.method, headers }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, {
      ...upstreamRes.headers,
      'access-control-allow-origin': '*',
    });
    upstreamRes.pipe(res);
  });

  upstream.on('error', (error) => {
    res.writeHead(502, { 'access-control-allow-origin': '*' });
    res.end(`CDN proxy error: ${error.message}`);
  });

  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/trending') {
      const page = url.searchParams.get('page') || '1';
      const perPage = url.searchParams.get('perPage') || '20';
      const payload = await movieBoxRequest('POST', '/wefeed-mobile-bff/subject-api/trending/v2', {
        deepLink: '',
        disablePlaylist: true,
        latest_events: [],
        page,
        perPage,
      });
      const items = payload.data?.items || [];
      json(res, 200, items.filter((item) => item.type === 1).map((item) => item.subject));
      return;
    }

    if (url.pathname === '/api/play-info') {
      const subjectId = url.searchParams.get('subjectId');
      const se = url.searchParams.get('se') || '0';
      const ep = url.searchParams.get('ep') || '0';

      if (!subjectId) {
        json(res, 400, { error: 'subjectId is required' });
        return;
      }

      const payload = await movieBoxRequest('GET', `/wefeed-mobile-bff/subject-api/play-info?subjectId=${encodeURIComponent(subjectId)}&se=${encodeURIComponent(se)}&ep=${encodeURIComponent(ep)}`);
      const streams = payload.data?.streams || [];
      json(res, 200, streams.map((stream) => ({
        ...stream,
        title: stream.title || payload.data?.title || '',
      })));
      return;
    }

    if (url.pathname === '/api/search') {
      const keyword = (url.searchParams.get('keyword') || url.searchParams.get('key') || '').trim();
      const page = Number(url.searchParams.get('page') || 1);
      const perPage = Number(url.searchParams.get('perPage') || 20);

      if (!keyword) {
        json(res, 200, []);
        return;
      }

      const encodedKeyword = encodeURIComponent(keyword);
      const attempts = [
        () => tryMovieBoxRequest('POST', '/wefeed-mobile-bff/subject-api/search/v2', { page, perPage, keyword }),
        () => tryMovieBoxRequest('POST', '/wefeed-mobile-bff/subject-api/search/v2', { page, perPage, key: keyword }),
        () => tryMovieBoxRequest('GET', `/wefeed-mobile-bff/subject-api/search/v2?keyword=${encodedKeyword}&page=${page}&perPage=${perPage}`),
        () => tryMovieBoxRequest('GET', `/wefeed-mobile-bff/subject-api/search/v2?key=${encodedKeyword}&page=${page}&perPage=${perPage}`),
        () => tryMovieBoxRequest('GET', `/wefeed-mobile-bff/subject-api/search?keyword=${encodedKeyword}&page=${page}&perPage=${perPage}`),
      ];

      for (const attempt of attempts) {
        const payload = await attempt();
        if (!payload) continue;

        const subjects = extractSearchSubjects(payload);
        if (subjects.length > 0) {
          json(res, 200, subjects);
          return;
        }
      }

      json(res, 200, []);
      return;
    }

    if (url.pathname === '/api/filter-items') {
      const tabId = url.searchParams.get('tabId') || '2';
      const payload = await movieBoxRequest('GET', `/wefeed-mobile-bff/subject-api/filter-items?tabId=${tabId}&filterItemVer=v3`);
      json(res, 200, payload.data?.typeList || []);
      return;
    }

    if (url.pathname === '/api/list') {
      const channelId = url.searchParams.get('channelId');
      if (!channelId) {
        json(res, 400, { error: 'channelId is required' });
        return;
      }
      const page = Number(url.searchParams.get('page') || 1);
      const perPage = Number(url.searchParams.get('perPage') || 20);
      
      const bodyObj = {
        page,
        perPage,
        channelId,
        country: url.searchParams.get('country') || "All",
        year: url.searchParams.get('year') || "All",
        rate: ["0", "10"],
        sort: url.searchParams.get('sort') || "ForYou"
      };

      if (channelId === "1" || channelId === "2" || channelId === "0") {
          bodyObj.classify = url.searchParams.get('classify') || "All";
          bodyObj.genre = url.searchParams.get('genre') || "All";
      }
      
      const payload = await movieBoxRequest('POST', '/wefeed-mobile-bff/subject-api/list', bodyObj);
      json(res, 200, payload.data?.items || []);
      return;
    }

    if (url.pathname === '/api/get') {
      const subjectId = url.searchParams.get('subjectId');
      const se = url.searchParams.get('se') || '1';
      const payload = await movieBoxRequest('GET', `/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}&se=${se}`);
      json(res, 200, payload.data || {});
      return;
    }

    if (url.pathname === '/api/season-info') {
      const subjectId = url.searchParams.get('subjectId');
      const payload = await movieBoxRequest('GET', `/wefeed-mobile-bff/subject-api/season-info?subjectId=${subjectId}`);
      json(res, 200, payload.data || {});
      return;
    }

    if (url.pathname === '/api/resource') {
      const subjectId = url.searchParams.get('subjectId');
      const se = url.searchParams.get('se') || '1';
      const page = url.searchParams.get('page') || '1';
      const perPage = url.searchParams.get('perPage') || '20';
      const resolution = url.searchParams.get('resolution') || '0';
      const epFrom = url.searchParams.get('epFrom') || '1';
      const epTo = url.searchParams.get('epTo') || epFrom;
      const payload = await movieBoxRequest('GET', `/wefeed-mobile-bff/subject-api/resource?subjectId=${subjectId}&page=${page}&perPage=${perPage}&all=0&startPosition=1&endPosition=1&pagerMode=0&resolution=${resolution}&se=${se}&epFrom=${epFrom}&epTo=${epTo}`);
      json(res, 200, payload.data || {});
      return;
    }

    if (url.pathname.startsWith('/cdn/')) {
      proxyMediaRequest(req, res, '/cdn');
      return;
    }

    if (url.pathname.startsWith('/vlc/')) {
      const [, , encodedAuth = ''] = url.pathname.split('/');
      let authParams = '';
      try {
        authParams = encodedAuth ? Buffer.from(decodeURIComponent(encodedAuth), 'base64url').toString('utf8') : '';
      } catch {
        res.writeHead(400, { 'access-control-allow-origin': '*' });
        res.end('Invalid VLC auth');
        return;
      }

      req.url = req.url?.replace(`/vlc/${encodedAuth}`, '/vlc') || req.url;
      proxyMediaRequest(req, res, '/vlc', authParams);
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    json(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`MovieBox backend running on http://localhost:${PORT}`);
});
