import React, { useState, useEffect, useRef } from 'react'
import { getPlayInfo, searchMovies, getCategoryList, getFilterItems, getSubjectDetails, getSeasonInfo, getResourceLinks } from './api'
import type { FilterState } from './api'
// @ts-ignore
import { MediaPlayer } from 'dashjs'
import './index.css'

const BACKEND_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function backendUrl(path: string): string {
  return `${BACKEND_BASE_URL}${path}`;
}

interface PlayingVideo {
  url: string;
  authParams: string;
  streams: any[];
  streamIndex: number;
  startTime?: number;
}

interface VlcFallback {
  title: string;
  format: string;
  resolution: string;
  directUrl: string;
  vlcUrl: string;
  browserStream?: any;
  streamIndex?: number;
  allStreams?: any[];
  subjectId?: string;
  se?: string;
  ep?: string;
}

type MenuName = 'language' | 'quality' | 'subtitle' | null;
type DetailTab = 'episodes' | 'details' | 'more';

type DownloadLink = {
  label: string;
  url: string;
  filename?: string;
}

function toProxiedCdnUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    const backendOrigin = BACKEND_BASE_URL || window.location.origin;
    if (parsed.origin === backendOrigin || !parsed.hostname.includes('hakunaymatata.com')) {
      return url;
    }

    return `${backendOrigin}/cdn/${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function appendAuthParams(url: string, authParams: string): string {
  if (!authParams || url.includes('Policy=')) {
    return url;
  }

  return `${url}${url.includes('?') ? '&' : '?'}${authParams}`;
}

function getAuthParams(stream: any): string {
  if (!stream.signCookie) {
    return '';
  }

  return stream.signCookie
    .split(';')
    .filter(Boolean)
    .map((cookie: string) => cookie.trim().replace('CloudFront-', ''))
    .join('&');
}

function toBase64Url(value: string): string {
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function toVlcProxyUrl(url: string, authParams: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    const authToken = toBase64Url(authParams);
    const backendOrigin = BACKEND_BASE_URL || window.location.origin;
    return `${backendOrigin}/vlc/${authToken}/${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch {
    return appendAuthParams(toProxiedCdnUrl(url), authParams);
  }
}

function isHevcStream(stream: any): boolean {
  const codec = String(stream.codecName || stream.codec || '').toLowerCase();
  if (codec) {
    return codec.includes('hevc') || codec.includes('h265') || codec.includes('hev1');
  }

  const format = String(stream.format || '').toLowerCase();
  return format.includes('hevc') || format.includes('h265') || format.includes('hev1');
}

function getStreamScore(stream: any): number {
  const format = String(stream.format || '').toLowerCase();
  const resolution = parseInt(String(stream.resolutions || '').split(',')[0], 10) || 0;
  const isMp4 = format === 'mp4' || stream.url?.includes('.mp4');

  return (isMp4 ? 10000 : 0) + resolution;
}

function getStreamLabel(stream: any, index: number): string {
  const resolutions = String(stream.resolutions || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const resolution = resolutions.length > 1
    ? `Auto DASH (${resolutions.map((value) => `${value}p`).join(' / ')})`
    : resolutions.length === 1
      ? `${resolutions[0]}p`
      : `Stream ${index + 1}`;
  const format = stream.format ? ` ${String(stream.format).toUpperCase()}` : '';
  const codec = stream.codecName ? ` ${stream.codecName}` : '';

  return `${resolution}${format}${codec}`;
}

function getResolutionOptions(stream: any): string[] {
  return String(stream?.resolutions || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => `${value}p`);
}

function getResolutionNumber(label: string): number {
  return parseInt(label, 10) || 0;
}

function dedupeDownloadLinks(links: Array<{ label: string; url: string }>) {
  const byQuality = new Map<string, { label: string; url: string }>();
  links.forEach((link) => {
    const key = `${getResolutionNumber(link.label) || link.label}`;
    if (!byQuality.has(key)) {
      byQuality.set(key, link);
    }
  });

  return [...byQuality.values()].sort((a, b) => getResolutionNumber(b.label) - getResolutionNumber(a.label));
}

function getStreamLanguage(stream: any): string {
  const source = [
    stream.lang,
    stream.language,
    stream.audioLang,
    stream.title,
    stream.name,
    stream.url,
  ].map((value) => String(value || '')).join(' ');

  const languages = [
    'Hindi',
    'English',
    'Tamil',
    'Telugu',
    'Malayalam',
    'Kannada',
    'Bengali',
    'Marathi',
    'Punjabi',
    'Urdu',
    'Spanish',
    'French',
    'German',
    'Korean',
    'Japanese',
    'Chinese',
  ];

  return languages.find((language) => new RegExp(`\\b${language}\\b`, 'i').test(source)) || 'Default';
}

function getDownloadLinks(resources: any[], fallbackTitle: string): DownloadLink[] {
  return (resources || [])
    .filter((item: any) => item.resourceLink && !item.resourceLink.includes('.mpd') && !item.resourceLink.includes('.m3u8'))
    .map((item: any, index: number) => ({
      label: item.resolution ? `${item.resolution}p MP4` : item.ep ? `Episode ${item.ep}` : `Download ${index + 1}`,
      url: item.resourceLink,
      filename: `${fallbackTitle || 'popcorn-video'}-${item.resolution || item.ep || index + 1}.mp4`,
    }));
}

function VlcFallbackDialog({ fallback, onClose, onPlayInBrowser }: { fallback: VlcFallback, onClose: () => void, onPlayInBrowser?: (stream: any) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(fallback.streamIndex || 0);
  const [mp4Links, setMp4Links] = useState<{label: string, url: string}[]>([]);
  const [selectedMp4Index, setSelectedMp4Index] = useState(0);
  const [fetchingMp4s, setFetchingMp4s] = useState(false);

  useEffect(() => {
    if (!fallback.subjectId) return;
    setFetchingMp4s(true);
    fetch(backendUrl(`/api/resource?subjectId=${fallback.subjectId}&se=${fallback.se || '0'}&page=1&perPage=20&resolution=0`))
      .then(r => r.json())
      .then(async data => {
        const links: {label: string, url: string}[] = [];
        const apiResolutions = data.collectionResolutions?.length
          ? data.collectionResolutions.map((res: any) => String(res.resolution || res))
          : [];
        const dashResolutions = (fallback.allStreams || [])
          .flatMap((stream: any) => getResolutionOptions(stream))
          .map((resolution: string) => resolution.replace('p', ''));
        const resolutions = [...new Set([...apiResolutions, ...dashResolutions, '0'])];

        const fetchPromises = resolutions.map((resolution: string) => {
          const epParams = fallback.ep && fallback.ep !== '0' ? `&epFrom=${fallback.ep}&epTo=${fallback.ep}` : '';
          return fetch(backendUrl(`/api/resource?subjectId=${fallback.subjectId}&se=${fallback.se || '0'}&page=1&perPage=20&resolution=${resolution}${epParams}`))
            .then(r => r.json());
        });

        const results = await Promise.all(fetchPromises);
        for (const resData of results) {
          const list = resData.list || [];
          for (const item of list) {
            if (!item.resourceLink) continue;
            if (fallback.ep && fallback.ep !== '0' && String(item.ep) !== fallback.ep) continue;
            if (item.resourceLink.includes('.mpd') || item.resourceLink.includes('.m3u8')) continue;
            links.push({ label: `${item.resolution || 'Unknown'}p MP4`, url: item.resourceLink });
          }
        }
        setMp4Links(dedupeDownloadLinks(links));
        setSelectedMp4Index(0);
        setFetchingMp4s(false);
      })
      .catch(() => setFetchingMp4s(false));
  }, [fallback]);

  const selectedStream = fallback.allStreams?.[selectedIndex];
  const isHevc = selectedStream ? isHevcStream(selectedStream) : false;
  
  const vlcAuthParams = selectedStream ? getAuthParams(selectedStream) : '';
  const currentVlcUrl = selectedStream ? toVlcProxyUrl(selectedStream.url, vlcAuthParams) : fallback.vlcUrl;
  const resolutionOptions = selectedStream ? getResolutionOptions(selectedStream) : [];
  const availableQualities = [
    ...new Set([
      ...resolutionOptions,
      ...mp4Links.map((link) => `${getResolutionNumber(link.label)}p`).filter((quality) => quality !== '0p'),
    ]),
  ].sort((a, b) => getResolutionNumber(b) - getResolutionNumber(a));
  const selectedQuality = availableQualities[selectedMp4Index] || availableQualities[0] || '';
  const selectedMp4 = mp4Links.find((link) => getResolutionNumber(link.label) === getResolutionNumber(selectedQuality));
  
  const canPlayInBrowser = selectedStream ? !isHevc : !!fallback.browserStream;
  const currentBrowserStream = selectedStream ? { url: selectedStream.url, authParams: getAuthParams(selectedStream), streams: fallback.allStreams, streamIndex: selectedIndex } : fallback.browserStream;

  const copyText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
  };

  const tryOpenVlc = () => {
    const m3uContent = `#EXTM3U\n#EXTINF:-1,${fallback.title}\n${currentVlcUrl}`;
    const blob = new Blob([m3uContent], { type: 'audio/x-mpegurl' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fallback.title.replace(/[^a-zA-Z0-9]/g, '_')}_VLC.m3u`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 9999 }}>
      <div className="vlc-dialog">
        <div className="flex justify-between gap-4 items-start mb-4">
          <div>
            <h2 className="dialog-title">Playback Options</h2>
            <p className="dialog-copy mt-1">
              {canPlayInBrowser
                ? 'This video can be played directly in your browser, or you can open it in VLC.' 
                : 'This stream is HEVC/H.265, so Chrome may play audio only. Please use VLC.'}
            </p>
          </div>
          <button onClick={onClose} className="icon-text-button">Close</button>
        </div>

        <div className="stream-summary">
          <div className="stream-title">{fallback.title}</div>
          {fallback.allStreams && fallback.allStreams.length > 0 ? (
            <>
              <div className="stream-source-list" aria-label="Stream sources">
                {fallback.allStreams.map((stream, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setSelectedIndex(idx);
                      setSelectedMp4Index(0);
                    }}
                    className={idx === selectedIndex ? 'active' : ''}
                  >
                    <span>
                      <strong>Source {idx + 1}</strong>
                      <small>{getStreamLanguage(stream)} {isHevcStream(stream) ? 'HEVC' : 'Browser ready'}</small>
                    </span>
                    <em>{getStreamLabel(stream, idx)}</em>
                  </button>
                ))}
              </div>
              <div className="quality-note">
                Choose the exact quality below. Direct MP4 is used when available; DASH-only quality must be opened in VLC.
              </div>
            </>
          ) : (
            <div>{fallback.format || 'Stream'} {fallback.resolution ? `- ${fallback.resolution}` : ''}</div>
          )}
        </div>

        <div className="space-y-4">
          {canPlayInBrowser && onPlayInBrowser && (
            <button
              onClick={() => {
                onPlayInBrowser(currentBrowserStream);
                onClose();
              }}
              className="w-full bg-white text-black font-semibold py-3 rounded-lg hover:bg-gray-200 transition-colors flex justify-center items-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"/></svg>
              Play directly in browser
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={tryOpenVlc}
              className="primary-action flex-1 !bg-orange-500 hover:!bg-orange-600 !text-white"
            >
              Open in VLC (.m3u)
            </button>
            <button
              onClick={() => copyText('vlc', currentVlcUrl)}
              className="secondary-action flex-1"
            >
              {copied === 'vlc' ? 'Copied VLC URL' : 'Copy VLC URL'}
            </button>
          </div>
          
          <div className="dialog-footnote mb-2">
            Click "Open in VLC" to download a tiny .m3u file. Double-click it to instantly launch the stream in VLC!
          </div>

          <div className="quality-section">
            <h3>Select quality</h3>
            {fetchingMp4s ? (
               <div className="quality-empty">Finding MP4 qualities...</div>
            ) : availableQualities.length > 0 ? (
              <>
                <label className="quality-select-label" htmlFor="quality-select">Available quality</label>
                <select
                  id="quality-select"
                  className="quality-select"
                  value={selectedQuality}
                  onChange={(event) => {
                    const nextIndex = availableQualities.findIndex((quality) => quality === event.target.value);
                    setSelectedMp4Index(Math.max(0, nextIndex));
                  }}
                >
                  {availableQualities.map((quality) => {
                    const hasDirectMp4 = mp4Links.some((link) => getResolutionNumber(link.label) === getResolutionNumber(quality));
                    return (
                      <option key={quality} value={quality}>
                        {quality}{hasDirectMp4 ? ' MP4 available' : ' DASH only'}
                      </option>
                    );
                  })}
                </select>
                <div className="quality-selected-note">
                  {selectedMp4
                    ? `${selectedQuality} has a direct MP4 link, so download/open uses that exact quality.`
                    : `${selectedQuality} is inside the DASH stream. Open it in VLC and select this quality in VLC playback settings.`}
                </div>

                <div className="quality-actions">
                  {selectedMp4 ? (
                    <>
                    <a href={selectedMp4.url} download target="_blank" rel="noreferrer" className="primary-action">
                      Download {selectedMp4.label}
                    </a>
                    <a href={selectedMp4.url} target="_blank" rel="noreferrer" className="secondary-action">
                      Open {selectedMp4.label}
                    </a>
                    </>
                  ) : (
                    <>
                      <button onClick={tryOpenVlc} className="primary-action">
                        Open DASH in VLC
                      </button>
                      <button onClick={() => copyText('vlc', currentVlcUrl)} className="secondary-action">
                        Copy DASH URL
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
               <div className="quality-empty">No separate MP4 qualities available for this title.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VideoPlayer({
  url,
  authParams,
  streams,
  streamIndex,
  startTime,
  onQualityChange,
  onClose,
}: {
  url: string,
  authParams: string,
  streams: any[],
  streamIndex: number,
  startTime?: number,
  onQualityChange: (index: number) => void,
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);

  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [textTracks, setTextTracks] = useState<any[]>([]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const [currentAudio, setCurrentAudio] = useState<number>(0);
  const [currentText, setCurrentText] = useState<number>(-1);
  const [activeMenu, setActiveMenu] = useState<MenuName>(null);

  const isDash = url.includes('.mpd');
  const playbackUrl = appendAuthParams(toProxiedCdnUrl(url), authParams);

  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const restoreStartTime = () => {
      if (startTime && Number.isFinite(startTime)) {
        video.currentTime = startTime;
      }
    };
    const syncPlaybackState = () => {
      setIsPlaying(!video.paused);
      setIsMuted(video.muted);
      setCurrentTime(video.currentTime || 0);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };

    video.addEventListener('play', syncPlaybackState);
    video.addEventListener('pause', syncPlaybackState);
    video.addEventListener('timeupdate', syncPlaybackState);
    video.addEventListener('loadedmetadata', syncPlaybackState);
    video.addEventListener('loadedmetadata', restoreStartTime, { once: true });
    video.addEventListener('volumechange', syncPlaybackState);
    
    // If it's an MP4 or other native format, don't use Dash.js
    if (!isDash) {
      video.src = playbackUrl;
      return () => {
        video.removeEventListener('play', syncPlaybackState);
        video.removeEventListener('pause', syncPlaybackState);
        video.removeEventListener('timeupdate', syncPlaybackState);
        video.removeEventListener('loadedmetadata', syncPlaybackState);
        video.removeEventListener('loadedmetadata', restoreStartTime);
        video.removeEventListener('volumechange', syncPlaybackState);
      };
    }

    const player = MediaPlayer().create();
    playerRef.current = player;
    
    player.addRequestInterceptor((request: any) => {
      request.url = appendAuthParams(toProxiedCdnUrl(request.url), authParams);
      return Promise.resolve(request);
    });
    
    player.on('streamInitialized', () => {
      setAudioTracks(player.getTracksFor('audio') || []);
      setTextTracks(player.getTracksFor('text') || []);
    });

    player.initialize(videoRef.current, playbackUrl, true);
    
    return () => {
      video.removeEventListener('play', syncPlaybackState);
      video.removeEventListener('pause', syncPlaybackState);
      video.removeEventListener('timeupdate', syncPlaybackState);
      video.removeEventListener('loadedmetadata', syncPlaybackState);
      video.removeEventListener('loadedmetadata', restoreStartTime);
      video.removeEventListener('volumechange', syncPlaybackState);
      player.destroy();
      playerRef.current = null;
    };
  }, [url, authParams, isDash, playbackUrl, startTime]);

  const togglePlay = async () => {
    if (!videoRef.current) return;

    if (videoRef.current.paused) {
      await videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  const seekBy = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min((videoRef.current.duration || 0), videoRef.current.currentTime + seconds));
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '0:00';
    }

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');

    return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs}` : `${mins}:${secs}`;
  };

  const selectAudioTrack = (idx: number) => {
    setCurrentAudio(idx);
    if (playerRef.current && audioTracks[idx]) {
      playerRef.current.setCurrentTrack(audioTracks[idx]);
    }
    setActiveMenu(null);
  };

  const selectTextTrack = (idx: number) => {
    setCurrentText(idx);
    if (playerRef.current) {
      if (idx === -1) {
        playerRef.current.updateSettings({ streaming: { text: { defaultEnabled: false } } });
        playerRef.current.enableText(false);
      } else if (textTracks[idx]) {
        playerRef.current.enableText(true);
        playerRef.current.setCurrentTrack(textTracks[idx]);
      }
    }
    setActiveMenu(null);
  };

  const selectQuality = (idx: number) => {
    onQualityChange(idx);
    setActiveMenu(null);
  };

  const streamLanguageOptions = streams.reduce((options: Array<{ label: string; index: number }>, stream, idx) => {
    const label = getStreamLanguage(stream);
    if (!options.some((option) => option.label === label)) {
      options.push({ label, index: idx });
    }
    return options;
  }, []);

  return (
    <div className="player-shell">
      <div className="player-toolbar">
        
        {/* Controls */}
        <div className="player-controls">
          <button onClick={togglePlay} className="control-button primary">
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={() => seekBy(-10)} className="control-button">
            -10s
          </button>
          <button onClick={() => seekBy(10)} className="control-button">
            +10s
          </button>
          <button onClick={toggleMute} className="control-button">
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          <span className="time-pill">{formatTime(currentTime)} / {formatTime(duration)}</span>
          <button onClick={() => setActiveMenu(activeMenu === 'language' ? null : 'language')} className="control-button menu-trigger">
            Language
          </button>
          <button onClick={() => setActiveMenu(activeMenu === 'quality' ? null : 'quality')} className="control-button menu-trigger">
            Quality
          </button>
          <button onClick={() => setActiveMenu(activeMenu === 'subtitle' ? null : 'subtitle')} className="control-button menu-trigger">
            Subtitle
          </button>
        </div>

        {activeMenu && (
          <div className="player-menu">
            <div className="player-menu-title">
              {activeMenu === 'language' && 'Select language'}
              {activeMenu === 'quality' && 'Select quality'}
              {activeMenu === 'subtitle' && 'Select subtitle'}
            </div>

            {activeMenu === 'language' && (
              <div className="menu-list">
                {isDash && audioTracks.length > 0 ? audioTracks.map((track, idx) => (
                  <button key={idx} onClick={() => selectAudioTrack(idx)} className={idx === currentAudio ? 'active' : ''}>
                    {track.lang || `Track ${idx + 1}`}
                  </button>
                )) : streamLanguageOptions.map((option) => (
                  <button key={option.label} onClick={() => selectQuality(option.index)} className={option.index === streamIndex ? 'active' : ''}>
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {activeMenu === 'quality' && (
              <div className="menu-list">
                {streams.map((stream, idx) => (
                  <button key={stream.id || idx} onClick={() => selectQuality(idx)} className={idx === streamIndex ? 'active' : ''}>
                    {getStreamLabel(stream, idx)}
                  </button>
                ))}
              </div>
            )}

            {activeMenu === 'subtitle' && (
              <div className="menu-list">
                <button onClick={() => selectTextTrack(-1)} className={currentText === -1 ? 'active' : ''}>Off</button>
                {isDash && textTracks.map((track, idx) => (
                  <button key={idx} onClick={() => selectTextTrack(idx)} className={idx === currentText ? 'active' : ''}>
                    {track.lang || `Subtitle ${idx + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button onClick={onClose} className="close-player">Close</button>
      </div>
      
      <div className="video-stage">
        <video ref={videoRef} controls autoPlay className="movie-video"></video>
      </div>
    </div>
  )
}



type TabType = 'home' | 'movies' | 'tvshows' | 'anime';

function App() {
  const [movies, setMovies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isFetchingPlay, setIsFetchingPlay] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('home')
  
  const [filterOptions, setFilterOptions] = useState<any[]>([])
  const [currentFilters, setCurrentFilters] = useState<Partial<FilterState>>({
    genre: 'All', country: 'India', year: 'All', classify: 'All', sort: 'Latest'
  })
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null)

  const [playingVideo, setPlayingVideo] = useState<PlayingVideo | null>(null)
  const [vlcFallback, setVlcFallback] = useState<VlcFallback | null>(null)

  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Details Modal state
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null)
  const [movieDetails, setMovieDetails] = useState<any>(null)
  const [seasonInfo, setSeasonInfo] = useState<any>(null)
  const [episodeList, setEpisodeList] = useState<any[]>([])
  const [movieDownloadLinks, setMovieDownloadLinks] = useState<DownloadLink[]>([])
  const [selectedSeason, setSelectedSeason] = useState<number>(1)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>('episodes')

  useEffect(() => {
    setCurrentFilters({ genre: 'All', country: 'All', year: 'All', classify: 'All', sort: 'Latest' });
    setFilterOptions([]);
    setOpenFilterMenu(null);

    let tabId = null;
    if (activeTab === 'home') tabId = "2"; // Use movie filters for Home tab
    if (activeTab === 'movies') tabId = "2";
    if (activeTab === 'tvshows') tabId = "5";
    if (activeTab === 'anime') tabId = "8";

    if (tabId) {
      getFilterItems(tabId).then(items => {
        setFilterOptions(items[0]?.items || []);
      }).catch(console.error);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!hasMore && page !== 1) return;

    if (page === 1) setLoading(true);
    else setLoadingMore(true);
    
    setError(null)
    
    let fetchPromise;
    if (searchQuery.trim() !== '') {
      fetchPromise = searchMovies(searchQuery.trim(), page, 20)
    } else {
      let tabId = "0";
      if (activeTab === 'movies') tabId = "1";
      else if (activeTab === 'tvshows') tabId = "2";
      else if (activeTab === 'anime') tabId = "1006";

      fetchPromise = getCategoryList(tabId, page, 20, currentFilters);
    }

    let isSubscribed = true;
    fetchPromise
      .then(items => {
        if (!isSubscribed) return;
        
        // Filter out non-movie/tvshow items (like youtube clips which have no posters) and items with broken covers
        const validItems = items.filter((item: any) => {
          const hasCover = item.cover && (item.cover.url || typeof item.cover === 'string');
          return hasCover && (item.subjectType === 1 || item.subjectType === 2 || !item.subjectType);
        });
        
        setMovies(prev => {
          if (page === 1) return validItems;
          // Deduplicate items (Home tab API often returns duplicates across pages)
          const existingIds = new Set(prev.map(m => m.id || m.subjectId));
          const newItems = validItems.filter((item: any) => !existingIds.has(item.id || item.subjectId));
          return [...prev, ...newItems];
        });
        setHasMore(items.length > 0)
        setLoading(false)
        setLoadingMore(false)
      })
      .catch(err => {
        if (!isSubscribed) return;
        console.error(err)
        setError(err.message)
        setLoading(false)
        setLoadingMore(false)
      })

    return () => {
      isSubscribed = false;
    }
  }, [searchQuery, activeTab, currentFilters, page])

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setSearchQuery(e.currentTarget.value)
      setPage(1)
      setHasMore(true)
    }
  }

  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 300) {
      if (!loading && !loadingMore && hasMore) {
        setLoadingMore(true);
        setPage(p => p + 1);
      }
    }
  }

  const handleMovieClick = async (movie: any) => {
    const subjectId = movie.id || movie.subjectId;
    setSelectedMovieId(subjectId);
    setDetailsLoading(true);
    setMovieDetails(null);
    setSeasonInfo(null);
    setEpisodeList([]);
    setMovieDownloadLinks([]);
    setSelectedSeason(1);
    setActiveDetailTab('episodes');
    
    try {
      const details = await getSubjectDetails(subjectId);
      setMovieDetails(details);
      
      if (details.subjectType === 2 || movie.type === 2 || details.seasons?.length > 0) {
        const seasons = await getSeasonInfo(subjectId);
        setSeasonInfo(seasons);
        if (seasons.seasons && seasons.seasons.length > 0) {
           const firstSeason = seasons.seasons[0].se;
           setSelectedSeason(firstSeason);
           const resources = await getResourceLinks(subjectId, String(firstSeason));
           setEpisodeList(resources.list || []);
        }
      } else {
        const resources = await getResourceLinks(subjectId, '0');
        setMovieDownloadLinks(getDownloadLinks(resources.list || [], details.title || movie.title));
      }
    } catch (err) {
      console.error(err);
    }
    setDetailsLoading(false);
  }

  const handleSeasonChange = async (seasonNum: number) => {
    if (!selectedMovieId) return;
    setSelectedSeason(seasonNum);
    setEpisodeList([]);
    try {
      const resources = await getResourceLinks(selectedMovieId, String(seasonNum));
      setEpisodeList(resources.list || []);
    } catch (err) {
      console.error(err);
    }
  }

  const openPlaybackOptions = async (se: string = '0', ep: string = '0') => {
    if (!selectedMovieId || isFetchingPlay) return;
    setIsFetchingPlay(true);
    try {
      const streams = await getPlayInfo(selectedMovieId, se, ep);
      if (!streams || streams.length === 0) {
        alert('No streams found for this movie/episode.');
        return;
      }

      const sortedStreams = [...streams].sort((a: any, b: any) => getStreamScore(b) - getStreamScore(a));
      const supportedStreams = sortedStreams.filter((stream: any) => !isHevcStream(stream));
      const bestStream = sortedStreams[0];
      const authParams = getAuthParams(bestStream);
      const browserStream = supportedStreams.length > 0
        ? {
            url: supportedStreams[0].url,
            authParams: getAuthParams(supportedStreams[0]),
            streams: supportedStreams,
            streamIndex: 0,
          }
        : undefined;

      setVlcFallback({
        title: bestStream.title || movieDetails?.title || 'Popcorn stream',
        format: bestStream.format || '',
        resolution: bestStream.resolutions || '',
        directUrl: appendAuthParams(bestStream.url, authParams),
        vlcUrl: toVlcProxyUrl(bestStream.url, authParams),
        allStreams: sortedStreams,
        browserStream,
        streamIndex: 0,
        subjectId: selectedMovieId,
        se,
        ep,
      });
    } catch (err) {
      alert('Failed to get playback options: ' + (err as Error).message);
    } finally {
      setIsFetchingPlay(false);
    }
  }

  const handlePlay = async (se: string = '0', ep: string = '0') => {
    if (!selectedMovieId || isFetchingPlay || playingVideo) return;
    setIsFetchingPlay(true);
    try {
      let streams = await getPlayInfo(selectedMovieId, se, ep);

      console.log('All available streams:', streams);
      if (streams && streams.length > 0) {
        const supportedStreams = streams
          .filter((stream: any) => !isHevcStream(stream))
          .sort((a: any, b: any) => getStreamScore(b) - getStreamScore(a));

        const bestVlcStream = [...streams].sort((a: any, b: any) => getStreamScore(b) - getStreamScore(a))[0];
        const vlcAuthParams = getAuthParams(bestVlcStream);

        if (supportedStreams.length === 0) {
          setVlcFallback({
            title: bestVlcStream.title || 'HEVC stream',
            format: bestVlcStream.format || '',
            resolution: bestVlcStream.resolutions || '',
            directUrl: appendAuthParams(bestVlcStream.url, vlcAuthParams),
            vlcUrl: toVlcProxyUrl(bestVlcStream.url, vlcAuthParams),
            allStreams: streams,
            subjectId: selectedMovieId,
            se: se,
            ep: ep
          });
        } else {
          const bestStream = supportedStreams[0];
          const streamIndex = supportedStreams.findIndex((stream: any) => stream === bestStream);
          const authParams = getAuthParams(bestStream);
          
          setVlcFallback(null);
          setPlayingVideo({ url: bestStream.url, authParams, streams: supportedStreams, streamIndex });
        }
      } else {
        alert('No streams found for this movie/episode.');
      }
    } catch (err) {
      alert('Failed to get playback URL: ' + (err as Error).message);
    } finally {
      setIsFetchingPlay(false);
    }
  }

  const handleQualityChange = (index: number) => {
    const currentTime = document.querySelector('video')?.currentTime || 0;

    setPlayingVideo((current) => {
      if (!current || !current.streams[index]) {
        return current;
      }

      const stream = current.streams[index];
      return {
        ...current,
        url: stream.url,
        authParams: getAuthParams(stream),
        streamIndex: index,
        startTime: currentTime,
      };
    });
  }

  const moreLikeThis = movies
    .filter((movie: any) => String(movie.id || movie.subjectId) !== String(selectedMovieId))
    .filter((movie: any) => {
      if (!movieDetails?.genre || !movie.genre) return true;
      const selectedGenres = String(movieDetails.genre).toLowerCase().split(',').map((genre) => genre.trim());
      return selectedGenres.some((genre) => genre && String(movie.genre).toLowerCase().includes(genre));
    })
    .slice(0, 8);

  return (
    <div className="app-shell">
      {playingVideo && (
        <VideoPlayer
          url={playingVideo.url}
          authParams={playingVideo.authParams}
          streams={playingVideo.streams}
          streamIndex={playingVideo.streamIndex}
          startTime={playingVideo.startTime}
          onQualityChange={handleQualityChange}
          onClose={() => setPlayingVideo(null)}
        />
      )}
      {vlcFallback && (
        <VlcFallbackDialog 
          fallback={vlcFallback} 
          onClose={() => setVlcFallback(null)} 
          onPlayInBrowser={() => {
            if (vlcFallback.browserStream) {
              setPlayingVideo(vlcFallback.browserStream);
            }
          }}
        />
      )}
      
      {/* Sidebar */}
      <aside className="sidebar">
        <h1 className="brand-mark" aria-label="Popcorn">
          <span className="brand-pop">Pop</span><span className="brand-corn">corn</span>
          <span className="brand-kernel" aria-hidden="true"></span>
        </h1>
        <nav className="sidebar-nav">
          <a href="#" className={activeTab === 'home' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('home'); setSearchQuery(''); setPage(1); setHasMore(true); }}>Home</a>
          <a href="#" className={activeTab === 'movies' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('movies'); setSearchQuery(''); setPage(1); setHasMore(true); }}>Movies</a>
          <a href="#" className={activeTab === 'tvshows' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('tvshows'); setSearchQuery(''); setPage(1); setHasMore(true); }}>TV Shows</a>
          <a href="#" className={activeTab === 'anime' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('anime'); setSearchQuery(''); setPage(1); setHasMore(true); }}>Anime</a>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="content-area" onScroll={handleScroll}>
        <header className="content-header">
          <button className="menu-toggle" aria-label="Open navigation">
            <span></span>
            <span></span>
            <span></span>
          </button>
          <div className="search-shell">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.35-4.35" /><circle cx="11" cy="11" r="7" /></svg>
            <input 
              type="text" 
              placeholder="Search for movies, shows and more..." 
              onKeyDown={handleSearch}
              className="search-input"
            />
            <span className="search-shortcut">CTRL + K</span>
          </div>
          <div className="topbar-actions">
            <button className="notification-button" aria-label="Notifications"><span>3</span></button>
            <div className="profile-chip" aria-label="Profile"></div>
          </div>
        </header>

        <section className="page-heading">
          <p className="section-kicker">Now playing around you</p>
          <h2>
            {searchQuery 
              ? `Search Results: ${searchQuery}` 
              : activeTab === 'home' ? 'Latest & For You'
              : activeTab === 'movies' ? 'Movies'
              : activeTab === 'tvshows' ? 'TV Shows'
              : activeTab === 'anime' ? 'Anime'
              : 'Trending Now'
            }
          </h2>
        </section>

        {filterOptions.length > 0 && (
          <div className="filter-strip">
            {filterOptions.filter(f => f.filterType !== 'sort' && f.filterType !== 'rate' && f.filterType !== 'classify').map(filterGroup => {
              const filterKey = filterGroup.filterType as keyof FilterState;
              const currentValue = currentFilters[filterKey] || 'All';
              const groupLabel = filterGroup.filterType.charAt(0).toUpperCase() + filterGroup.filterType.slice(1);
              const selectedOption = filterGroup.filterValsV2.find((value: any) => value.id === currentValue);
              const displayLabel = currentValue === 'All' ? groupLabel : selectedOption?.name || groupLabel;

              return (
                <div key={filterGroup.filterType} className="filter-menu">
                  <button
                    type="button"
                    className={`filter-select filter-select-button ${openFilterMenu === filterGroup.filterType ? 'active' : ''}`}
                    onClick={() => setOpenFilterMenu(openFilterMenu === filterGroup.filterType ? null : filterGroup.filterType)}
                  >
                    <span>{displayLabel}</span>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="m6 9 6 6 6-6" /></svg>
                  </button>

                  {openFilterMenu === filterGroup.filterType && (
                    <div className="filter-menu-panel">
                      <button
                        type="button"
                        className={currentValue === 'All' ? 'active' : ''}
                        onClick={() => {
                          setCurrentFilters(prev => ({ ...prev, [filterGroup.filterType]: 'All' }));
                          setPage(1);
                          setHasMore(true);
                          setOpenFilterMenu(null);
                        }}
                      >
                        All {groupLabel}
                      </button>
                      {filterGroup.filterValsV2.filter((value: any) => value.id !== 'All').map((value: any) => (
                        <button
                          type="button"
                          key={value.id}
                          className={currentValue === value.id ? 'active' : ''}
                          onClick={() => {
                            setCurrentFilters(prev => ({ ...prev, [filterGroup.filterType]: value.id }));
                            setPage(1);
                            setHasMore(true);
                            setOpenFilterMenu(null);
                          }}
                        >
                          {value.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            
            <button 
              onClick={() => setShowMoreFilters(true)}
              className="filter-icon-button"
              aria-label="More filters"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
            </button>
          </div>
        )}

        {showMoreFilters && (
          <div className="sheet-backdrop">
            <div className="filter-sheet">
              <div className="sheet-header">
                <h2>More filters</h2>
                <button onClick={() => setShowMoreFilters(false)} className="sheet-close">Close</button>
              </div>

              {/* Sort By */}
              {filterOptions.find(f => f.filterType === 'sort') && (
                <div className="filter-section">
                  <h3>Sort by</h3>
                  <div className="pill-grid">
                    {filterOptions.find(f => f.filterType === 'sort').filterValsV2.map((val: any) => (
                      <button 
                        key={val.id}
                        onClick={() => {
                          setCurrentFilters(prev => ({ ...prev, sort: val.id }));
                          setPage(1);
                          setHasMore(true);
                        }}
                        className={`filter-pill ${currentFilters.sort === val.id ? 'active' : ''}`}
                      >
                        {val.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Language (Classify) */}
              {filterOptions.find(f => f.filterType === 'classify') && (
                <div className="filter-section">
                  <h3>Language</h3>
                  <div className="pill-grid two">
                    {filterOptions.find(f => f.filterType === 'classify').filterValsV2.map((val: any) => (
                      <button 
                        key={val.id}
                        onClick={() => {
                          setCurrentFilters(prev => ({ ...prev, classify: val.id }));
                          setPage(1);
                          setHasMore(true);
                        }}
                        className={`filter-pill ${currentFilters.classify === val.id ? 'active' : ''}`}
                      >
                        {val.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="sheet-actions">
                <button 
                  onClick={() => {
                    setCurrentFilters({ genre: 'All', country: 'All', year: 'All', classify: 'All', sort: 'Latest' });
                    setPage(1);
                    setHasMore(true);
                    setShowMoreFilters(false);
                  }}
                  className="ghost-action"
                >
                  Reset
                </button>
                <button 
                  onClick={() => setShowMoreFilters(false)}
                  className="confirm-action"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {loading && <div className="state-panel">Loading movies from MovieBox...</div>}
        {error && <div className="state-panel error">Error: {error}</div>}

        {/* Movie Grid */}
        {!loading && !error && (
          <div className="movie-grid">
            {movies.map((movie: any, i: number) => {
              const uniqueKey = `${movie.id || movie.subjectId}-${i}`;
              return (
              <div 
                key={uniqueKey} 
                className={`movie-card group cursor-pointer ${String(selectedMovieId) === String(movie.id || movie.subjectId) ? 'selected' : ''}`}
                onClick={() => handleMovieClick(movie)}
              >
                <div className="poster-frame">
                  {movie.cover?.url || movie.coverUrl || typeof movie.cover === 'string' ? (
                    <img src={movie.cover?.url || movie.coverUrl || movie.cover} alt={movie.title} />
                  ) : (
                    <div className="poster-empty">No Poster</div>
                  )}
                  {/* Hover Overlay */}
                  <div className="play-overlay">
                    <button className="play-button">▶ Play</button>
                  </div>
                </div>
                <div className="movie-meta">
                  <h3 title={movie.title}>{movie.title}</h3>
                  <div className="movie-facts">
                    <span>{movie.releaseDate?.substring(0, 4) || movie.year}</span>
                    <span className="rating-pill">
                      ⭐ {movie.imdbRatingValue || movie.rate || 'N/A'}
                    </span>
                  </div>
                  <div className="genre-line">{movie.genre}</div>
                </div>
              </div>
              );
            })}
          </div>
        )}
        
        {loadingMore && (
          <div className="py-8 text-center text-gray-400">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" role="status">
              <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">Loading...</span>
            </div>
            <p className="mt-2 text-sm">Loading more movies...</p>
          </div>
        )}
      </main>

      {/* Details Modal */}
      {selectedMovieId && (
        <div className="details-backdrop">
          <div className="details-shell">
            <button 
              onClick={() => setSelectedMovieId(null)}
              className="details-close"
              aria-label="Close details"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            
            {detailsLoading ? (
              <div className="details-loading">
                <div className="loading-spinner"></div>
                <p>Loading details...</p>
              </div>
            ) : movieDetails && (
              <div className="details-content">
                {/* Poster Sidebar */}
                <div className="details-sidebar">
                  <img src={movieDetails.cover?.url || movieDetails.cover} alt={movieDetails.title} className="details-poster" />
                </div>

                {/* Main Content Area */}
                <div className="details-main">
                  <h2 className="details-title">{movieDetails.title}</h2>
                  <div className="details-facts">
                    <span>{movieDetails.year || movieDetails.releaseDate?.substring(0,4)}</span>
                    {movieDetails.imdbRatingValue && <span>Rating {movieDetails.imdbRatingValue}</span>}
                  </div>

                  <div className="detail-tabs">
                    <button onClick={() => setActiveDetailTab('episodes')} className={activeDetailTab === 'episodes' ? 'active' : ''}>Episodes</button>
                    <button onClick={() => setActiveDetailTab('details')} className={activeDetailTab === 'details' ? 'active' : ''}>Details</button>
                    <button onClick={() => setActiveDetailTab('more')} className={activeDetailTab === 'more' ? 'active' : ''}>More Like This</button>
                  </div>

                  {activeDetailTab === 'details' && (
                    <div className="details-tab-panel">
                      <p className="details-copy">{movieDetails.description || 'No description available.'}</p>
                      <div className="details-info-grid">
                        <div>
                          <span>Title</span>
                          <p>{movieDetails.title}</p>
                        </div>
                        <div>
                          <span>Year</span>
                          <p>{movieDetails.year || movieDetails.releaseDate?.substring(0,4) || 'Unknown'}</p>
                        </div>
                        <div>
                          <span>Rating</span>
                          <p>{movieDetails.imdbRatingValue || movieDetails.rate || 'N/A'}</p>
                        </div>
                        {movieDetails.genre && (
                          <div>
                            <span>Genres</span>
                            <p>{movieDetails.genre}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeDetailTab === 'more' && (
                    <div className="more-like-list">
                      {moreLikeThis.length > 0 ? moreLikeThis.map((movie: any) => (
                        <button key={movie.id || movie.subjectId} onClick={() => handleMovieClick(movie)} className="more-like-card">
                          <img src={movie.cover?.url || movie.coverUrl || movie.cover} alt={movie.title} />
                          <span>
                            <strong>{movie.title}</strong>
                            <small>{movie.releaseDate?.substring(0, 4) || movie.year || 'Unknown'} {movie.genre ? `- ${movie.genre}` : ''}</small>
                          </span>
                        </button>
                      )) : (
                        <div className="episode-empty">No similar items in the current filter.</div>
                      )}
                    </div>
                  )}

                  {activeDetailTab === 'episodes' && ((!seasonInfo || !seasonInfo.seasons || seasonInfo.seasons.length === 0) ? (
                    <div className="details-actions">
                      <button 
                        onClick={() => handlePlay('0', '0')}
                        className="hero-play-button"
                        disabled={isFetchingPlay}
                      >
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"/></svg> Play
                      </button>
                      <button
                        onClick={() => openPlaybackOptions('0', '0')}
                        className="details-secondary-button"
                        disabled={isFetchingPlay}
                      >
                        VLC / Quality
                      </button>
                      {movieDownloadLinks.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          {movieDownloadLinks.map((link, idx) => (
                            <a
                              key={idx}
                              href={link.url}
                              download={link.filename}
                              target="_blank"
                              rel="noreferrer"
                              className="details-download-button text-center w-full block"
                            >
                              Download {link.label}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() => openPlaybackOptions('0', '0')}
                          className="details-download-button"
                          disabled={isFetchingPlay}
                        >
                          Find Downloads
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="episode-section">
                      <h3>Seasons</h3>
                      <div className="season-tabs">
                        {seasonInfo.seasons.map((s: any) => (
                          <button
                            key={s.se}
                            onClick={() => handleSeasonChange(s.se)}
                            className={`season-button ${selectedSeason === s.se ? 'active' : ''}`}
                          >
                            Season {s.se}
                          </button>
                        ))}
                      </div>

                      <h3>Episodes</h3>
                      <div className="episode-list">
                        {episodeList.length === 0 ? (
                          <div className="episode-empty">Loading episodes...</div>
                        ) : (
                          episodeList.map((ep: any) => (
                            <div key={ep.episode} className="episode-card">
                              <div className="episode-info">
                                <div className="episode-number">
                                  {ep.ep}
                                </div>
                                <div>
                                  <h4>{ep.title || `Episode ${ep.ep}`}</h4>
                                  {ep.size && <p>Size: {(parseInt(ep.size) / (1024*1024)).toFixed(1)} MB</p>}
                                </div>
                              </div>
                              <div className="episode-actions">
                                <button 
                                  onClick={() => handlePlay(String(selectedSeason), String(ep.ep))}
                                  className="episode-play-button"
                                  disabled={isFetchingPlay}
                                >
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"/></svg> Play
                                </button>
                                <button
                                  onClick={() => openPlaybackOptions(String(selectedSeason), String(ep.ep))}
                                  className="episode-option-button"
                                  disabled={isFetchingPlay}
                                >
                                  VLC
                                </button>
                                <button
                                  onClick={() => openPlaybackOptions(String(selectedSeason), String(ep.ep))}
                                  className="episode-download-button"
                                  disabled={isFetchingPlay}
                                >
                                  Download
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
