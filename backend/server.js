import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3001);

const H5_API_HOST = 'h5-api.aoneroom.com';
const PLAY_HOST = 'mzfi.me';

const H5_BEARER = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjE3NDY1MjA1NDk3NjIyNTQwOCwiYXRwIjozLCJleHQiOiIxNzkwMzQwODc3IiwiZXhwIjoxNzk4MTE2ODc3LCJpYXQiOjE3OTAzNDA1Nzd9.cokOaNK7176VnQo3kn3euB7_KLSawRGifTAy6ROvSjc';

// Cache the live play domain fetched from media-player/get-domain
let _playHost = 'mzfi.me';
let _playHostFetchedAt = 0;
async function getPlayHost() {
  if (Date.now() - _playHostFetchedAt < 6 * 3600 * 1000) return _playHost;
  try {
    const r = await fetch('https://h5-api.aoneroom.com/wefeed-h5api-bff/media-player/get-domain', { headers: H5_HEADERS, signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d?.data) { _playHost = new URL(d.data).hostname; _playHostFetchedAt = Date.now(); }
  } catch { /* keep last known */ }
  return _playHost;
}

const H5_HEADERS = {
  authorization: H5_BEARER,
  'x-client-info': '{"timezone":"Asia/Calcutta"}',
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  origin: 'https://mzfi.me',
  referer: 'https://mzfi.me/',
};

function json(res, statusCode, payload) {
  if (res.headersSent) return;
  try {
    const data = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    res.end(data);
  } catch (err) {
    console.error('json serialization error:', err);
    if (!res.headersSent) {
      res.writeHead(500, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}

async function h5Request(path, options = {}) {
  const { method = 'GET', body = null, host = H5_API_HOST } = options;
  const url = `https://${host}${path}`;
  const headers = { ...H5_HEADERS };
  if (body) headers['content-type'] = 'application/json; charset=utf-8';
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const text = await response.text();
    console.warn(`H5 API ${method} ${url} -> ${response.status}:`, text.slice(0, 200));
    throw new Error(`H5 API error ${response.status}`);
  }
  return response.json();
}

async function tryH5Request(path, options = {}) {
  try { return await h5Request(path, options); }
  catch (e) { console.warn('H5 request failed:', e.message); return null; }
}

function normaliseSubject(s) { return s; }

function extractSearchItems(payload) {
  if (!payload?.data?.items) return [];
  return payload.data.items.map(normaliseSubject).filter(Boolean);
}

function proxyMediaRequest(req, res, routePrefix, authParams = '') {
  const rawUrl = req.url || '';
  const mediaPath = rawUrl.slice(routePrefix.length).replace(/^\/+/, '');
  const [pathWithHost, query = ''] = mediaPath.split('?');
  const [host, ...pathParts] = pathWithHost.split('/');
  const allQueries = [query, authParams].filter(Boolean).join('&');
  const queryParams = new URLSearchParams(allQueries);
  let cookieHeader = '';
  if (queryParams.has('Auth')) { cookieHeader = queryParams.get('Auth'); queryParams.delete('Auth'); }
  if (queryParams.has('Policy') && queryParams.has('Signature')) {
    cookieHeader = ['Policy', 'Signature', 'Key-Pair-Id'].filter(k => queryParams.has(k)).map(k => `CloudFront-${k}=${queryParams.get(k)}`).join('; ');
    ['Policy', 'Signature', 'Key-Pair-Id'].forEach(k => queryParams.delete(k));
  }
  if (queryParams.has('Edge-Cache-Cookie')) { cookieHeader = queryParams.get('Edge-Cache-Cookie'); queryParams.delete('Edge-Cache-Cookie'); }
  const finalQuery = queryParams.toString();
  const path = `/${pathParts.join('/')}${finalQuery ? `?${finalQuery}` : ''}`;
  if (!host || pathParts.length === 0 || !/^[a-z0-9.-]+(:[0-9]+)?$/i.test(host)) {
    res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end('Invalid CDN URL'); return;
  }
  const [hostname, portStr] = host.split(':');
  const isHttps = !portStr || portStr === '443';
  const port = portStr ? parseInt(portStr, 10) : (isHttps ? 443 : 80);
  const reqLib = isHttps ? https : http;
  const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'accept': '*/*', 'accept-language': 'en-US,en;q=0.9' };
  if (host.includes('macdn') || host.includes('hakunaymatata') || host.includes('bcdnxw') || host.includes('sbcdn') || host.includes('pbcdn') || host.includes('cacdn')) {
    headers['user-agent'] = 'Mozilla/5.0 (Linux; Android 14; V2229A Build/UQ1A.240205.06031531; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Safari/537.36';
    headers.referer = 'https://movieboxhd.net/';
    headers['origin'] = 'https://movieboxhd.net';
    headers['x-requested-with'] = 'com.community.oneroom';
  }
  if (req.headers.range) headers.range = req.headers.range;
  if (cookieHeader) headers.Cookie = cookieHeader;
  const upstream = reqLib.request({ hostname, port, path, method: req.method, headers }, (upstreamRes) => {
    const isM3u8 = path.split('?')[0].endsWith('.m3u8');
    if (isM3u8 && allQueries && upstreamRes.statusCode === 200) {
      let body = ''; upstreamRes.setEncoding('utf8');
      upstreamRes.on('data', chunk => body += chunk);
      upstreamRes.on('end', () => {
        const rewritten = body.split('\n').map(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            if (allQueries && !trimmed.includes(allQueries.split('&')[0])) return `${trimmed}${trimmed.includes('?') ? '&' : '?'}${allQueries}`;
            return trimmed;
          }
          return line;
        }).join('\n');
        const resHeaders = { ...upstreamRes.headers, 'access-control-allow-origin': '*' };
        delete resHeaders['content-length'];
        res.writeHead(200, resHeaders); res.end(rewritten);
      });
    } else {
      res.writeHead(upstreamRes.statusCode || 502, { ...upstreamRes.headers, 'access-control-allow-origin': '*' });
      upstreamRes.pipe(res);
    }
  });
  upstream.on('error', (error) => { res.writeHead(502, { 'access-control-allow-origin': '*' }); res.end(`CDN proxy error: ${error.message}`); });
  req.pipe(upstream);
}

let iptvCache = { data: null, timestamp: 0 };

function parseM3uUrls(m3uText) {
  const lines = m3uText.split('\n'); const map = new Map(); let currentId = '';
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('#EXTINF:')) { const match = line.match(/tvg-id="([^"]*)"/); currentId = match ? match[1] : ''; }
    else if (line && !line.startsWith('#')) { if (currentId) { if (!map.has(currentId)) map.set(currentId, []); map.get(currentId).push(line); currentId = ''; } }
  }
  return map;
}

async function getIptvChannels() {
  if (iptvCache.data && Date.now() - iptvCache.timestamp < 12 * 3600 * 1000) return iptvCache.data;
  try {
    const [chanRes, streamRes, m3uRes] = await Promise.all([
      fetch('https://iptv-org.github.io/api/channels.json'),
      fetch('https://iptv-org.github.io/api/streams.json'),
      fetch('https://iptv-org.github.io/iptv/countries/in.m3u').catch(() => null),
    ]);
    const channels = await chanRes.json(); const streams = await streamRes.json();
    const m3uText = m3uRes ? await m3uRes.text() : ''; const m3uMap = m3uText ? parseM3uUrls(m3uText) : new Map();
    const streamMap = new Map();
    for (const s of streams) { if (s.channel && s.url && !s.status) { if (!streamMap.has(s.channel)) streamMap.set(s.channel, []); streamMap.get(s.channel).push(s.url); } }
    const merged = [];
    for (const c of channels) {
      if (c.is_nsfw) continue;
      let urlList = streamMap.get(c.id) || []; const m3uUrls = m3uMap.get(c.id) || [];
      for (const mu of m3uUrls) { if (!urlList.includes(mu)) urlList.push(mu); }
      if (urlList.length === 0) continue;
      merged.push({ id: c.id, name: c.name, logo: c.logo || '', country: c.country || 'GLOBAL', categories: c.categories || [], url: urlList[0], backupUrls: urlList.slice(1), quality: '' });
    }
    iptvCache = { data: merged, timestamp: Date.now() }; return merged;
  } catch (e) { console.error('Failed to fetch IPTV org data:', e); return iptvCache.data || []; }
}

const server = http.createServer(async (req, res) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
      res.end(); return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/trending') {
      const page = url.searchParams.get('page') || '1';
      const perPage = url.searchParams.get('perPage') || '20';
      const tabId = url.searchParams.get('tabId') || 'ONEROOM_MOVIE';
      const payload = await h5Request(`/wefeed-h5api-bff/subject/trending?tabId=${tabId}&page=${page}&perPage=${perPage}`);
      json(res, 200, payload?.data?.subjectList || []);
      return;
    }

    if (url.pathname === '/api/play-info') {
      const subjectId = url.searchParams.get('subjectId');
      let se = url.searchParams.get('se') || '0';
      let ep = url.searchParams.get('ep') || '0';
      const detailPath = url.searchParams.get('detailPath') || '';
      if (!subjectId) { json(res, 400, { error: 'subjectId is required' }); return; }
      
      const playHost = await getPlayHost();
      const refPath = detailPath ? `https://${playHost}/spa/videoPlayPage/movies/${detailPath}` : `https://${playHost}/`;
      const playHeaders = { ...H5_HEADERS, origin: `https://${playHost}`, referer: refPath };

      const fetchPlay = async (s, e) => {
        const qs = new URLSearchParams({ subjectId, se: String(s), ep: String(e), streamSignType: '1', 'supportCodecs[h264]': '1' });
        if (detailPath) qs.set('detailPath', detailPath);
        const playRes = await fetch(`https://${playHost}/wefeed-h5api-bff/subject/play?${qs.toString()}`, { headers: playHeaders, signal: AbortSignal.timeout(10000) });
        if (!playRes.ok) return null;
        return playRes.json();
      };

      let payload = await fetchPlay(se, ep);
      let data = payload?.data || {};
      let totalStreams = (data.streams || []).length + (data.dash || []).length;

      // If se=0 ep=0 returned 0 streams, fallback to se=1 ep=1 (series default)
      if (totalStreams === 0 && se === '0' && ep === '0') {
        const fallbackPayload = await fetchPlay('1', '1');
        if (fallbackPayload?.data) {
          data = fallbackPayload.data;
        }
      }

      // Filter out H.265/HEVC streams — browsers cannot decode them
      const isHevc = (s) => /h265|hevc/i.test(s.codec || '') || /\/h265\//i.test(s.url || '');
      const mp4Streams = (data.streams || [])
        .filter(s => !isHevc(s))
        .map(s => ({ ...s, format: s.format || 'MP4', title: s.title || '' }));
      const dashStreams = (data.dash || [])
        .filter(s => !isHevc(s))
        .map(s => ({ ...s, format: 'DASH', title: s.title || '' }));
      // Fallback: if H.264 filter leaves 0 streams, return all (let player handle it)
      const allStreams = mp4Streams.length + dashStreams.length > 0
        ? [...mp4Streams, ...dashStreams]
        : [...(data.streams || []), ...(data.dash || [])];
      json(res, 200, {
        streams: allStreams,
        subtitles: data.subtitles || [],
        captions: data.captions || [],
        audioList: data.audioList || [],
        title: data.title || '',
        hls: data.hls || [],
        vipLocked: data.vipLocked || false,
        playConfig: data.playConfig || {},
      });
      return;
    }

    if (url.pathname === '/api/search') {
      const keyword = (url.searchParams.get('keyword') || url.searchParams.get('key') || '').trim();
      const page = Number(url.searchParams.get('page') || 1);
      const perPage = Number(url.searchParams.get('perPage') || 20);
      const subjectType = Number(url.searchParams.get('type') || 0);
      if (!keyword) { json(res, 200, []); return; }
      const payload = await tryH5Request('/wefeed-h5api-bff/subject/search', {
        method: 'POST', body: JSON.stringify({ keyword, page, perPage, subjectType }),
      });
      json(res, 200, payload ? extractSearchItems(payload) : []);
      return;
    }

    if (url.pathname === '/api/filter-items') {
      const tabId = url.searchParams.get('tabId') || '2';
      const subjectType = tabId === '1' ? 1 : tabId === '2' || tabId === '5' ? 2 : 0;
      const genres = ['All','Action','Adventure','Animation','Biography','Comedy','Crime','Documentary','Drama','Family','Fantasy','History','Horror','Music','Mystery','Romance','Sci-Fi','Thriller','War','Western'].map(id => ({ id, name: id }));
      const countries = ['All','United States','United Kingdom','Korea','Japan','India','China','France','Germany','Spain','Italy','Turkey','Thailand'].map(id => ({ id, name: id }));
      const years = ['All','2026','2025','2024','2023','2022','2021','2020','2010s','2000s','1990s','1980s'].map(id => ({ id, name: id }));
      const sorts = [{ id: 'ForYou', name: 'ForYou' }, { id: 'Hottest', name: 'Hottest' }, { id: 'Latest', name: 'Latest' }];
      const classifies = [{ id: 'All', name: 'All' }, { id: 'Hindi dub', name: 'Hindi dub' }];

      const typeList = [{
        subjectType, channelId: subjectType,
        channelName: subjectType === 1 ? 'Movie' : subjectType === 2 ? 'TV Show' : 'All',
        items: [
          { filterType: 'genre', title: 'Genre', filterVals: genres, showOut: true, filterValsV2: genres },
          { filterType: 'country', title: 'Country', filterVals: countries, showOut: true, filterValsV2: countries },
          { filterType: 'year', title: 'Year', filterVals: years, showOut: true, filterValsV2: years },
          { filterType: 'sort', title: 'Sort by', filterVals: sorts, showOut: false, filterValsV2: sorts },
          { filterType: 'classify', title: 'Classify', filterVals: classifies, showOut: true, filterValsV2: classifies },
        ],
      }];
      json(res, 200, typeList);
      return;
    }

    if (url.pathname === '/api/list') {
      console.log(`[/api/list] request params:`, url.search);
      const rawChannelId = url.searchParams.get('channelId');
      const page = Number(url.searchParams.get('page') || 1);
      const perPage = Number(url.searchParams.get('perPage') || 20);
      const sort = url.searchParams.get('sort');
      const genre = url.searchParams.get('genre');
      const country = url.searchParams.get('country');
      const year = url.searchParams.get('year');
      const classify = url.searchParams.get('classify');

      let channelId = 0;
      if (rawChannelId === '1') channelId = 1;
      else if (rawChannelId === '2') channelId = 2;
      else if (rawChannelId === '1006' || rawChannelId === '8') channelId = 1006;
      else if (rawChannelId) channelId = Number(rawChannelId);

      const filterBody = {
        channelId,
        page,
        perPage,
      };
      if (genre && genre !== 'All') filterBody.genre = genre;
      if (country && country !== 'All') filterBody.country = country;
      if (year && year !== 'All') filterBody.year = year;
      if (sort && sort !== 'All') filterBody.sort = sort;
      if (classify && classify !== 'All') filterBody.classify = classify;

      console.log(`[/api/list] calling tryH5Request with:`, filterBody);
      const payload = await tryH5Request('/wefeed-h5api-bff/subject/filter', {
        method: 'POST',
        body: JSON.stringify(filterBody),
      });
      console.log(`[/api/list] got payload:`, payload?.code, 'items:', payload?.data?.items?.length);

      let items = payload?.data?.items || [];
      // Fallback to trending if filter items were empty and channel is movie/0
      if (items.length === 0 && (channelId === 0 || channelId === 1) && !genre && !country && !year) {
        const trendPayload = await tryH5Request(`/wefeed-h5api-bff/subject/trending?tabId=ONEROOM_MOVIE&page=${page}&perPage=${perPage}`);
        items = trendPayload?.data?.subjectList || [];
      }

      // Ensure each item has both top-level and .subject compatibility and both id and subjectId (no circular refs)
      const formatted = items.map(it => {
        const id = it.id || it.subjectId;
        const copy = { ...it, id, subjectId: id };
        if (!copy.subject) {
          copy.subject = {
            id,
            subjectId: id,
            title: it.title,
            cover: it.cover,
            releaseDate: it.releaseDate,
            genre: it.genre,
            rate: it.imdbRatingValue || it.rate,
          };
        }
        return copy;
      });

      json(res, 200, formatted);
      return;
    }

    if (url.pathname === '/api/get') {
      const subjectId = url.searchParams.get('subjectId');
      const detailPath = url.searchParams.get('detailPath') || '';
      if (!subjectId && !detailPath) { json(res, 400, { error: 'subjectId or detailPath is required' }); return; }
      const qs = detailPath ? `detailPath=${encodeURIComponent(detailPath)}` : `subjectId=${encodeURIComponent(subjectId)}`;
      const payload = await h5Request(`/wefeed-h5api-bff/detail?${qs}`);
      json(res, 200, payload?.data?.subject || payload?.data || {});
      return;
    }

    if (url.pathname === '/api/season-info') {
      const subjectId = url.searchParams.get('subjectId');
      const detailPath = url.searchParams.get('detailPath') || '';
      const qs = detailPath ? `detailPath=${encodeURIComponent(detailPath)}` : `subjectId=${encodeURIComponent(subjectId)}`;
      const payload = await h5Request(`/wefeed-h5api-bff/detail?${qs}`);
      const subject = payload?.data?.subject || {};
      const resource = payload?.data?.resource || {};
      const rawSeasons = (resource.seasons && resource.seasons.length > 0) ? resource.seasons : (subject.seasons || []);
      const seasons = rawSeasons.map(s => ({
        se: Number(s.se) || 1,
        maxEp: Number(s.maxEp) || (Array.isArray(s.episodes) ? s.episodes.length : 1),
      }));

      let episodes = [];
      if (Array.isArray(subject.episodes) && subject.episodes.length > 0) {
        episodes = subject.episodes;
      } else {
        for (const s of seasons) {
          for (let ep = 1; ep <= s.maxEp; ep++) {
            episodes.push({ ep, se: s.se, title: `Episode ${ep}` });
          }
        }
      }

      json(res, 200, {
        subjectId: subject.subjectId || subjectId,
        seasons,
        episodes,
        seNum: seasons.length || subject.seNum || 1,
      });
      return;
    }

    if (url.pathname === '/api/resource') {
      const subjectId = url.searchParams.get('subjectId');
      const se = Number(url.searchParams.get('se') || '1');
      const detailPath = url.searchParams.get('detailPath') || '';
      if (subjectId && se > 0) {
        const qs = detailPath ? `detailPath=${encodeURIComponent(detailPath)}` : `subjectId=${encodeURIComponent(subjectId)}`;
        const payload = await tryH5Request(`/wefeed-h5api-bff/detail?${qs}`);
        const resource = payload?.data?.resource || {};
        const subject = payload?.data?.subject || {};
        const rawSeasons = (resource.seasons && resource.seasons.length > 0) ? resource.seasons : (subject.seasons || []);
        const targetSeason = rawSeasons.find(s => Number(s.se) === se) || rawSeasons[0];
        const maxEp = Number(targetSeason?.maxEp) || 1;
        const list = Array.from({ length: maxEp }, (_, i) => ({
          ep: i + 1,
          se,
          title: `Episode ${i + 1}`,
          resourceId: `${subjectId}-${se}-${i + 1}`,
          resolution: '1080',
        }));
        json(res, 200, { list, total: list.length, page: 1 });
        return;
      }
      json(res, 200, { list: [], total: 0, page: 1 });
      return;
    }

    if (url.pathname === '/api/caption') {
      const id = url.searchParams.get('id');
      const subjectId = url.searchParams.get('subjectId');
      const detailPath = url.searchParams.get('detailPath') || '';
      const format = url.searchParams.get('format') || 'DASH';
      if (!id || !subjectId) { json(res, 400, { error: 'id and subjectId are required' }); return; }
      const qs = new URLSearchParams({ format, id, subjectId });
      if (detailPath) qs.set('detailPath', detailPath);
      const payload = await h5Request(`/wefeed-h5api-bff/subject/caption?${qs.toString()}`);
      json(res, 200, payload?.data || {});
      return;
    }

    if (url.pathname === '/api/livetv/channels') {
      const category = (url.searchParams.get('category') || '').toLowerCase();
      const country = (url.searchParams.get('country') || '').toUpperCase();
      const keyword = (url.searchParams.get('keyword') || url.searchParams.get('search') || '').toLowerCase();
      const page = Number(url.searchParams.get('page') || 1);
      const perPage = Number(url.searchParams.get('perPage') || 40);
      const all = await getIptvChannels(); let filtered = all;
      if (category && category !== 'all' && category !== 'top') filtered = filtered.filter(c => c.categories.some(cat => cat.toLowerCase().includes(category)));
      if (country && country !== 'ALL' && country !== 'GLOBAL') filtered = filtered.filter(c => c.country === country);
      if (keyword) filtered = filtered.filter(c => c.name.toLowerCase().includes(keyword) || c.id.toLowerCase().includes(keyword));
      const total = filtered.length; const start = (page - 1) * perPage;
      json(res, 200, { items: filtered.slice(start, start + perPage), total, page, perPage });
      return;
    }

    if (url.pathname === '/api/sports/aggregate') {
      const leagueId = url.searchParams.get('leagueId');
      const response = await fetch(`https://h5-sport-api.aoneroom.com/wefeed-h5api-bff/sport/aggregate-v1?leagueId=${leagueId}`);
      json(res, 200, await response.json()); return;
    }

    if (url.pathname === '/api/sports/match-list') {
      const leagueId = url.searchParams.get('leagueId');
      const response = await fetch(`https://h5-sport-api.aoneroom.com/wefeed-h5api-bff/live/match-list-v5?leagueId=${leagueId}`);
      json(res, 200, await response.json()); return;
    }

    if (url.pathname === '/api/sports/server2') {
      const titleQuery = url.searchParams.get('title') || '';
      try {
        const htmlRes = await fetch('https://home.redjoytv.nz/', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
        const setCookie = htmlRes.headers.get('set-cookie'); let cookie = '';
        if (setCookie) cookie = setCookie.split(';')[0];
        const html = await htmlRes.text();
        const scriptStart = html.indexOf('(function(g){'); const scriptEnd = html.indexOf('</script>', scriptStart);
        if (scriptStart === -1 || scriptEnd === -1) return json(res, 400, { error: 'Could not find script block' });
        const inlineScript = html.substring(scriptStart, scriptEnd);
        const sandbox = { atob: global.atob };
        const executeScript = new Function('global', 'window', inlineScript);
        executeScript(sandbox, sandbox);
        const aesKeyStr = sandbox._rjtK; const csrfToken = sandbox._rjtT;
        if (!aesKeyStr || !csrfToken) return json(res, 400, { error: 'Could not extract Redjoy keys' });
        const eventsRes = await fetch('https://home.redjoytv.nz/api.php?action=events', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://home.redjoytv.nz/', 'x-csrf-token': csrfToken, Cookie: cookie } });
        const eventsData = await eventsRes.json();
        if (!eventsData.enc || !eventsData.iv) return json(res, 400, { error: 'No enc/iv found in events payload' });
        const keyBuffer = Buffer.from(aesKeyStr, 'utf-8'); const ivBuffer = Buffer.from(eventsData.iv, 'hex'); const encryptedData = Buffer.from(eventsData.enc, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, ivBuffer);
        let decrypted = decipher.update(encryptedData, undefined, 'utf8'); decrypted += decipher.final('utf8');
        const parsed = JSON.parse(decrypted);
        const team1 = titleQuery.split(' vs')[0].trim();
        const event = (parsed.events || []).find(e => e.title.includes(team1) || team1.includes(e.title.split(' vs')[0]));
        if (!event) return json(res, 404, { error: 'Match not found on Server 2 (or not live yet)' });
        const keysRes = await fetch(`https://home.redjoytv.nz/api.php?action=keys&gti=${encodeURIComponent(event.gti)}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://home.redjoytv.nz/', 'x-csrf-token': csrfToken, Cookie: cookie } });
        const keysData = await keysRes.json();
        if (!keysData.enc || !keysData.iv) return json(res, 400, { error: keysData.error || 'Failed to fetch keys' });
        const keysIvBuffer = Buffer.from(keysData.iv, 'hex'); const keysEncryptedData = Buffer.from(keysData.enc, 'base64');
        const keysDecipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, keysIvBuffer);
        let keysDecrypted = keysDecipher.update(keysEncryptedData, undefined, 'utf8'); keysDecrypted += keysDecipher.final('utf8');
        return json(res, 200, JSON.parse(keysDecrypted));
      } catch (err) { console.error(err); return json(res, 500, { error: err.message }); }
    }

    if (url.pathname.startsWith('/cdn/')) { proxyMediaRequest(req, res, '/cdn'); return; }
    if (url.pathname.startsWith('/proxy/')) { proxyMediaRequest(req, res, '/proxy'); return; }

    if (url.pathname.startsWith('/vlc/')) {
      const [, , encodedAuth = ''] = url.pathname.split('/');
      let authParams = '';
      try { authParams = encodedAuth ? Buffer.from(decodeURIComponent(encodedAuth), 'base64url').toString('utf8') : ''; }
      catch { res.writeHead(400, { 'access-control-allow-origin': '*' }); res.end('Invalid VLC auth'); return; }
      req.url = req.url?.replace(`/vlc/${encodedAuth}`, '/vlc') || req.url;
      proxyMediaRequest(req, res, '/vlc', authParams);
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    if (!res.headersSent) {
      json(res, 500, { error: error.message || 'Server error' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`MovieBox backend running on http://localhost:${PORT}`);
});
