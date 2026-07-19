import React, { useState, useEffect, useRef } from 'react'
import { getPlayInfo, searchMovies, getCategoryList, getFilterItems, getSubjectDetails, getSeasonInfo, getResourceLinks } from './api'
import type { FilterState } from './api'
// @ts-ignore
import { MediaPlayer } from 'dashjs'
import Hls from 'hls.js'
import './index.css'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚧 MAINTENANCE MODE — set to `false` to restore the app
const MAINTENANCE_MODE = false;
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ROAST_LOADING_MESSAGES = [
  "Stealing movies faster than your ex stole your Netflix password...",
  "Loading... unlike your social life, this actually works.",
  "Fetching movies you'll add to your watchlist and never watch...",
  "Hold on, we're buffering harder than your last relationship...",
  "Finding movies... because going outside is overrated.",
  "Downloading your terrible taste in movies...",
  "Please wait... even our servers judge your movie choices.",
  "Loading content you'll scroll past for 30 mins then rewatch The Office...",
  "Grabbing movies... your popcorn is getting cold btw.",
  "Fetching films... this is still faster than your Wi-Fi.",
  "Summoning movies from the shadow realm...",
  "Our hamsters are running extra fast for you today...",
  "Loading... go touch some grass while you wait. Just kidding, stay.",
  "Acquiring cinema... your couch misses you already.",
  "Raiding the movie vault... Ocean's 11 style.",
  "Warming up the projector... and your loneliness.",
  "Beaming movies directly to your eyeballs...",
  "Convincing the server to share its movie collection...",
  "Pirating— I mean, totally legally sourcing movies...",
  "Hold tight, even JARVIS needed a sec sometimes...",
  "Loading movies you'll fall asleep to in 20 minutes...",
  "Bribing the internet gods for faster speeds...",
  "Your movie marathon awaits... and so does your laundry.",
  "Compiling excuses for why you watched that at 3 AM...",
  "Dusting off some hidden gems... and some absolute trash.",
  "Spinning up the movie machine... vroom vroom.",
  "Negotiating with the content mafia... please stand by.",
  "This loading screen has more suspense than most thrillers.",
];

const ROAST_LOADING_MORE = [
  "You scrolled this far?? Respect.",
  "More movies incoming... your productivity weeps.",
  "Fetching more... because you clearly have no plans today.",
  "Loading more content for your endless void of free time...",
  "Grabbing more titles... your screen time report is crying.",
  "Even more movies? You animal.",
  "Digging deeper into the vault... we admire your commitment.",
  "Shoveling more movies into your feed... you're welcome.",
];

function useRotatingMessage(messages: string[], intervalMs = 2500) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * messages.length));
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(prev => {
        let next;
        do { next = Math.floor(Math.random() * messages.length); } while (next === prev && messages.length > 1);
        return next;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [messages, intervalMs]);
  return messages[index];
}

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
  iframeUrl?: string;
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
  isLiveSports?: boolean;
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

const SERVER_3_URL = 'https://hugh.cdn.rumble.cloud/live/r8wvl35k/slot-5/iwj7-mxym/chunklist.m3u8';

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
    const backendOrigin = BACKEND_BASE_URL || window.location.origin;
    
    // Do not proxy Rumble streams (they have open CORS) or URLs that are already hitting our backend
    if (parsed.hostname.includes('rumble.cloud') || parsed.origin === backendOrigin) {
      return url;
    }
    
    // Use a space (%20) as the auth token placeholder if empty. 
    // This prevents the browser from collapsing the // path segment, 
    // and Node.js Buffer.from(' ', 'base64url') safely resolves to an empty string on the backend!
    const authToken = authParams ? toBase64Url(authParams) : '%20';
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

  const [server, setServer] = useState(3);

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
  
  const currentVlcUrl = server === 3 ? SERVER_3_URL : (selectedStream ? toVlcProxyUrl(selectedStream.url, vlcAuthParams) : fallback.vlcUrl);
  const resolutionOptions = selectedStream ? getResolutionOptions(selectedStream) : [];
  const availableQualities = [
    ...new Set([
      ...resolutionOptions,
      ...mp4Links.map((link) => `${getResolutionNumber(link.label)}p`).filter((quality) => quality !== '0p'),
    ]),
  ].sort((a, b) => getResolutionNumber(b) - getResolutionNumber(a));
  const selectedQuality = availableQualities[selectedMp4Index] || availableQualities[0] || '';
  const selectedMp4 = mp4Links.find((link) => getResolutionNumber(link.label) === getResolutionNumber(selectedQuality));
  
  const canPlayInBrowser = server === 3 ? true : (selectedStream ? !isHevc : !!fallback.browserStream);
  const currentBrowserStream = server === 3
    ? { url: SERVER_3_URL, authParams: '', streams: [{ url: SERVER_3_URL, format: 'm3u8', title: 'Live' }], streamIndex: 0 }
    : (selectedStream ? { url: selectedStream.url, authParams: getAuthParams(selectedStream), streams: fallback.allStreams, streamIndex: selectedIndex } : fallback.browserStream);

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
          
          {fallback.isLiveSports && (
            <div className="mb-4 mt-2">
              <div className="text-sm text-gray-400 mb-2">Select Server:</div>
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => setServer(3)}
                  className={`flex-1 py-2 px-1 rounded-md font-medium transition-colors text-sm ${server === 3 ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                >
                  Server 3 (Hindi)
                </button>
              </div>

            </div>
          )}

          {fallback.allStreams && fallback.allStreams.length > 0 && server === 1 ? (
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
  const playbackUrl = toVlcProxyUrl(url, authParams);

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
    
    let hlsPlayer: Hls | null = null;
    
    // If it's an MP4 or other native format, don't use Dash.js
    if (!isDash) {
      if ((url.includes('.m3u8') || url.includes('.m3u')) && Hls.isSupported()) {
        hlsPlayer = new Hls({
          xhrSetup: (xhr, u) => {
            xhr.open('GET', toVlcProxyUrl(u, authParams), true);
          },
          debug: false
        });
        hlsPlayer.on(Hls.Events.ERROR, (_, data) => {
          console.error('HLS Error:', data.type, data.details, data.fatal ? 'FATAL' : '');
          if (data.response && data.response.code) {
             console.error('HLS HTTP Status:', data.response.code);
          }
        });
        hlsPlayer.loadSource(playbackUrl);
        hlsPlayer.attachMedia(video);
      } else {
        video.src = playbackUrl;
      }
      
      return () => {
        video.removeEventListener('play', syncPlaybackState);
        video.removeEventListener('pause', syncPlaybackState);
        video.removeEventListener('timeupdate', syncPlaybackState);
        video.removeEventListener('loadedmetadata', syncPlaybackState);
        video.removeEventListener('loadedmetadata', restoreStartTime);
        video.removeEventListener('volumechange', syncPlaybackState);
        if (hlsPlayer) {
          hlsPlayer.destroy();
        }
      };
    }

    const player = MediaPlayer().create();
    playerRef.current = player;
    
    player.addRequestInterceptor((request: any) => {
      request.url = toVlcProxyUrl(request.url, authParams);
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

type TabType = 'home' | 'movies' | 'tvshows' | 'anime' | 'fifa';

interface UserAccount {
  id: string;
  username: string;
  email: string;
  avatar: string;
  tier: 'trial' | 'premium';
  trialEndDate: string;
}

function App() {
  const [account, setAccount] = useState<UserAccount | null>(null)
  
  // Modals
  const [isPremiumModalOpen, setIsPremiumModalOpen] = useState(false)
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false)
  const [editUsername, setEditUsername] = useState('')
  const [isTrialWarningModalOpen, setIsTrialWarningModalOpen] = useState(false)
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(null)
  const [isTrialExpired, setIsTrialExpired] = useState(false)
  
  useEffect(() => {
    let currentAccount = account;
    const savedAccount = localStorage.getItem('popcorn_account');
    if (savedAccount) {
      currentAccount = JSON.parse(savedAccount);
      setAccount(currentAccount);
    } else {
      const randomId = Math.floor(1000 + Math.random() * 9000);
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 7);
      
      const newAccount: UserAccount = {
        id: `guest_${randomId}`,
        username: `Guest_${randomId}`,
        email: `guest_${randomId}@popcorn.movies`,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${randomId}&backgroundColor=b6e3f4`,
        tier: 'trial',
        trialEndDate: trialEnd.toISOString()
      };
      
      localStorage.setItem('popcorn_account', JSON.stringify(newAccount));
      currentAccount = newAccount;
      setAccount(newAccount);
    }
    
    // Calculate Expiration
    if (currentAccount && currentAccount.tier === 'trial') {
      const msLeft = new Date(currentAccount.trialEndDate).getTime() - new Date().getTime();
      const daysLeft = Math.ceil(msLeft / (1000 * 3600 * 24));
      setTrialDaysRemaining(daysLeft);
      
      if (daysLeft <= 0) {
        setIsTrialExpired(true);
      } else if (daysLeft <= 2) {
        setIsTrialWarningModalOpen(true);
      }
    }
  }, []);
  
  const [movies, setMovies] = useState<any[]>([])
  const moviesRef = useRef<any[]>([])
  useEffect(() => {
    moviesRef.current = movies;
  }, [movies]);
  const [fifaMatches, setFifaMatches] = useState<any[]>([])
  const [fifaLatestMatch, setFifaLatestMatch] = useState<any>(null)
  const [fifaVoteRank, setFifaVoteRank] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const roastMessage = useRotatingMessage(ROAST_LOADING_MESSAGES);
  const roastMoreMessage = useRotatingMessage(ROAST_LOADING_MORE, 3000);
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isFetchingPlay, setIsFetchingPlay] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('home')
  const [showFifaPromo, setShowFifaPromo] = useState(() => !sessionStorage.getItem('fifaPromoSeen'))
  
  // UI State
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  
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
  const isFetchingRef = useRef(false)

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

    isFetchingRef.current = true;
    if (page === 1) setLoading(true);
    else setLoadingMore(true);
    
    setError(null)
    
    let fetchPromise;
    if (activeTab === 'fifa') {
      const fifaLeagueId = "4186762757372631736";
      fetchPromise = Promise.all([
        fetch(`/api/sports/aggregate?leagueId=${fifaLeagueId}`).then(r => r.json()),
        fetch(`/api/sports/match-list?leagueId=${fifaLeagueId}`).then(r => r.json())
      ]).then(([aggregate, matchListRes]) => {
         const allMatches = matchListRes?.data?.list || [];
         const filtered = allMatches.filter((m: any) => String(m.leagueId) === fifaLeagueId);
         filtered.sort((a: any, b: any) => {
           const statusOrder: any = { 'MatchLiving': 0, 'MatchNotStart': 1, 'MatchEnded': 2 };
           const orderA = statusOrder[a.status] ?? 99;
           const orderB = statusOrder[b.status] ?? 99;
           if (orderA !== orderB) return orderA - orderB;
           if (a.status === 'MatchEnded') return parseInt(b.startTime) - parseInt(a.startTime);
           return parseInt(a.startTime) - parseInt(b.startTime);
         });
         return {
           isFifa: true,
           aggregate: aggregate?.data || {},
           matchList: filtered
         }
      });
    } else if (searchQuery.trim() !== '') {
      fetchPromise = searchMovies(searchQuery.trim(), page, 20)
    } else {
      let tabId = "0";
      if (activeTab === 'movies') tabId = "1";
      else if (activeTab === 'tvshows') tabId = "2";
      else if (activeTab === 'anime') tabId = "1006";

      let filtersToUse = currentFilters;
      if (activeTab === 'home') {
        filtersToUse = { ...currentFilters, classify: 'Hindi dub' };
      }

      fetchPromise = getCategoryList(tabId, page, 20, filtersToUse);
    }

    let isSubscribed = true;
    fetchPromise
      .then(payload => {
        if (!isSubscribed) return;
        
        if (activeTab === 'fifa' && payload.isFifa) {
          setFifaMatches(payload.matchList || []);
          setFifaLatestMatch(payload.aggregate.latestMatch || null);
          setFifaVoteRank(payload.aggregate.leagueVoteRank || []);
          setMovies([]);
          setHasMore(false);
        } else {
          const items = payload || [];
          // Filter out non-movie/tvshow items (like youtube clips which have no posters) and items with broken covers
          const validItems = items.filter((item: any) => {
            const hasCover = item.cover && (item.cover.url || typeof item.cover === 'string');
            return hasCover && (item.subjectType === 1 || item.subjectType === 2 || !item.subjectType);
          });
          
          setMovies(prev => {
            if (page === 1) {
              setHasMore(validItems.length > 0);
              return validItems;
            }
            
            const existingIds = new Set(prev.map(m => m.id || m.subjectId));
            const newItems = validItems.filter((item: any) => !existingIds.has(item.id || item.subjectId));
            
            if (validItems.length > 0 && newItems.length === 0) {
              setHasMore(false); // Stop if we only got duplicates
            } else {
              setHasMore(items.length > 0);
            }
            return [...prev, ...newItems];
          });
        }
        setLoading(false);
        setLoadingMore(false);
        // Delay releasing the fetch lock to allow React to render DOM (prevents infinite scroll triggering instantly)
        setTimeout(() => {
          if (isSubscribed) isFetchingRef.current = false;
        }, 300);
      })
      .catch(err => {
        if (!isSubscribed) return;
        console.error(err)
        setError(err.message)
        setLoading(false)
        setLoadingMore(false)
        setTimeout(() => {
          if (isSubscribed) isFetchingRef.current = false;
        }, 300);
      })

    return () => {
      isSubscribed = false;
      isFetchingRef.current = false;
    }
  }, [searchQuery, activeTab, currentFilters, page])

  // Polling effect for live sports data
  useEffect(() => {
    if (activeTab !== 'fifa') return;
    
    const interval = setInterval(() => {
      const fifaLeagueId = "4186762757372631736";
      Promise.all([
        fetch(`/api/sports/aggregate?leagueId=${fifaLeagueId}`).then(r => r.json()),
        fetch(`/api/sports/match-list?leagueId=${fifaLeagueId}`).then(r => r.json())
      ]).then(([aggregate, matchListRes]) => {
         setFifaLatestMatch(aggregate?.data?.latestMatch || null);
         const allMatches = matchListRes?.data?.list || [];
         const filtered = allMatches.filter((m: any) => String(m.leagueId) === fifaLeagueId);
         filtered.sort((a: any, b: any) => {
           const statusOrder: any = { 'MatchLiving': 0, 'MatchNotStart': 1, 'MatchEnded': 2 };
           const orderA = statusOrder[a.status] ?? 99;
           const orderB = statusOrder[b.status] ?? 99;
           if (orderA !== orderB) return orderA - orderB;
           if (a.status === 'MatchEnded') return parseInt(b.startTime) - parseInt(a.startTime);
           return parseInt(a.startTime) - parseInt(b.startTime);
         });
         setFifaMatches(filtered);
         setFifaVoteRank(aggregate?.data?.leagueVoteRank || []);
      }).catch(console.error);
    }, 30000);
    
    return () => clearInterval(interval);
  }, [activeTab]);

  // IntersectionObserver for robust infinite scrolling
  const loaderRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isFetchingRef.current) {
          isFetchingRef.current = true;
          setLoadingMore(true);
          setPage(p => p + 1);
        }
      },
      { root: null, rootMargin: '400px', threshold: 0.1 }
    );

    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }

    return () => {
      if (loaderRef.current) {
        observer.unobserve(loaderRef.current);
      }
      observer.disconnect();
    };
  }, [hasMore, loading]);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setSearchQuery(e.currentTarget.value)
      setPage(1)
      setHasMore(true)
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
           let allEps: any[] = [];
           let epPage = 1;
           while (epPage <= 10) {
             const resources = await getResourceLinks(subjectId, String(firstSeason), epPage);
             const list = resources.list || [];
             if (list.length === 0) break;
             allEps = [...allEps, ...list];
             if (list[list.length - 1].se > firstSeason) break;
             if (list.length < 20) break;
             epPage++;
           }
           setEpisodeList(allEps.filter((e: any) => e.se === firstSeason));
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
      let allEps: any[] = [];
      let epPage = 1;
      let foundSeason = false;
      while (epPage <= 10) {
        const resources = await getResourceLinks(selectedMovieId, String(seasonNum), epPage);
        const list = resources.list || [];
        if (list.length === 0) break;
        allEps = [...allEps, ...list];
        
        const seasonEps = list.filter((e: any) => e.se === seasonNum);
        if (seasonEps.length > 0) foundSeason = true;
        if (foundSeason && list[list.length - 1].se > seasonNum) break;
        
        if (list.length < 20) break;
        epPage++;
      }
      setEpisodeList(allEps.filter((e: any) => e.se === seasonNum));
    } catch (err) {
      console.error(err);
    }
  }

  const openPlaybackOptions = async (se: string = '0', ep: string = '0') => {
    if (!selectedMovieId || isFetchingPlay) return;

    if (movieDetails?.isLiveSports || selectedMovieId === 'fifa-live') {
      setVlcFallback({
        title: movieDetails?.title || 'Live Stream',
        format: '',
        resolution: '',
        directUrl: SERVER_3_URL,
        vlcUrl: SERVER_3_URL,
        allStreams: [],
        browserStream: { url: SERVER_3_URL, authParams: '', streams: [{ url: SERVER_3_URL, format: 'm3u8', title: 'Live' }], streamIndex: 0 },
        streamIndex: 0,
        subjectId: selectedMovieId,
        se,
        ep,
        isLiveSports: true
      });
      return;
    }

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

    if (movieDetails?.isLiveSports || selectedMovieId === 'fifa-live') {
      setPlayingVideo({ url: SERVER_3_URL, authParams: '', streams: [{ url: SERVER_3_URL, format: 'm3u8', title: 'Live' }], streamIndex: 0 });
      return;
    }

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

  if (MAINTENANCE_MODE) {
    return <MaintenancePage />;
  }

  return (
    <div className="app-shell">
      {playingVideo && (
        playingVideo.iframeUrl ? (
          <div className="fixed inset-0 z-[1000] bg-black flex flex-col">
            <div className="flex justify-end p-4 absolute top-0 right-0 z-10 pointer-events-none">
              <button onClick={() => setPlayingVideo(null)} className="bg-black/50 hover:bg-black/80 text-white rounded-full p-2 pointer-events-auto backdrop-blur-sm transition-all">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <iframe src={playingVideo.iframeUrl} className="w-full h-full border-0" allowFullScreen allow="autoplay; encrypted-media"></iframe>
          </div>
        ) : (
          <VideoPlayer
            url={playingVideo.url}
            authParams={playingVideo.authParams}
            streams={playingVideo.streams}
            streamIndex={playingVideo.streamIndex}
            startTime={playingVideo.startTime}
            onQualityChange={handleQualityChange}
            onClose={() => setPlayingVideo(null)}
          />
        )
      )}

      {showFifaPromo && (
        <div className="modal-backdrop" style={{ zIndex: 10000 }}>
          <div className="bg-gray-900 rounded-xl overflow-hidden max-w-md w-full mx-4 shadow-2xl border border-gray-800 relative" style={{ animation: 'fadeIn 0.3s ease-out' }}>
            <button 
              onClick={() => {
                sessionStorage.setItem('fifaPromoSeen', 'true');
                setShowFifaPromo(false);
              }}
              className="absolute top-3 right-3 bg-black bg-opacity-50 hover:bg-opacity-80 text-white rounded-full p-2 transition-all z-10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
            <img src="/fifa-promo.png" alt="Spain vs Argentina - 2026 World Cup Final" className="w-full object-cover" style={{ maxHeight: '320px' }} />
            <div className="p-5 text-center">
              <h2 className="text-xl font-bold text-white mb-1">🏆 2026 FIFA World Cup Final</h2>
              <p className="text-gray-400 mb-4 text-sm">Spain vs Argentina — July 19 • Watch it LIVE on Popcorn Movies!</p>
              <button 
                onClick={() => {
                  sessionStorage.setItem('fifaPromoSeen', 'true');
                  setShowFifaPromo(false);
                  setActiveTab('fifa');
                  setSearchQuery('');
                  setPage(1);
                  setHasMore(true);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full bg-[#00ff88] text-black font-bold py-3 px-4 rounded-lg hover:bg-[#00cc66] transition-colors shadow-[0_0_15px_rgba(0,255,136,0.3)]"
              >
                WATCH NOW
              </button>
            </div>
          </div>
        </div>
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
      
      {/* Sidebar Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}
      
      {/* Sidebar */}
      <aside className={`sidebar ${isMobileMenuOpen ? 'is-open' : ''}`}>
        <h1 className="brand-mark" aria-label="Popcorn Movies">
          <div style={{ display: 'block' }}>
            <span className="brand-pop">Pop</span><span className="brand-corn">corn</span>
          </div>
          <div className="brand-movies" style={{ display: 'block', fontSize: '0.45em', fontWeight: '500', color: '#ffb74d', letterSpacing: '2px', textTransform: 'uppercase', textAlign: 'right', marginTop: '2px', paddingRight: '5px' }}>Movies</div>
        </h1>
        <nav className="sidebar-nav">
          <a href="#" className={activeTab === 'home' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('home'); setSearchQuery(''); setPage(1); setHasMore(true); setIsMobileMenuOpen(false); }}>Home</a>
          <a href="#" className={activeTab === 'movies' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('movies'); setSearchQuery(''); setPage(1); setHasMore(true); setIsMobileMenuOpen(false); }}>Movies</a>
          <a href="#" className={activeTab === 'tvshows' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('tvshows'); setSearchQuery(''); setPage(1); setHasMore(true); setIsMobileMenuOpen(false); }}>TV Shows</a>
          <a href="#" className={activeTab === 'anime' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('anime'); setSearchQuery(''); setPage(1); setHasMore(true); setIsMobileMenuOpen(false); }}>Anime</a>
          <a href="#" className={activeTab === 'fifa' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('fifa'); setSearchQuery(''); setPage(1); setHasMore(true); setIsMobileMenuOpen(false); }} style={{ color: '#00ff88', fontWeight: 'bold', borderLeft: activeTab === 'fifa' ? '3px solid #00ff88' : 'none' }}>FIFA WORLD CUP</a>
        </nav>
        
        {/* Mobile Sidebar Account Section */}
        {account && (
          <div className="sidebar-account-section">
            <div className="account-dropdown-divider" style={{ margin: '0 -16px 16px -16px' }}></div>
            <div className="account-dropdown-header">
              <div className="profile-chip large" style={{ backgroundImage: `url(${account.avatar})`, backgroundSize: 'cover' }}></div>
              <div className="account-info">
                <span className="account-name">{account.username}</span>
                <span className="account-email">{account.email}</span>
                {account.tier === 'premium' ? (
                  <span className="account-badge premium">⭐ Premium Member</span>
                ) : (
                  <span className="account-badge trial">✨ Free Trial ({Math.ceil((new Date(account.trialEndDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24))} days left)</span>
                )}
              </div>
            </div>
            {account.tier !== 'premium' && (
              <button className="upgrade-premium-btn" onClick={() => { setIsMobileMenuOpen(false); setIsPremiumModalOpen(true); }}>
                Upgrade to Premium
              </button>
            )}
            <ul className="account-menu-list">
              <li onClick={() => { setIsMobileMenuOpen(false); setEditUsername(account.username); setIsEditProfileModalOpen(true); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Edit Profile
              </li>
              <li>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Watch History
              </li>
              <li>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                Preferences
              </li>
              <li className="logout" onClick={() => { localStorage.removeItem('popcorn_account'); window.location.reload(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Log Out
              </li>
            </ul>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="content-area">
        <header className="content-header">
          <button className="menu-toggle" aria-label="Open navigation" onClick={() => setIsMobileMenuOpen(true)}>
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
          <div className="topbar-actions" style={{ position: 'relative' }}>
            <button className="notification-button" aria-label="Notifications"><span>3</span></button>
            <div 
              className="profile-chip" 
              aria-label="Profile" 
              onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
              style={account ? { backgroundImage: `url(${account.avatar})`, backgroundSize: 'cover' } : {}}
            ></div>
            
            {/* Account Settings Dropdown */}
            {isAccountMenuOpen && account && (
              <div className="account-dropdown">
                <div className="account-dropdown-header">
                  <div className="profile-chip large" style={{ backgroundImage: `url(${account.avatar})`, backgroundSize: 'cover' }}></div>
                  <div className="account-info">
                    <span className="account-name">{account.username}</span>
                    <span className="account-email">{account.email}</span>
                    {account.tier === 'premium' ? (
                      <span className="account-badge premium">⭐ Premium Member</span>
                    ) : (
                      <span className="account-badge trial">✨ Free Trial ({Math.ceil((new Date(account.trialEndDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24))} days left)</span>
                    )}
                  </div>
                </div>
                {account.tier !== 'premium' && (
                  <button className="upgrade-premium-btn" onClick={() => { setIsAccountMenuOpen(false); setIsPremiumModalOpen(true); }}>
                    Upgrade to Premium
                  </button>
                )}
                <div className="account-dropdown-divider"></div>
                <ul className="account-menu-list">
                  <li onClick={() => { setIsAccountMenuOpen(false); setEditUsername(account.username); setIsEditProfileModalOpen(true); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    Edit Profile
                  </li>
                  <li>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Watch History
                  </li>
                  <li>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                    Preferences
                  </li>
                </ul>
                <div className="account-dropdown-divider"></div>
                <ul className="account-menu-list">
                  <li className="logout" onClick={() => { localStorage.removeItem('popcorn_account'); window.location.reload(); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Log Out
                  </li>
                </ul>
              </div>
            )}
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
              : activeTab === 'fifa' ? 'FIFA World Cup Matches'
              : 'Trending Now'
            }
          </h2>
        </section>

        {filterOptions.length > 0 && activeTab !== 'home' && (
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
                      {filterGroup.filterValsV2.filter((value: any) => value.id !== 'All' && value.id !== 'Hottest').map((value: any) => (
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
                    {filterOptions.find(f => f.filterType === 'sort').filterValsV2.filter((val: any) => val.id !== 'Hottest').map((val: any) => (
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

        {loading && <div className="state-panel" style={{ fontStyle: 'italic', transition: 'opacity 0.3s ease' }}>{roastMessage}</div>}
        {error && <div className="state-panel error">Error: {error}</div>}

        {/* Movie Grid */}
        {/* Movie Grid */}
        {!loading && !error && activeTab !== 'fifa' && (
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

        {/* FIFA Custom World Cup Layout */}
        {!loading && !error && activeTab === 'fifa' && (
          <div className="world-cup-container">
            
            {/* Hero Featured Match */}
            {fifaLatestMatch && (
              <div 
                className="hero-match-card"
                style={{ cursor: fifaLatestMatch.playPath ? 'pointer' : 'default' }}
                onClick={() => {
                  if (fifaLatestMatch.playPath) {
                    setPlayingVideo({ url: SERVER_3_URL, authParams: '', streams: [{ url: SERVER_3_URL, format: 'm3u8', title: 'Live' }], streamIndex: 0 });
                  }
                }}
              >
                <div className="hero-header">
                  <span className="hero-title">World Cup {fifaLatestMatch.matchRound ? `- ${fifaLatestMatch.matchRound}` : ''}</span>
                  {fifaLatestMatch.status === 'MatchEnded' ? (
                    <span className="hero-badge">Finished</span>
                  ) : fifaLatestMatch.status === 'MatchLiving' ? (
                    <span className="hero-badge live">Live</span>
                  ) : (
                    <span className="hero-badge">Upcoming</span>
                  )}
                </div>
                <div className="hero-teams">
                  <div className="hero-team">
                    <span className="hero-team-name">{fifaLatestMatch.team1.name}</span>
                    <img src={fifaLatestMatch.team1.avatar} alt={fifaLatestMatch.team1.name} />
                  </div>
                  <div className="hero-vs">
                    {fifaLatestMatch.status === 'MatchEnded' ? `${fifaLatestMatch.team1.score} - ${fifaLatestMatch.team2.score}` : 'VS'}
                  </div>
                  <div className="hero-team reverse">
                    <span className="hero-team-name">{fifaLatestMatch.team2.name}</span>
                    <img src={fifaLatestMatch.team2.avatar} alt={fifaLatestMatch.team2.name} />
                  </div>
                </div>
                {fifaLatestMatch.status === 'MatchEnded' && (
                  <div className="match-row-actions" style={{ justifyContent: 'center', marginTop: '16px' }} onClick={(e) => e.stopPropagation()}>
                    {fifaLatestMatch.replay && fifaLatestMatch.replay.length > 0 && (
                      <button className="match-action-btn" onClick={() => {
                        setVlcFallback({
                          title: `Replay: ${fifaLatestMatch.team1.name} vs ${fifaLatestMatch.team2.name}`,
                          format: 'mp4',
                          resolution: '1080p',
                          directUrl: fifaLatestMatch.replay[0].path,
                          vlcUrl: fifaLatestMatch.replay[0].path,
                          browserStream: {
                            url: fifaLatestMatch.replay[0].path,
                            authParams: '',
                            streams: [{ url: fifaLatestMatch.replay[0].path, format: 'mp4', title: 'Replay' }],
                            streamIndex: 0
                          }
                        });
                      }}>Replay 📺</button>
                    )}
                    {fifaLatestMatch.highlights && fifaLatestMatch.highlights.length > 0 && (
                      <button className="match-action-btn" onClick={() => {
                        setVlcFallback({
                          title: `Highlights: ${fifaLatestMatch.team1.name} vs ${fifaLatestMatch.team2.name}`,
                          format: 'mp4',
                          resolution: '1080p',
                          directUrl: fifaLatestMatch.highlights[0].path,
                          vlcUrl: fifaLatestMatch.highlights[0].path,
                          browserStream: {
                            url: fifaLatestMatch.highlights[0].path,
                            authParams: '',
                            streams: [{ url: fifaLatestMatch.highlights[0].path, format: 'mp4', title: 'Highlights' }],
                            streamIndex: 0
                          }
                        });
                      }}>Highlights 🎬</button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Team Votes Podium */}
            {fifaVoteRank && fifaVoteRank.length >= 3 && (
              <div className="team-votes-section">
                <h3 className="votes-title">World Cup Team Votes</h3>
                <div className="podium-container">
                  {/* Rank 2 - Left */}
                  <div className="podium-item rank-2">
                    <div className="podium-avatar-wrapper">
                      <img src={fifaVoteRank[1].avatar} className="podium-avatar" alt={fifaVoteRank[1].name} />
                      <div className="podium-badge">2</div>
                      <div className="podium-tecno">TECNO</div>
                    </div>
                    <span className="podium-name">{fifaVoteRank[1].name}</span>
                    <span className="podium-votes">⚡ {Number(fifaVoteRank[1].voteCount).toLocaleString()}</span>
                  </div>
                  
                  {/* Rank 1 - Center */}
                  <div className="podium-item rank-1">
                    <div className="podium-avatar-wrapper">
                      <img src={fifaVoteRank[0].avatar} className="podium-avatar" alt={fifaVoteRank[0].name} />
                      <div className="podium-badge">1</div>
                      <div className="podium-tecno">TECNO</div>
                    </div>
                    <span className="podium-name">{fifaVoteRank[0].name}</span>
                    <span className="podium-votes">⚡ {Number(fifaVoteRank[0].voteCount).toLocaleString()}</span>
                  </div>

                  {/* Rank 3 - Right */}
                  <div className="podium-item rank-3">
                    <div className="podium-avatar-wrapper">
                      <img src={fifaVoteRank[2].avatar} className="podium-avatar" alt={fifaVoteRank[2].name} />
                      <div className="podium-badge">3</div>
                      <div className="podium-tecno">TECNO</div>
                    </div>
                    <span className="podium-name">{fifaVoteRank[2].name}</span>
                    <span className="podium-votes">⚡ {Number(fifaVoteRank[2].voteCount).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Compact Matches List */}
            <div className="matches-section-header">
              <h2>Matches</h2>
              <span>All &gt;</span>
            </div>
            <div className="matches-date">Jul 12, 2026</div>
            
            <div className="matches-list-container">
              {fifaMatches.map((match: any, i: number) => {
                const uniqueKey = `${match.id}-${i}`;
                const isEnded = match.status === 'MatchEnded';
                const matchDate = new Date(parseInt(match.startTime));
                const timeString = matchDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + matchDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                
                return (
                  <div 
                    key={uniqueKey} 
                    className="match-row-card"
                    onClick={() => {
                      if (isEnded) return;

                      let streamUrl = match.playPath;
                      if (!streamUrl && match.playSource && match.playSource.length > 0) {
                        const urlMatch = match.playSource[0].path.match(/url=(.*?)&/);
                        if (urlMatch) streamUrl = decodeURIComponent(urlMatch[1]);
                      }
                      if (streamUrl) {
                        setPlayingVideo({ url: SERVER_3_URL, authParams: '', streams: [{ url: SERVER_3_URL, format: 'm3u8', title: 'Live' }], streamIndex: 0 });
                      } else {
                        alert(`The live stream for ${match.team1.name} vs ${match.team2.name} is not available yet! Please check back closer to kickoff.`);
                      }
                    }}
                  >
                    <div className="match-row-top">
                      <span>{timeString}</span>
                      <span>{match.matchRound || 'World Cup'}</span>
                      {match.status === 'MatchLiving' ? (
                        <span style={{ color: '#ff4d4d', fontWeight: 'bold', animation: 'pulse 2s infinite' }}>Live 🔴</span>
                      ) : (
                        <span>⭐</span>
                      )}
                    </div>
                    
                    <div className="match-row-main">
                      <div className="match-row-team left">
                        <span className="match-row-team-name">{match.team1.name}</span>
                        <img src={match.team1.avatar} className="match-row-avatar" alt={match.team1.name} />
                      </div>
                      
                      <div className="match-row-score">
                        {isEnded ? `${match.team1.score} - ${match.team2.score}` : 'VS'}
                      </div>
                      
                      <div className="match-row-team right">
                        <img src={match.team2.avatar} className="match-row-avatar" alt={match.team2.name} />
                        <span className="match-row-team-name">{match.team2.name}</span>
                      </div>
                    </div>
                    
                    {isEnded && (
                      <div className="match-row-actions" onClick={(e) => e.stopPropagation()}>
                        {match.replay && match.replay.length > 0 && (
                          <button className="match-action-btn" onClick={() => {
                            setVlcFallback({
                              title: `Replay: ${match.team1.name} vs ${match.team2.name}`,
                              format: 'mp4',
                              resolution: '1080p',
                              directUrl: match.replay[0].path,
                              vlcUrl: match.replay[0].path,
                              browserStream: {
                                url: match.replay[0].path,
                                authParams: '',
                                streams: [{ url: match.replay[0].path, format: 'mp4', title: 'Replay' }],
                                streamIndex: 0
                              }
                            });
                          }}>Replay 📺</button>
                        )}
                        {match.highlights && match.highlights.length > 0 && (
                          <button className="match-action-btn" onClick={() => {
                            setVlcFallback({
                              title: `Highlights: ${match.team1.name} vs ${match.team2.name}`,
                              format: 'mp4',
                              resolution: '1080p',
                              directUrl: match.highlights[0].path,
                              vlcUrl: match.highlights[0].path,
                              browserStream: {
                                url: match.highlights[0].path,
                                authParams: '',
                                streams: [{ url: match.highlights[0].path, format: 'mp4', title: 'Highlights' }],
                                streamIndex: 0
                              }
                            });
                          }}>Highlights 🎬</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {loadingMore && (
          <div className="py-8 text-center text-gray-400">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" role="status">
              <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">Loading...</span>
            </div>
            <p className="mt-2 text-sm" style={{ fontStyle: 'italic' }}>{roastMoreMessage}</p>
          </div>
        )}
        
        {/* Invisible target for IntersectionObserver infinite scrolling */}
        <div ref={loaderRef} style={{ height: '20px', width: '100%' }} />
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
      
      {/* Edit Profile Modal */}
      {isEditProfileModalOpen && account && (
        <div className="details-backdrop" style={{ zIndex: 200 }}>
          <div className="details-shell" style={{ maxWidth: '400px', margin: '10vh auto', padding: '24px' }}>
            <button className="details-close" onClick={() => setIsEditProfileModalOpen(false)}>×</button>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px', color: '#fff' }}>Edit Profile</h2>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
              <img src={account.avatar} alt="Avatar" style={{ width: '96px', height: '96px', borderRadius: '50%', background: '#b6e3f4' }} />
              <button 
                className="match-action-btn" 
                onClick={() => {
                  const newSeed = Math.floor(Math.random() * 10000);
                  const newAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${newSeed}&backgroundColor=b6e3f4`;
                  setAccount({ ...account, avatar: newAvatar });
                  localStorage.setItem('popcorn_account', JSON.stringify({ ...account, avatar: newAvatar }));
                }}
              >
                Randomize Avatar 🎲
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ color: '#888', fontSize: '14px' }}>Username</label>
              <input 
                type="text" 
                value={editUsername} 
                onChange={(e) => setEditUsername(e.target.value)} 
                className="search-input" 
                style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)' }} 
              />
            </div>
            <button 
              className="upgrade-premium-btn" 
              style={{ marginTop: '24px', width: '100%' }}
              onClick={() => {
                if (editUsername.trim()) {
                  setAccount({ ...account, username: editUsername.trim() });
                  localStorage.setItem('popcorn_account', JSON.stringify({ ...account, username: editUsername.trim() }));
                }
                setIsEditProfileModalOpen(false);
              }}
            >
              Save Changes
            </button>
          </div>
        </div>
      )}
      
      {/* Trial Expired Mask */}
      {isTrialExpired && account?.tier !== 'premium' && (
        <div className="details-backdrop" style={{ zIndex: 9999, backdropFilter: 'blur(20px)', background: 'rgba(0,0,0,0.85)' }}>
          <div className="details-shell" style={{ maxWidth: '500px', margin: '20vh auto', padding: '0', background: 'linear-gradient(180deg, #1a1625 0%, #0f1016 100%)', border: '1px solid rgba(255,82,0,0.5)', textAlign: 'center' }}>
            <div style={{ padding: '40px 32px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏰</div>
              <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: '#fff', marginBottom: '16px' }}>Your Free Trial has Expired!</h2>
              <p style={{ color: '#aaa', fontSize: '16px', marginBottom: '32px' }}>
                You've run out of free trial time. Upgrade to Premium for <strong>FREE</strong> to continue watching your favorite movies and shows!
              </p>
              
              <button 
                className="upgrade-premium-btn" 
                style={{ width: '100%', padding: '16px', fontSize: '18px', fontWeight: 'bold', background: 'linear-gradient(90deg, #0088cc, #00aaff)', border: 'none', borderRadius: '12px', color: '#fff', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0, 170, 255, 0.3)', marginBottom: '16px' }}
                onClick={() => {
                  if (account) {
                    window.open('https://t.me/+lGFcHVz_gy0wZThl', '_blank');
                    const updatedAccount = { ...account, tier: 'premium' as const };
                    setAccount(updatedAccount);
                    localStorage.setItem('popcorn_account', JSON.stringify(updatedAccount));
                    setIsTrialExpired(false);
                  }
                }}
              >
                Join Telegram to Upgrade for FREE
              </button>
              
              <button 
                style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', padding: '12px', borderRadius: '8px', color: '#888', cursor: 'pointer', width: '100%' }} 
                onClick={() => {
                  window.location.href = 'https://google.com';
                }}
              >
                Exit Site
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trial Warning Modal */}
      {isTrialWarningModalOpen && account?.tier !== 'premium' && (
        <div className="details-backdrop" style={{ zIndex: 300, backdropFilter: 'blur(5px)' }}>
          <div className="details-shell" style={{ maxWidth: '400px', margin: '15vh auto', padding: '32px', textAlign: 'center', background: '#1a1625', border: '1px solid rgba(255,183,77,0.3)' }}>
            <button className="details-close" onClick={() => setIsTrialWarningModalOpen(false)}>×</button>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#ffb74d', marginBottom: '12px' }}>Trial Expiring Soon!</h2>
            <p style={{ color: '#aaa', fontSize: '16px', marginBottom: '24px' }}>
              You only have <strong>{trialDaysRemaining} days left</strong> on your Free Trial. Don't lose access!
            </p>
            <button 
              className="upgrade-premium-btn" 
              style={{ width: '100%', padding: '14px', fontSize: '16px', fontWeight: 'bold', background: 'linear-gradient(90deg, #0088cc, #00aaff)', border: 'none', borderRadius: '12px', color: '#fff', cursor: 'pointer' }}
              onClick={() => {
                if (account) {
                  window.open('https://t.me/+lGFcHVz_gy0wZThl', '_blank');
                  const updatedAccount = { ...account, tier: 'premium' as const };
                  setAccount(updatedAccount);
                  localStorage.setItem('popcorn_account', JSON.stringify(updatedAccount));
                  setIsTrialWarningModalOpen(false);
                }
              }}
            >
              Join Telegram to Upgrade for FREE
            </button>
          </div>
        </div>
      )}

      {/* Premium Upgrade Modal */}
      {isPremiumModalOpen && account && (
        <div className="details-backdrop" style={{ zIndex: 200, backdropFilter: 'blur(10px)' }}>
          <div className="details-shell" style={{ maxWidth: '500px', margin: '5vh auto', padding: '0', background: 'linear-gradient(180deg, #1a1625 0%, #0f1016 100%)', border: '1px solid rgba(255,183,77,0.3)' }}>
            <button className="details-close" onClick={() => setIsPremiumModalOpen(false)}>×</button>
            <div style={{ padding: '40px 32px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>👑</div>
              <h2 style={{ fontSize: '32px', fontWeight: 'bold', color: '#ffb74d', marginBottom: '8px' }}>Go Premium</h2>
              <p style={{ color: '#aaa', fontSize: '16px', marginBottom: '32px' }}>Unlock the ultimate streaming experience.</p>
              
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 40px 0', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '16px', color: '#fff' }}>
                  <span style={{ color: '#00ff88' }}>✓</span> Ad-free streaming
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '16px', color: '#fff' }}>
                  <span style={{ color: '#00ff88' }}>✓</span> 4K Ultra HD & HDR Support
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '16px', color: '#fff' }}>
                  <span style={{ color: '#00ff88' }}>✓</span> Unlimited offline downloads
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '16px', color: '#fff' }}>
                  <span style={{ color: '#00ff88' }}>✓</span> Exclusive VIP titles
                </li>
              </ul>
              
              <button 
                className="upgrade-premium-btn" 
                style={{ width: '100%', padding: '16px', fontSize: '18px', fontWeight: 'bold', background: 'linear-gradient(90deg, #0088cc, #00aaff)', border: 'none', borderRadius: '12px', color: '#fff', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0, 170, 255, 0.4)' }}
                onClick={() => {
                  if (account) {
                    window.open('https://t.me/+lGFcHVz_gy0wZThl', '_blank');
                    const updatedAccount = { ...account, tier: 'premium' as const };
                    setAccount(updatedAccount);
                    localStorage.setItem('popcorn_account', JSON.stringify(updatedAccount));
                    setIsPremiumModalOpen(false);
                  }
                }}
              >
                Join Telegram to Upgrade for FREE
              </button>
              <button style={{ marginTop: '16px', background: 'none', border: 'none', color: '#888', cursor: 'pointer' }} onClick={() => setIsPremiumModalOpen(false)}>Maybe later</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   🍿 Under Maintenance Page
   ───────────────────────────────────────────────────────────── */
function MaintenancePage() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(145deg, #0a0c14 0%, #0f1117 40%, #161a26 100%)',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      {/* Animated background orbs */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(225,29,46,0.15) 0%, transparent 70%)',
          top: '-200px', right: '-150px',
          animation: 'maintenanceFloat 8s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(69,212,200,0.1) 0%, transparent 70%)',
          bottom: '-180px', left: '-100px',
          animation: 'maintenanceFloat 10s ease-in-out infinite reverse',
        }} />
        <div style={{
          position: 'absolute', width: 300, height: 300, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,184,75,0.08) 0%, transparent 70%)',
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          animation: 'maintenancePulse 4s ease-in-out infinite',
        }} />
        {/* Floating popcorn kernels */}
        {[...Array(12)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            fontSize: ['🍿', '🌽', '⚙️', '🔧', '✨', '🎬'][i % 6] ? '24px' : '20px',
            left: `${8 + (i * 7.5) % 90}%`,
            top: `${5 + (i * 13) % 85}%`,
            opacity: 0.12 + (i % 3) * 0.06,
            animation: `maintenanceKernel ${6 + i * 0.7}s ease-in-out infinite`,
            animationDelay: `${i * 0.4}s`,
          }}>
            {['🍿', '🌽', '⚙️', '🔧', '✨', '🎬'][i % 6]}
          </div>
        ))}
      </div>

      {/* Noise texture overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.03,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
      }} />

      {/* Main content card */}
      <div style={{
        position: 'relative', zIndex: 10,
        textAlign: 'center', maxWidth: 520, padding: '0 24px',
        animation: 'maintenanceFadeUp 1s ease-out',
      }}>
        {/* Animated gear icon */}
        <div style={{
          width: 100, height: 100, margin: '0 auto 32px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(225,29,46,0.15), rgba(245,184,75,0.1))',
          border: '1px solid rgba(225,29,46,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 60px rgba(225,29,46,0.15), inset 0 0 30px rgba(225,29,46,0.05)',
          animation: 'maintenancePulse 3s ease-in-out infinite',
        }}>
          <span style={{ fontSize: 44, animation: 'maintenanceSpin 4s linear infinite', display: 'block' }}>⚙️</span>
        </div>

        {/* Logo / Brand */}
        <h1 style={{
          fontSize: 32, fontWeight: 800, margin: '0 0 8px',
          background: 'linear-gradient(135deg, #ff4d5f, #f5b84b)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.02em',
        }}>
          🍿 Popcorn Movies
        </h1>

        {/* Status badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', borderRadius: 20,
          background: 'rgba(245,184,75,0.1)',
          border: '1px solid rgba(245,184,75,0.25)',
          marginBottom: 28,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#f5b84b',
            boxShadow: '0 0 8px rgba(245,184,75,0.6)',
            animation: 'maintenanceBlink 1.5s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#f5b84b', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
            Under Maintenance
          </span>
        </div>

        {/* Main message */}
        <h2 style={{
          fontSize: 26, fontWeight: 700, color: '#ffffff', margin: '0 0 14px',
          lineHeight: 1.3,
        }}>
          We're Cooking Something
          <br />
          <span style={{ color: '#ff4d5f' }}>Delicious</span> 🍳
        </h2>
        <p style={{
          fontSize: 16, color: '#a8b1c0', lineHeight: 1.7,
          margin: '0 0 36px',
        }}>
          Our servers are getting a fresh batch of popcorn and upgrades.
          <br />
          We'll be back before your popcorn gets cold!
        </p>

        {/* Progress bar */}
        <div style={{
          width: '100%', maxWidth: 320, margin: '0 auto 36px',
          height: 4, borderRadius: 4,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 4,
            background: 'linear-gradient(90deg, #e11d2e, #f5b84b, #45d4c8, #e11d2e)',
            backgroundSize: '300% 100%',
            animation: 'maintenanceProgress 2.5s linear infinite',
          }} />
        </div>

        {/* Animated working text */}
        <p style={{
          fontSize: 14, color: '#636e80', fontFamily: 'monospace',
          letterSpacing: '0.05em',
        }}>
          working on it{dots}
        </p>

        {/* Social / contact links */}
        <div style={{
          marginTop: 48, paddingTop: 28,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'center', gap: 24,
        }}>
          {[
            { label: 'Telegram', emoji: '💬', url: 'https://t.me/AyushPMP' },
            { label: 'GitHub', emoji: '🐙', url: 'https://github.com/AyushPMP' },
          ].map(link => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 13, color: '#636e80',
                textDecoration: 'none',
                padding: '8px 16px', borderRadius: 10,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                transition: 'all 0.25s ease',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
                (e.currentTarget as HTMLElement).style.color = '#ffffff';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                (e.currentTarget as HTMLElement).style.color = '#636e80';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)';
              }}
            >
              <span>{link.emoji}</span>
              {link.label}
            </a>
          ))}
        </div>
      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes maintenanceFloat {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-30px) scale(1.05); }
        }
        @keyframes maintenancePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.08); }
        }
        @keyframes maintenanceSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes maintenanceFadeUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes maintenanceBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes maintenanceProgress {
          from { background-position: 0% 0%; }
          to { background-position: 300% 0%; }
        }
        @keyframes maintenanceKernel {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-15px) rotate(8deg); }
          75% { transform: translateY(10px) rotate(-5deg); }
        }
      `}</style>
    </div>
  );
}

export default App
