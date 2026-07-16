const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://popcornmovies.hf.space').replace(/\/$/, '');

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

export async function getTrendingMovies(page: number = 1, perPage: number = 20) {
  const response = await fetch(apiUrl(`/api/trending?page=${page}&perPage=${perPage}`));

  if (!response.ok) {
    throw new Error(`Backend API error: ${response.status}`);
  }

  return response.json();
}

export async function getPlayInfo(subjectId: string, se: string = '0', ep: string = '0') {
  const params = new URLSearchParams({ subjectId, se, ep });
  const response = await fetch(apiUrl(`/api/play-info?${params}`));

  if (!response.ok) {
    throw new Error(`Backend API error: ${response.status}`);
  }

  return response.json();
}

export async function searchMovies(keyword: string, page: number = 1, perPage: number = 20) {
  const params = new URLSearchParams({
    keyword,
    page: String(page),
    perPage: String(perPage),
  });
  const response = await fetch(apiUrl(`/api/search?${params}`));

  if (!response.ok) {
    throw new Error(`Backend API error: ${response.status}`);
  }

  return response.json();
}

export interface FilterState {
  genre: string;
  country: string;
  year: string;
  classify: string;
  sort: string;
}

export async function getCategoryList(channelId: string, page: number = 1, perPage: number = 20, filters?: Partial<FilterState>) {
  const params = new URLSearchParams({
    channelId,
    page: String(page),
    perPage: String(perPage),
  });

  if (filters) {
    if (filters.genre) params.append('genre', filters.genre);
    if (filters.country) params.append('country', filters.country);
    if (filters.year) params.append('year', filters.year);
    if (filters.classify) params.append('classify', filters.classify);
    if (filters.sort) params.append('sort', filters.sort);
  }

  const response = await fetch(apiUrl(`/api/list?${params}`));

  if (!response.ok) {
    throw new Error(`Backend API error: ${response.status}`);
  }

  return response.json();
}

export async function getFilterItems(tabId: string) {
  const response = await fetch(apiUrl(`/api/filter-items?tabId=${tabId}`));

  if (!response.ok) {
    throw new Error(`Backend API error: ${response.status}`);
  }

  return response.json();
}

export async function getSubjectDetails(subjectId: string, se: string = '1') {
  const response = await fetch(apiUrl(`/api/get?subjectId=${subjectId}&se=${se}`));
  if (!response.ok) throw new Error(`Backend API error: ${response.status}`);
  return response.json();
}

export async function getSeasonInfo(subjectId: string) {
  const response = await fetch(apiUrl(`/api/season-info?subjectId=${subjectId}`));
  if (!response.ok) throw new Error(`Backend API error: ${response.status}`);
  return response.json();
}

export async function getResourceLinks(subjectId: string, se: string = '1', page: number = 1, resolution: string = '0', epFrom?: string, epTo?: string) {
  const params = new URLSearchParams({
    subjectId,
    se,
    page: String(page),
    perPage: '20',
    resolution,
  });

  if (epFrom) {
    params.set('epFrom', epFrom);
    params.set('epTo', epTo || epFrom);
  }

  const response = await fetch(apiUrl(`/api/resource?${params}`));
  if (!response.ok) throw new Error(`Backend API error: ${response.status}`);
  return response.json();
}
