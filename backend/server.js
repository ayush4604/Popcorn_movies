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
  authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjI4NDg1OTU5ODM2MTU4MDkzNjAsImV4cCI6MTc5MTk3MTUxOSwiaWF0IjoxNzg0MTk1MjE5fQ.nXRWygmT0f8CiTtf_Zqmy5saaMPN3CBr7fwyiHXPnrs',
  'x-client-info': '{"package_name":"com.community.mbox.in","version_name":"3.0.11.1230.03","version_code":50020080,"os":"android","os_version":"14","install_ch":"google-play","device_id":"15f62e1851f5cdfaf95325122eeb52cb","install_store":"gp","gaid":"eff84d42-340f-4e5b-a56d-4e48d91393ae","brand":"vivo","model":"V2229A","system_language":"en","net":"NETWORK_WIFI","region":"US","timezone":"Asia/Kolkata","sp_code":"","X-Play-Mode":"2","X-Family-Mode":"0","X-Content-Mode":"0"}',
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
      'user-agent': 'com.community.mbox.in/50020080 (Linux; U; Android 14; en_US; V2229A; Build/UQ1A.240205.06031531; Cronet/126.0.6452.4)',
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
    
    if (queryParams.has('Policy') && queryParams.has('Signature')) {
      cookieHeader = ['Policy', 'Signature', 'Key-Pair-Id']
        .filter(k => queryParams.has(k))
        .map(k => `CloudFront-${k}=${queryParams.get(k)}`)
        .join('; ');
      ['Policy', 'Signature', 'Key-Pair-Id'].forEach(k => queryParams.delete(k));
    }

  const finalQuery = queryParams.toString();
  const path = `/${pathParts.join('/')}${finalQuery ? `?${finalQuery}` : ''}`;

  if (!host || pathParts.length === 0 || !/^[a-z0-9.-]+$/i.test(host)) {
    res.writeHead(400, { 'access-control-allow-origin': '*' });
    res.end('Invalid CDN URL');
    return;
  }

  const headers = { 'user-agent': host.includes('macdn') ? 'Mozilla/5.0 (Linux; Android 14; V2229A Build/UQ1A.240205.06031531; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Safari/537.36' : 'Dalvik/2.1.0 (Linux; U; Android 14; V2229A Build/UQ1A.240205.06031531)' }; if (host.includes('macdn')) { headers.referer = 'https://sportsnow.top/'; headers['x-requested-with'] = 'com.community.mbox.in'; }
  if (req.headers.range) {
    headers.range = req.headers.range;
  }
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const upstream = https.request({ hostname: host, path, method: req.method, headers }, (upstreamRes) => {
    const isM3u8 = path.split('?')[0].endsWith('.m3u8');
    if (isM3u8 && allQueries && upstreamRes.statusCode === 200) {
      let body = '';
      upstreamRes.setEncoding('utf8');
      upstreamRes.on('data', chunk => body += chunk);
      upstreamRes.on('end', () => {
        const rewritten = body.split('\n').map(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            if (allQueries && !trimmed.includes(allQueries.split('&')[0])) {
               return `${trimmed}${trimmed.includes('?') ? '&' : '?'}${allQueries}`;
            }
            return trimmed;
          }
          return line;
        }).join('\n');
        const resHeaders = { ...upstreamRes.headers, 'access-control-allow-origin': '*' };
        delete resHeaders['content-length'];
        res.writeHead(200, resHeaders);
        res.end(rewritten);
      });
    } else {
      res.writeHead(upstreamRes.statusCode || 502, {
        ...upstreamRes.headers,
        'access-control-allow-origin': '*',
      });
      upstreamRes.pipe(res);
    }
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

      const payload = await tryMovieBoxRequest('POST', '/wefeed-mobile-bff/subject-api/search/v2', { page, perPage, keyword });

      if (payload) {
        const subjects = extractSearchSubjects(payload);
        json(res, 200, subjects);
      } else {
        json(res, 200, []);
      }
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

    if (url.pathname === '/api/sports/aggregate') {
      const leagueId = url.searchParams.get('leagueId');
      const response = await fetch(`https://h5-sport-api.aoneroom.com/wefeed-h5api-bff/sport/aggregate-v1?leagueId=${leagueId}`);
      const payload = await response.json();
      json(res, 200, payload);
      return;
    }

    if (url.pathname === '/api/sports/match-list') {
      const leagueId = url.searchParams.get('leagueId');
      const response = await fetch(`https://h5-sport-api.aoneroom.com/wefeed-h5api-bff/live/match-list-v5?leagueId=${leagueId}`);
      const payload = await response.json();
      json(res, 200, payload);
      return;
    }

    if (url.pathname === '/api/sports/server2') {
      const titleQuery = url.searchParams.get('title') || '';
      
      try {
        const htmlRes = await fetch('https://home.redjoytv.nz/', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const setCookie = htmlRes.headers.get('set-cookie');
        let cookie = '';
        if (setCookie) cookie = setCookie.split(';')[0];
        const html = await htmlRes.text();
        
        const scriptStart = html.indexOf('(function(g){');
        const scriptEnd = html.indexOf('</script>', scriptStart);
        if (scriptStart === -1 || scriptEnd === -1) {
           return json(res, 400, { error: 'Could not find script block' });
        }
        let inlineScript = html.substring(scriptStart, scriptEnd);
        
        const sandbox = { atob: global.atob };
        const executeScript = new Function('global', 'window', inlineScript);
        executeScript(sandbox, sandbox);
        
        const aesKeyStr = sandbox._rjtK;
        const csrfToken = sandbox._rjtT;
        
        if (!aesKeyStr || !csrfToken) {
           return json(res, 400, { error: 'Could not extract Redjoy keys' });
        }
        
        const eventsRes = await fetch('https://home.redjoytv.nz/api.php?action=events', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://home.redjoytv.nz/',
            'x-csrf-token': csrfToken,
            'Cookie': cookie
          }
        });
        const eventsData = await eventsRes.json();
        if (!eventsData.enc || !eventsData.iv) {
           return json(res, 400, { error: 'No enc/iv found in events payload' });
        }
        
        const keyBuffer = Buffer.from(aesKeyStr, 'utf-8');
        const ivBuffer = Buffer.from(eventsData.iv, 'hex');
        const encryptedData = Buffer.from(eventsData.enc, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, ivBuffer);
        let decrypted = decipher.update(encryptedData, undefined, 'utf8');
        decrypted += decipher.final('utf8');
        const parsed = JSON.parse(decrypted);
        
        // Find matching event
        const team1 = titleQuery.split(' vs')[0].trim();
        const event = (parsed.events || []).find((e) => e.title.includes(team1) || team1.includes(e.title.split(' vs')[0]));
        if (!event) {
           return json(res, 404, { error: 'Match not found on Server 2 (or not live yet)' });
        }
        
        const keysRes = await fetch(`https://home.redjoytv.nz/api.php?action=keys&gti=${encodeURIComponent(event.gti)}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://home.redjoytv.nz/',
            'x-csrf-token': csrfToken,
            'Cookie': cookie
          }
        });
        const keysData = await keysRes.json();
        if (!keysData.enc || !keysData.iv) {
           return json(res, 400, { error: keysData.error || 'Failed to fetch keys' });
        }
        
        const keysIvBuffer = Buffer.from(keysData.iv, 'hex');
        const keysEncryptedData = Buffer.from(keysData.enc, 'base64');
        const keysDecipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, keysIvBuffer);
        let keysDecrypted = keysDecipher.update(keysEncryptedData, undefined, 'utf8');
        keysDecrypted += keysDecipher.final('utf8');
        const parsedKeys = JSON.parse(keysDecrypted);
        
        return json(res, 200, parsedKeys);
      } catch (err) {
        console.error(err);
        return json(res, 500, { error: err.message });
      }
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
