import React, { useState, useEffect, useRef, useCallback } from 'react'
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
  title?: string;
  subjectId?: string;
  dubs?: any[];
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

const SERVER_3_URL = 'https://home.redjoytv.nz/plyr_player.php?b=aHR0cHM6Ly9odWdoLmNkbi5ydW1ibGUuY2xvdWQvbGl2ZS9yOHd2bDM1ay9zbG90LTUvaXdqNy1teHltL2NodW5rbGlzdC5tM3U4&title=Hindi+Stream';

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
  const url = String(stream.url || '').toLowerCase();
  const format = String(stream.format || '').toLowerCase();

  return codec.includes('hevc') || codec.includes('h265') || codec.includes('hev1') ||
         format.includes('hevc') || format.includes('h265') || format.includes('hev1') ||
         url.includes('h265') || url.includes('hevc');
}

function getStreamScore(stream: any): number {
  const format = String(stream.format || '').toLowerCase();
  const codec = String(stream.codecName || stream.codec || '').toLowerCase();
  const resolution = parseInt(String(stream.resolutions || '').split(',')[0], 10) || 0;
  const isMp4 = format === 'mp4' || stream.url?.includes('.mp4');
  const isH264 = codec === 'h264' || codec.includes('h264') || codec.includes('avc');
  const isHevc = isHevcStream(stream);

  if (isHevc) {
    return -50000 + resolution; // HEVC video fails to render on browser HTML5 video element
  }

  if (isH264 && isMp4) {
    return 200000 + resolution; // H.264 MP4 works 100% on all browsers
  }

  return (isMp4 ? 100000 : 10000) + resolution;
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

function getStreamLanguage(stream: any, idx: number = 0): string {
  const text = [
    stream.lang,
    stream.language,
    stream.audioLang,
    stream.audioName,
    stream.title,
    stream.name,
    stream.url,
  ].map((v) => String(v || '')).join(' ');

  if (/hindi|\bhin\b|\bhi\b/i.test(text)) return 'Hindi';
  if (/english|\beng\b|\ben\b/i.test(text)) return 'English';
  if (/tamil|\btam\b|\bta\b/i.test(text)) return 'Tamil';
  if (/telugu|\btel\b|\bte\b/i.test(text)) return 'Telugu';
  if (/kannada|\bkan\b|\bkn\b/i.test(text)) return 'Kannada';
  if (/malayalam|\bmal\b|\bml\b/i.test(text)) return 'Malayalam';
  if (/bengali|\bben\b|\bbn\b/i.test(text)) return 'Bengali';
  if (/marathi|\bmar\b|\bmr\b/i.test(text)) return 'Marathi';
  if (/punjabi|\bpan\b|\bpa\b/i.test(text)) return 'Punjabi';
  if (/urdu|\burd\b|\bur\b/i.test(text)) return 'Urdu';
  if (/spanish|\bspa\b|\bes\b/i.test(text)) return 'Spanish';
  if (/french|\bfre\b|\bfr\b/i.test(text)) return 'French';
  if (/german|\bger\b|\bde\b/i.test(text)) return 'German';
  if (/korean|\bkor\b|\bko\b/i.test(text)) return 'Korean';
  if (/japanese|\bjpn\b|\bja\b/i.test(text)) return 'Japanese';

  if (stream.title) return stream.title;
  return `Audio Track ${idx + 1}`;
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
  
  const canPlayInBrowser = true;
  const currentBrowserStream = server === 3
    ? { url: '', authParams: '', streams: [], streamIndex: 0, iframeUrl: SERVER_3_URL }
    : (selectedStream ? { url: selectedStream.url, authParams: getAuthParams(selectedStream), streams: fallback.allStreams, streamIndex: selectedIndex } : (fallback.browserStream || (fallback.allStreams?.length ? { url: fallback.allStreams[0].url, authParams: getAuthParams(fallback.allStreams[0]), streams: fallback.allStreams, streamIndex: 0 } : undefined)));

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
  title,
  subjectId,
  dubs = [],
  onQualityChange,
  onClose,
}: {
  url: string,
  authParams: string,
  streams: any[],
  streamIndex: number,
  startTime?: number,
  title?: string,
  subjectId?: string,
  dubs?: any[],
  onQualityChange: (index: number) => void,
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [currentDubSubjectId, setCurrentDubSubjectId] = useState<string>(subjectId || '');
  const [isSwitchingDub, setIsSwitchingDub] = useState(false);

  const [hlsLevels, setHlsLevels] = useState<any[]>([]);
  const [currentHlsLevel, setCurrentHlsLevel] = useState<number>(-1); // -1 = Auto
  const [hlsAudioTracks, setHlsAudioTracks] = useState<any[]>([]);
  const [currentHlsAudio, setCurrentHlsAudio] = useState<number>(0);
  const [hlsSubtitleTracks, setHlsSubtitleTracks] = useState<any[]>([]);
  const [currentHlsSubtitle, setCurrentHlsSubtitle] = useState<number>(-1);

  const [dashAudioTracks, setDashAudioTracks] = useState<any[]>([]);
  const [dashTextTracks, setDashTextTracks] = useState<any[]>([]);
  const [currentDashAudio, setCurrentDashAudio] = useState<number>(0);
  const [currentDashText, setCurrentDashText] = useState<number>(-1);

  const [activeMenu, setActiveMenu] = useState<'settings' | 'cc' | null>(null);
  const [seekRipple, setSeekRipple] = useState<{ type: 'rewind' | 'forward'; id: number } | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(console.error);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(console.error);
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(console.error);
    }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('loadedmetadata', onDurationChange);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onDurationChange);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, []);

  function formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const sStr = s < 10 ? `0${s}` : `${s}`;
    if (h > 0) {
      const mStr = m < 10 ? `0${m}` : `${m}`;
      return `${h}:${mStr}:${sStr}`;
    }
    return `${m}:${sStr}`;
  }

  const isDash = url.includes('.mpd');
  const playbackUrl = toVlcProxyUrl(url, authParams);

  const switchDubLanguage = async (dubSubjectId: string) => {
    if (!dubSubjectId || String(dubSubjectId) === String(currentDubSubjectId) || isSwitchingDub) return;
    
    setIsSwitchingDub(true);
    const currentPos = videoRef.current?.currentTime || 0;
    try {
      const res = await getPlayInfo(dubSubjectId, '0', '0');
      const newStreams = Array.isArray(res) ? res : (res?.streams || []);
      if (newStreams.length > 0) {
        const sorted = [...newStreams].sort((a: any, b: any) => getStreamScore(b) - getStreamScore(a));
        const best = sorted[0];
        const newAuth = getAuthParams(best);
        const newPlaybackUrl = toVlcProxyUrl(best.url, newAuth);

        setCurrentDubSubjectId(dubSubjectId);
        
        if (hlsRef.current && (best.url.includes('.m3u8') || best.url.includes('.m3u'))) {
          hlsRef.current.loadSource(newPlaybackUrl);
          if (videoRef.current) hlsRef.current.attachMedia(videoRef.current);
        } else if (videoRef.current) {
          videoRef.current.src = newPlaybackUrl;
        }
        
        if (videoRef.current) {
          videoRef.current.currentTime = currentPos;
          videoRef.current.play().catch(console.error);
        }
      }
    } catch (err) {
      console.error('Failed to switch dub language:', err);
    } finally {
      setIsSwitchingDub(false);
      setActiveMenu(null);
    }
  };

  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const restoreStartTime = () => {
      if (startTime && Number.isFinite(startTime)) {
        video.currentTime = startTime;
      }
    };

    video.addEventListener('loadedmetadata', restoreStartTime, { once: true });
    
    let hlsPlayer: Hls | null = null;
    
    if (!isDash) {
      if ((url.includes('.m3u8') || url.includes('.m3u')) && Hls.isSupported()) {
        hlsPlayer = new Hls({
          xhrSetup: (xhr, u) => {
            xhr.open('GET', toVlcProxyUrl(u, authParams), true);
          },
          debug: false,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          enableWorker: true,
          lowLatencyMode: true
        });
        hlsRef.current = hlsPlayer;

        hlsPlayer.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          if (data.levels && data.levels.length > 0) {
            setHlsLevels(data.levels);
          }
        });

        hlsPlayer.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
          if (data.audioTracks && data.audioTracks.length > 0) {
            setHlsAudioTracks(data.audioTracks);
          }
        });

        hlsPlayer.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, data) => {
          if (data.subtitleTracks && data.subtitleTracks.length > 0) {
            setHlsSubtitleTracks(data.subtitleTracks);
          }
        });

        hlsPlayer.on(Hls.Events.LEVEL_SWITCHED, () => {
          setCurrentHlsLevel(hlsPlayer?.currentLevel ?? -1);
        });

        hlsPlayer.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
          setCurrentHlsAudio(data.id);
        });

        hlsPlayer.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_, data) => {
          setCurrentHlsSubtitle(data.id);
        });

        hlsPlayer.on(Hls.Events.ERROR, (_, data) => {
          console.error('HLS Error:', data.type, data.details, data.fatal ? 'FATAL' : '');
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hlsPlayer?.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hlsPlayer?.recoverMediaError();
                break;
              default:
                hlsPlayer?.destroy();
                break;
            }
          }
        });
        hlsPlayer.loadSource(playbackUrl);
        hlsPlayer.attachMedia(video);
      } else {
        video.src = playbackUrl;
      }
      
      return () => {
        video.removeEventListener('loadedmetadata', restoreStartTime);
        if (hlsPlayer) {
          hlsPlayer.destroy();
          hlsRef.current = null;
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
      setDashAudioTracks(player.getTracksFor('audio') || []);
      setDashTextTracks(player.getTracksFor('text') || []);
    });

    player.initialize(videoRef.current, playbackUrl, true);
    
    return () => {
      video.removeEventListener('loadedmetadata', restoreStartTime);
      player.destroy();
      playerRef.current = null;
    };
  }, [url, authParams, isDash, playbackUrl, startTime]);

  const seekBy = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min((videoRef.current.duration || 0), videoRef.current.currentTime + seconds));
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    resetHideTimer();
    if (e.detail === 2) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;

      if (clickX < width * 0.4) {
        seekBy(-10);
        setSeekRipple({ type: 'rewind', id: Date.now() });
        setTimeout(() => setSeekRipple(null), 600);
      } else if (clickX > width * 0.6) {
        seekBy(10);
        setSeekRipple({ type: 'forward', id: Date.now() });
        setTimeout(() => setSeekRipple(null), 600);
      } else {
        togglePlay();
      }
    }
  };

  // Switch HLS audio track directly
  const selectHlsAudioTrack = (idx: number) => {
    setCurrentHlsAudio(idx);
    if (hlsRef.current) {
      hlsRef.current.audioTrack = idx;
    }
  };

  // Switch DASH audio track
  const selectDashAudioTrack = (idx: number) => {
    setCurrentDashAudio(idx);
    if (playerRef.current && dashAudioTracks[idx]) {
      playerRef.current.setCurrentTrack(dashAudioTracks[idx]);
    }
  };

  // Switch HLS subtitle track
  const selectHlsSubtitleTrack = (idx: number) => {
    setCurrentHlsSubtitle(idx);
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = idx;
    }
  };

  // Switch DASH subtitle track
  const selectDashTextTrack = (idx: number) => {
    setCurrentDashText(idx);
    if (playerRef.current) {
      if (idx === -1) {
        playerRef.current.updateSettings({ streaming: { text: { defaultEnabled: false } } });
        playerRef.current.enableText(false);
      } else if (dashTextTracks[idx]) {
        playerRef.current.enableText(true);
        playerRef.current.setCurrentTrack(dashTextTracks[idx]);
      }
    }
  };

  // Select discrete HLS quality level or stream resolution
  const selectHlsLevel = (levelIndex: number) => {
    setCurrentHlsLevel(levelIndex);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
    }
    setActiveMenu(null);
  };

  const selectQualityStream = (idx: number) => {
    onQualityChange(idx);
    setActiveMenu(null);
  };

  // Extract individual resolutions (e.g., 1080p, 720p, 480p, 360p)
  const individualResolutions = Array.from(new Set(
    streams.flatMap((s) => String(s.resolutions || '').split(',').map((r) => r.trim()).filter(Boolean))
  )).sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0));

  const [showOverlay, setShowOverlay] = useState(true);
  const hideTimerRef = useRef<any>(null);

  const resetHideTimer = () => {
    setShowOverlay(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!activeMenu) {
        setShowOverlay(false);
      }
    }, 3500);
  };

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [activeMenu]);

  const streamLanguageOptions = streams.map((stream, idx) => ({
    label: getStreamLanguage(stream, idx),
    index: idx,
  }));

  const currentResolutionLabel = currentHlsLevel !== -1 && hlsLevels[currentHlsLevel]
    ? `${hlsLevels[currentHlsLevel].height}p`
    : 'Auto';

  return (
    <div 
      className="player-shell fixed inset-0 z-[99990] bg-black flex flex-col justify-center items-center overflow-hidden select-none cursor-pointer" 
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onTouchStart={resetHideTimer}
      onClick={handleStageClick}
    >
      {/* 📺 Pure Fullscreen Video Element (No Browser Native Controls!) */}
      <video 
        ref={videoRef} 
        className="w-full h-full max-h-screen object-contain"
        playsInline
      />

      {/* ⚡ Double Tap Ripple Feedback Animations */}
      {seekRipple && (
        <div className={`absolute z-[99998] pointer-events-none flex items-center justify-center inset-y-0 ${seekRipple.type === 'rewind' ? 'left-0 w-1/2 bg-gradient-to-r from-cyan-500/20 to-transparent' : 'right-0 w-1/2 bg-gradient-to-l from-cyan-500/20 to-transparent'}`}>
          <div className="flex flex-col items-center justify-center p-5 sm:p-7 rounded-full bg-black/70 border border-cyan-400/50 backdrop-blur-md shadow-[0_0_30px_rgba(0,229,255,0.6)] animate-pulse">
            <span className="text-2xl sm:text-3xl text-cyan-400 font-black tracking-wider">
              {seekRipple.type === 'rewind' ? '↶ 10s' : '10s ↷'}
            </span>
          </div>
        </div>
      )}

      {/* 🎬 Overlay Container (Smooth Fade-In / Fade-Out) */}
      <div className={`absolute inset-0 z-[99995] flex flex-col justify-between p-4 sm:p-8 transition-opacity duration-300 pointer-events-none ${showOverlay || activeMenu ? 'opacity-100' : 'opacity-0'}`}>
        
        {/* ───────────── TOP BAR ───────────── */}
        <div className="flex items-center justify-between pointer-events-auto bg-gradient-to-b from-black/80 via-black/40 to-transparent p-2 rounded-xl">
          {/* Left: ← Back */}
          <button 
            onClick={onClose} 
            className="flex items-center gap-2 text-white/90 hover:text-white font-bold text-sm sm:text-base px-3 py-1.5 rounded-lg transition-all cursor-pointer hover:bg-white/10"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            <span>Back</span>
          </button>

          {/* Right: Movie Title */}
          <div className="text-right">
            <h3 className="text-sm sm:text-lg font-bold text-white drop-shadow-md truncate max-w-[200px] sm:max-w-xs">{title || 'Popcorn Movie'}</h3>
          </div>
        </div>

        {/* ───────────── CENTER CONTROLS (↶ 10 | ▶ | 10 ↷) ───────────── */}
        <div className="flex items-center justify-center gap-8 sm:gap-14 pointer-events-auto my-auto">
          {/* Rewind 10s */}
          <button 
            onClick={() => seekBy(-10)} 
            className="flex flex-col items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-black/40 hover:bg-black/70 text-white border border-white/10 backdrop-blur-md transition-all active:scale-95 cursor-pointer"
            aria-label="Rewind 10 seconds"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            <span className="text-[10px] sm:text-xs font-bold text-white -mt-1">10</span>
          </button>

          {/* Play / Pause Toggle */}
          <button 
            onClick={togglePlay} 
            className="flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-cyan-500/90 hover:bg-cyan-400 text-black shadow-[0_0_24px_rgba(0,229,255,0.5)] backdrop-blur-md transition-all active:scale-95 cursor-pointer"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            ) : (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>

          {/* Forward 10s */}
          <button 
            onClick={() => seekBy(10)} 
            className="flex flex-col items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-black/40 hover:bg-black/70 text-white border border-white/10 backdrop-blur-md transition-all active:scale-95 cursor-pointer"
            aria-label="Forward 10 seconds"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
            <span className="text-[10px] sm:text-xs font-bold text-white -mt-1">10</span>
          </button>
        </div>

        {/* ───────────── BOTTOM CONTROLS & TIMELINE BAR ───────────── */}
        <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 sm:p-4 rounded-xl flex flex-col gap-2">
          
          {/* Progress Scrubber Line */}
          <div className="relative w-full flex items-center group">
            <input 
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSeekChange}
              className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#00e5ff] focus:outline-none"
              style={{
                background: `linear-gradient(to right, #00e5ff 0%, #00e5ff ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) 100%)`
              }}
            />
          </div>

          {/* Controls Bar Row: [ ▶  🔊  12:43 ] ... [ 2:32:18  CC  ⚙  ⛶ ] */}
          <div className="flex items-center justify-between text-white text-xs sm:text-sm font-semibold pt-1">
            {/* Left Controls */}
            <div className="flex items-center gap-4">
              <button onClick={togglePlay} className="hover:text-cyan-400 transition-colors cursor-pointer" aria-label="Play/Pause">
                {isPlaying ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>

              <button onClick={toggleMute} className="hover:text-cyan-400 transition-colors cursor-pointer" aria-label="Mute/Unmute">
                {isMuted ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                )}
              </button>

              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="text-white font-bold">{formatTime(currentTime)}</span>
                <span className="text-gray-500 font-bold">/</span>
                <span className="text-gray-400">{formatTime(duration)}</span>
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-3.5">
              {/* CC Subtitles Button */}
              <button 
                onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'settings' ? null : 'settings'); }}
                className={`font-black text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer ${currentHlsSubtitle !== -1 || currentDashText !== -1 ? 'bg-cyan-500 text-black border-cyan-400' : 'border-white/30 text-white hover:border-white'}`}
              >
                CC
              </button>

              {/* ⚙ Settings Gear Button (Quality & Dubs Popover Trigger) */}
              <button 
                onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'settings' ? null : 'settings'); }}
                className={`p-1 hover:text-cyan-400 transition-colors cursor-pointer ${activeMenu === 'settings' ? 'text-cyan-400' : 'text-white'}`}
                aria-label="Settings"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>

              {/* ⛶ Fullscreen Button */}
              <button onClick={toggleFullscreen} className={`transition-colors cursor-pointer ${isFullscreen ? 'text-cyan-400' : 'hover:text-cyan-400'}`} aria-label="Fullscreen">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ⚙️ Popover Settings Drawer (Quality, Audio Dubs & Subtitles) */}
      {activeMenu && (
        <div 
          className="fixed bottom-20 right-4 sm:right-8 z-[999999] w-72 sm:w-80 max-h-[60vh] overflow-y-auto bg-[#0a0c10]/95 border border-cyan-500/40 rounded-2xl shadow-2xl backdrop-blur-2xl p-4 text-white pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quality Section */}
          <div className="flex flex-col gap-2 mb-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <span className="text-xs font-black text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <span>⚙️</span> Quality Options ({currentResolutionLabel})
              </span>
              <button onClick={() => setActiveMenu(null)} className="text-gray-400 hover:text-white text-xs font-bold">Close ✕</button>
            </div>

            <button 
              onClick={() => selectHlsLevel(-1)} 
              className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-between ${currentHlsLevel === -1 ? 'bg-cyan-500 text-black shadow-[0_0_12px_rgba(0,229,255,0.4)]' : 'bg-white/5 hover:bg-white/10 text-gray-200'}`}
            >
              <span>⚡ Auto (Adaptive HD)</span>
              {currentHlsLevel === -1 && <span className="text-[10px] font-black uppercase bg-black/30 px-2 py-0.5 rounded">Active</span>}
            </button>

            {hlsLevels.length > 0 ? (
              hlsLevels.map((level, idx) => (
                <button 
                  key={idx} 
                  onClick={() => selectHlsLevel(idx)} 
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-between ${idx === currentHlsLevel ? 'bg-cyan-500 text-black shadow-[0_0_12px_rgba(0,229,255,0.4)]' : 'bg-white/5 hover:bg-white/10 text-gray-200'}`}
                >
                  <span>{level.height}p {level.height >= 720 ? 'HD' : 'SD'}</span>
                  {level.bitrate && <span className="text-[10px] opacity-75 font-semibold">{(level.bitrate / 1000000).toFixed(1)} Mbps</span>}
                </button>
              ))
            ) : individualResolutions.length > 0 ? (
              individualResolutions.map((res, idx) => (
                <button 
                  key={res} 
                  onClick={() => selectQualityStream(Math.min(idx, streams.length - 1))} 
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all ${idx === 0 ? 'bg-cyan-500 text-black' : 'bg-white/5 hover:bg-white/10 text-gray-200'}`}
                >
                  {res}p HD
                </button>
              ))
            ) : (
              streams.map((stream, idx) => (
                <button 
                  key={stream.id || idx} 
                  onClick={() => selectQualityStream(idx)} 
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all ${idx === streamIndex ? 'bg-cyan-500 text-black' : 'bg-white/5 hover:bg-white/10 text-gray-200'}`}
                >
                  {stream.resolutions ? `${stream.resolutions}p` : `Server Stream ${idx + 1}`}
                </button>
              ))
            )}
          </div>

          {/* Audio & Subtitles Section */}
          <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
            <div className="text-xs font-black text-cyan-400 uppercase tracking-wider mb-1">Audio & Dubbing</div>
            <div className="flex flex-col gap-1.5">
              {dubs && dubs.length > 0 ? (
                dubs.map((dub: any) => (
                  <button 
                    key={dub.subjectId} 
                    onClick={() => switchDubLanguage(dub.subjectId)} 
                    disabled={isSwitchingDub}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-between ${
                      String(dub.subjectId) === String(currentDubSubjectId)
                        ? 'bg-cyan-500 text-black shadow-[0_0_12px_rgba(0,229,255,0.4)]'
                        : 'bg-white/5 hover:bg-white/10 text-gray-200'
                    }`}
                  >
                    <span>🔊 {dub.lanName || dub.lanCode || 'Audio Track'} {dub.original ? '(Original)' : ''}</span>
                    {String(dub.subjectId) === String(currentDubSubjectId) && (
                      <span className="text-[10px] font-black uppercase bg-black/30 px-2 py-0.5 rounded">Active</span>
                    )}
                  </button>
                ))
              ) : hlsAudioTracks.length > 0 ? (
                hlsAudioTracks.map((track, idx) => (
                  <button 
                    key={idx} 
                    onClick={() => selectHlsAudioTrack(idx)} 
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all ${idx === currentHlsAudio ? 'bg-cyan-500 text-black' : 'bg-white/5 hover:bg-white/10 text-gray-200'}`}
                  >
                    🔊 {track.name || track.lang || `Audio Track ${idx + 1}`}
                  </button>
                ))
              ) : isDash && dashAudioTracks.length > 0 ? (
                dashAudioTracks.map((track, idx) => (
                  <button 
                    key={idx} 
                    onClick={() => selectDashAudioTrack(idx)} 
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all ${idx === currentDashAudio ? 'bg-cyan-500 text-black' : 'bg-white/5 hover:bg-white/10 text-gray-200'}`}
                  >
                    🔊 {track.lang || `Audio Track ${idx + 1}`}
                  </button>
                ))
              ) : (
                streamLanguageOptions.map((option) => (
                  <button 
                    key={option.index} 
                    onClick={() => selectQualityStream(option.index)} 
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all ${option.index === streamIndex ? 'bg-cyan-500 text-black' : 'bg-white/5 hover:bg-white/10 text-gray-200'}`}
                  >
                    🔊 {option.label}
                  </button>
                ))
              )}
            </div>

            <div className="text-xs font-black text-cyan-400 uppercase tracking-wider mt-3">Subtitles</div>
            <div className="flex flex-col gap-1.5">
              <button 
                onClick={() => isDash ? selectDashTextTrack(-1) : selectHlsSubtitleTrack(-1)} 
                className={`w-full text-left px-3.5 py-2 rounded-xl font-bold text-xs transition-all ${(isDash ? currentDashText : currentHlsSubtitle) === -1 ? 'bg-cyan-500 text-black' : 'bg-white/5 hover:bg-white/10 text-gray-200'}`}
              >
                💬 Off
              </button>
              {hlsSubtitleTracks.length > 0 && hlsSubtitleTracks.map((track, idx) => (
                <button 
                  key={idx} 
                  onClick={() => selectHlsSubtitleTrack(idx)} 
                  className={`w-full text-left px-3.5 py-2 rounded-xl font-bold text-xs transition-all ${idx === currentHlsSubtitle ? 'bg-cyan-500 text-black' : 'bg-white/5 hover:bg-white/10 text-gray-200'}`}
                >
                  💬 {track.name || track.lang || `Subtitle ${idx + 1}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type TabType = 'home' | 'movies' | 'tvshows' | 'anime';

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
  
  // Helper for 0s instantaneous local storage cache
  const getCachedJson = (key: string, fallback: any) => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch {
      return fallback;
    }
  };

  const homeCache = getCachedJson('popcorn_cache_home_v3', {});

  const [movies, setMovies] = useState<any[]>(() => getCachedJson('popcorn_cache_catalog_v3', []))
  const moviesRef = useRef<any[]>([])
  useEffect(() => {
    moviesRef.current = movies;
  }, [movies]);

  const [loading, setLoading] = useState(() => !getCachedJson('popcorn_cache_catalog_v3', null))
  const roastMessage = useRotatingMessage(ROAST_LOADING_MESSAGES);
  const roastMoreMessage = useRotatingMessage(ROAST_LOADING_MORE, 3000);
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isFetchingPlay, setIsFetchingPlay] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('home')

  // UI & Settings Modals State
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const [isWatchHistoryOpen, setIsWatchHistoryOpen] = useState(false)
  const [isDownloadsModalOpen, setIsDownloadsModalOpen] = useState(false)
  const [isPreferencesModalOpen, setIsPreferencesModalOpen] = useState(false)

  // Preferences State
  const [userPreferences, setUserPreferences] = useState(() => getCachedJson('popcorn_user_preferences', {
    quality: '1080p',
    audioLang: 'Hindi',
    autoPlayNext: true,
  }))

  // Watch History State
  const [watchHistory, setWatchHistory] = useState<any[]>(() => getCachedJson('popcorn_watch_history', []))
  
  const addToWatchHistory = (item: any) => {
    if (!item) return;
    const entry = {
      id: item.id || item.subjectId,
      title: item.title,
      cover: item.cover?.url || item.coverUrl || item.cover || '',
      watchedAt: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const updated = [entry, ...watchHistory.filter(x => x.id !== entry.id)].slice(0, 30);
    setWatchHistory(updated);
    localStorage.setItem('popcorn_watch_history', JSON.stringify(updated));
  };

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

  // Mobile App Curated Rows & Hero Carousel State (0s instant load)
  const [heroMovies, setHeroMovies] = useState<any[]>(homeCache.hero || [])
  const [hindiMovies, setHindiMovies] = useState<any[]>(homeCache.hindi || [])
  const [bollywoodMovies, setBollywoodMovies] = useState<any[]>(homeCache.bolly || [])
  const [hollywoodMovies, setHollywoodMovies] = useState<any[]>(homeCache.holly || [])
  const [actionMovies, setActionMovies] = useState<any[]>(homeCache.act || [])
  const [thrillerMovies, setThrillerMovies] = useState<any[]>(homeCache.thrill || [])
  const [horrorMovies, setHorrorMovies] = useState<any[]>(homeCache.hor || [])
  const [heroIndex, setHeroIndex] = useState(0)

  useEffect(() => {
    if (!isAccountMenuOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.account-dropdown') && !target.closest('.profile-chip') && !target.closest('.mobile-nav-item')) {
        setIsAccountMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isAccountMenuOpen]);

  useEffect(() => {
    if (activeTab === 'home') {
      const fetchAndSet = async (promise: Promise<any>, setter: (items: any[]) => void) => {
        try {
          const res = await promise;
          const items = (res || []).filter((item: any) => {
            const hasCover = item.cover && (item.cover.url || typeof item.cover === 'string');
            return hasCover && (item.subjectType === 1 || item.subjectType === 2 || !item.subjectType);
          });
          if (items.length > 0) setter(items);
          return items;
        } catch (e) {
          return [];
        }
      };

      Promise.all([
        fetchAndSet(getCategoryList("0", 1, 10, { classify: 'Hindi dub' }), setHeroMovies),
        fetchAndSet(getCategoryList("0", 1, 20, { classify: 'Hindi dub' }), setHindiMovies),
        fetchAndSet(getCategoryList("0", 1, 20, { country: 'India' }), setBollywoodMovies),
        fetchAndSet(getCategoryList("0", 1, 20, { country: 'United States' }), setHollywoodMovies),
        fetchAndSet(getCategoryList("0", 1, 20, { genre: 'Action' }), setActionMovies),
        fetchAndSet(getCategoryList("0", 1, 20, { genre: 'Thriller' }), setThrillerMovies),
        fetchAndSet(getCategoryList("0", 1, 20, { genre: 'Horror' }), setHorrorMovies)
      ]).then(([hero, hindi, bolly, holly, act, thrill, hor]) => {
        try {
          localStorage.setItem('popcorn_cache_home_v3', JSON.stringify({
            hero: hero.length > 0 ? hero : homeCache.hero,
            hindi: hindi.length > 0 ? hindi : homeCache.hindi,
            bolly: bolly.length > 0 ? bolly : homeCache.bolly,
            holly: holly.length > 0 ? holly : homeCache.holly,
            act: act.length > 0 ? act : homeCache.act,
            thrill: thrill.length > 0 ? thrill : homeCache.thrill,
            hor: hor.length > 0 ? hor : homeCache.hor,
          }));
        } catch (e) {
          console.warn('LocalStorage cache write error:', e);
        }
      });
    }
  }, [activeTab]);

  useEffect(() => {
    if (heroMovies.length > 0) {
      const timer = setInterval(() => {
        setHeroIndex(prev => (prev + 1) % heroMovies.length);
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [heroMovies.length]);

  const openCategoryMore = (filterParams: Partial<FilterState>) => {
    setSearchQuery('');
    window.location.hash = '';
    setSelectedMovieId(null);
    setCurrentFilters({ genre: 'All', country: 'All', year: 'All', classify: 'All', sort: 'Latest', ...filterParams });
    setPage(1);
    setHasMore(true);
    setActiveTab('movies');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollRow = (rowId: string, direction: 'left' | 'right') => {
    const el = document.getElementById(rowId);
    if (el) {
      const scrollAmount = direction === 'left' ? -380 : 380;
      el.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleTabClick = (tab: TabType) => {
    setActiveTab(tab);
    setSearchQuery('');
    window.location.hash = '';
    setSelectedMovieId(null);
    setCurrentFilters({ genre: 'All', country: 'All', year: 'All', classify: 'All', sort: 'Latest' });
    setPage(1);
    setHasMore(true);
  };

  useEffect(() => {
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
    if (searchQuery.trim() !== '') {
      fetchPromise = searchMovies(searchQuery.trim(), page, 20)
    } else {
      let tabId = "0";
      if (activeTab === 'movies') {
        tabId = currentFilters.classify === 'Hindi dub' ? "0" : "1";
      } else if (activeTab === 'tvshows') {
        tabId = "2";
      } else if (activeTab === 'anime') {
        tabId = "1006";
      }

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
        
        const items = payload || [];
        const validItems = items.filter((item: any) => {
          const hasCover = item.cover && (item.cover.url || typeof item.cover === 'string');
          return hasCover && (item.subjectType === 1 || item.subjectType === 2 || !item.subjectType);
        });
        
        setMovies(prev => {
          if (page === 1) {
            setHasMore(validItems.length > 0);
            try {
              localStorage.setItem('popcorn_cache_catalog_v3', JSON.stringify(validItems));
            } catch (e) {
              console.warn('LocalStorage catalog cache write error:', e);
            }
            return validItems;
          }
          
          const existingIds = new Set(prev.map(m => m.id || m.subjectId));
          const newItems = validItems.filter((item: any) => !existingIds.has(item.id || item.subjectId));
          
          if (validItems.length > 0 && newItems.length === 0) {
            setHasMore(false);
          } else {
            setHasMore(items.length > 0);
          }
          return [...prev, ...newItems];
        });
        
        setLoading(false);
        setLoadingMore(false);
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

  const loadMovieDetails = useCallback(async (subjectId: string) => {
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
      
      if (details.subjectType === 2 || details.seasons?.length > 0) {
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
        setMovieDownloadLinks(getDownloadLinks(resources.list || [], details.title));
      }
    } catch (err) {
      console.error(err);
    }
    setDetailsLoading(false);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#movie/')) {
        const id = hash.replace('#movie/', '').trim();
        if (id) {
          loadMovieDetails(id);
          return;
        }
      }
      setSelectedMovieId(null);
      setMovieDetails(null);
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [loadMovieDetails]);

  const handleMovieClick = (movie: any) => {
    addToWatchHistory(movie);
    const subjectId = movie.id || movie.subjectId;
    window.location.hash = `#movie/${subjectId}`;
  };

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

    if (movieDetails?.isLiveSports) {
      setVlcFallback({
        title: movieDetails?.title || 'Live Stream',
        format: '',
        resolution: '',
        directUrl: SERVER_3_URL,
        vlcUrl: SERVER_3_URL,
        allStreams: [],
        browserStream: { url: '', authParams: '', streams: [], streamIndex: 0, iframeUrl: SERVER_3_URL },
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
      const sortedStreams = await fetchMergedStreams(selectedMovieId, se, ep);
      if (!sortedStreams || sortedStreams.length === 0) {
        alert('No streams found for this movie/episode.');
        return;
      }

      const bestStream = sortedStreams[0];
      const authParams = getAuthParams(bestStream);
      const browserStream = {
        url: bestStream.url,
        authParams: getAuthParams(bestStream),
        streams: sortedStreams,
        streamIndex: 0,
      };

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

  const fetchMergedStreams = async (subjectId: string, se: string, ep: string) => {
    let playStreams: any[] = [];
    try {
      const res = await getPlayInfo(subjectId, se, ep);
      playStreams = Array.isArray(res) ? res : (res?.streams || []);
    } catch (e) {
      console.warn('getPlayInfo failed:', e);
    }

    let resourceStreams: any[] = [];
    try {
      const resources = await getResourceLinks(subjectId, se, 1, '0', ep, ep);
      const resList = resources.list || [];
      resourceStreams = resList.map((item: any) => ({
        format: 'MP4',
        id: item.resourceId || String(Date.now()),
        url: item.resourceLink,
        resolutions: `${item.resolution || 720}p`,
        size: item.size || '0',
        duration: item.duration || 0,
        codecName: item.codecName || 'h264',
        signCookie: '',
        idType: '',
        title: item.title || `H.264 Direct MP4 (${item.resolution || 720}p)`
      }));
    } catch (e) {
      console.warn('getResourceLinks fallback failed:', e);
    }

    const combined = [...resourceStreams, ...playStreams];
    const seen = new Set();
    const unique = combined.filter((s: any) => {
      if (!s.url || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    return unique.sort((a: any, b: any) => getStreamScore(b) - getStreamScore(a));
  };

  const handlePlay = async (se: string = '0', ep: string = '0') => {
    if (!selectedMovieId || isFetchingPlay || playingVideo) return;

    if (movieDetails?.isLiveSports) {
      setPlayingVideo({ url: '', authParams: '', streams: [], streamIndex: 0, iframeUrl: SERVER_3_URL });
      return;
    }

    setIsFetchingPlay(true);
    try {
      const sortedStreams = await fetchMergedStreams(selectedMovieId, se, ep);

      console.log('All merged streams (sorted):', sortedStreams);
      if (sortedStreams && sortedStreams.length > 0) {
        const bestStream = sortedStreams[0];
        const authParams = getAuthParams(bestStream);
        
        setVlcFallback(null);
        setPlayingVideo({
          url: bestStream.url,
          authParams,
          streams: sortedStreams,
          streamIndex: 0,
          subjectId: selectedMovieId,
          dubs: movieDetails?.dubs || [],
          title: bestStream.title || movieDetails?.title
        });
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
            title={playingVideo.title || movieDetails?.title}
            subjectId={playingVideo.subjectId || selectedMovieId || undefined}
            dubs={playingVideo.dubs || movieDetails?.dubs || []}
            onQualityChange={handleQualityChange}
            onClose={() => setPlayingVideo(null)}
          />
        )
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
      
      {/* Main Content */}
      <main className="content-area">
        <header className="content-header flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-shrink-0">
            <h1 className="flex items-center gap-2.5 cursor-pointer flex-shrink-0" onClick={() => { handleTabClick('home'); window.location.hash = ''; }}>
              <img src="/icon.png" alt="Popcorn Movies" className="w-8 h-8 sm:w-10 sm:h-10 object-contain drop-shadow-[0_0_14px_rgba(0,229,255,0.6)]" />
              <div className="flex flex-col leading-none">
                <span className="text-xl sm:text-2xl font-black text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.95)] tracking-tight">Popcorn</span>
                <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-[#f5b84b] italic self-end drop-shadow-[0_0_8px_rgba(245,184,75,0.9)] -mt-0.5">MOVIES</span>
              </div>
            </h1>
          </div>
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
        </header>

        {selectedMovieId ? (
          <div className="movie-details-container">
            {/* Ambient Blurred Backdrop */}
            {movieDetails?.cover && (
              <div 
                className="details-hero-backdrop" 
                style={{ backgroundImage: `url(${movieDetails.cover?.url || movieDetails.cover})` }}
              />
            )}

            {/* Glass Back Button */}
            <button
              onClick={() => { window.location.hash = ''; setSelectedMovieId(null); }}
              className="details-glass-back"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Back to Movies
            </button>

            {detailsLoading ? (
              <div className="py-20 text-center text-gray-400">
                <div className="loading-spinner mb-4 inline-block"></div>
                <p className="text-lg font-medium text-white">Loading movie details...</p>
              </div>
            ) : movieDetails && (
              <div className="details-content-wrapper">
                {/* Hero Info Card Header */}
                <div className="details-hero-header">
                  <div className="details-poster-box">
                    <img 
                      src={movieDetails.cover?.url || movieDetails.cover} 
                      alt={movieDetails.title} 
                      className="details-poster-img" 
                    />
                  </div>

                  <div className="details-header-meta">
                    <h2 className="details-main-title">{movieDetails.title}</h2>
                    
                    <div className="details-pills-row">
                      {movieDetails.year || movieDetails.releaseDate?.substring(0, 4) ? (
                        <span className="details-pill-year">{movieDetails.year || movieDetails.releaseDate?.substring(0, 4)}</span>
                      ) : null}
                      {movieDetails.imdbRatingValue && (
                        <span className="details-pill-rating">⭐ IMDb {movieDetails.imdbRatingValue}</span>
                      )}
                      {movieDetails.genre && (
                        <span className="details-pill-genre">{movieDetails.genre}</span>
                      )}
                    </div>

                    {/* Action Buttons Bar */}
                    <div className="details-action-bar">
                      {(!seasonInfo || !seasonInfo.seasons || seasonInfo.seasons.length === 0) ? (
                        <>
                          <button 
                            onClick={() => handlePlay('0', '0')}
                            className="neon-play-btn"
                            disabled={isFetchingPlay}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            Play Movie
                          </button>
                          <button
                            onClick={() => openPlaybackOptions('0', '0')}
                            className="glass-info-btn"
                            disabled={isFetchingPlay}
                          >
                            ⚙️ Quality / Sources
                          </button>
                        </>
                      ) : (
                        <button 
                          onClick={() => { 
                            setActiveDetailTab('episodes');
                            const firstEp = (episodeList && episodeList.length > 0) ? String(episodeList[0].ep) : '1';
                            handlePlay(String(selectedSeason || 1), firstEp);
                            const epSection = document.getElementById('episodes-section');
                            if (epSection) epSection.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className="neon-play-btn"
                          disabled={isFetchingPlay}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                          Watch Episodes
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Tab Navigation */}
                <div className="details-nav-tabs">
                  <button 
                    onClick={() => setActiveDetailTab('episodes')} 
                    className={`details-tab-btn ${activeDetailTab === 'episodes' ? 'active' : ''}`}
                  >
                    📺 Watch & Episodes
                  </button>
                  <button 
                    onClick={() => setActiveDetailTab('details')} 
                    className={`details-tab-btn ${activeDetailTab === 'details' ? 'active' : ''}`}
                  >
                    📖 Story & Details
                  </button>
                  <button 
                    onClick={() => setActiveDetailTab('more')} 
                    className={`details-tab-btn ${activeDetailTab === 'more' ? 'active' : ''}`}
                  >
                    🎬 More Like This
                  </button>
                </div>

                {/* Tab 1: Episodes / Play Sources */}
                {activeDetailTab === 'episodes' && (
                  (!seasonInfo || !seasonInfo.seasons || seasonInfo.seasons.length === 0) ? (
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-md">
                      <h3 className="text-sm font-extrabold text-white mb-2">Direct Playback & Downloads</h3>
                      <p className="text-xs text-gray-400 mb-5">Select a stream link below or tap Play Movie for instant playback.</p>

                      {movieDownloadLinks.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {movieDownloadLinks.map((link, idx) => (
                            <a
                              key={idx}
                              href={link.url}
                              download={link.filename}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 p-3 rounded-xl flex items-center justify-between text-white font-bold text-xs transition-all"
                            >
                              <span className="flex items-center gap-2">
                                <span>⚡</span> {link.label}
                              </span>
                              <span className="text-cyan-400">Download ⬇️</span>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() => openPlaybackOptions('0', '0')}
                          className="px-5 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs border border-white/10 transition-colors"
                        >
                          🔍 Find All Stream Sources & Quality Options
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-6" id="episodes-section">
                      {/* Seasons Bar */}
                      <div>
                        <h3 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-2">Seasons</h3>
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                          {seasonInfo.seasons.map((s: any) => (
                            <button
                              key={s.se}
                              onClick={() => handleSeasonChange(s.se)}
                              className={`px-4 py-2 rounded-xl text-xs font-extrabold border transition-all ${selectedSeason === s.se ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_14px_rgba(0,229,255,0.4)]' : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'}`}
                            >
                              Season {s.se}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Episode List */}
                      <div>
                        <h3 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-2">Episodes</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {episodeList.length === 0 ? (
                            <div className="py-8 text-center text-gray-400 text-sm">Loading episode list...</div>
                          ) : (
                            episodeList.map((ep: any) => (
                              <div key={ep.episode} className="bg-white/5 hover:bg-white/10 border border-white/8 p-3 rounded-xl flex items-center justify-between gap-3 transition-all">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 font-black flex items-center justify-center text-xs flex-shrink-0">
                                    {ep.ep}
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="font-bold text-white text-xs truncate">{ep.title || `Episode ${ep.ep}`}</h4>
                                    {ep.size && <p className="text-[11px] text-gray-400">{(parseInt(ep.size) / (1024*1024)).toFixed(1)} MB</p>}
                                  </div>
                                </div>
                                <button 
                                  onClick={() => handlePlay(String(selectedSeason), String(ep.ep))}
                                  className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black font-extrabold text-xs rounded-lg flex items-center gap-1 shadow-md transition-colors cursor-pointer"
                                  disabled={isFetchingPlay}
                                >
                                  ▶ Play
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )
                )}

                {/* Tab 2: Details & Story */}
                {activeDetailTab === 'details' && (
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-md space-y-5">
                    <div>
                      <h3 className="text-xs font-extrabold text-cyan-400 uppercase tracking-wider mb-2">Synopsis & Storyline</h3>
                      <p className="text-sm text-gray-200 leading-relaxed">{movieDetails.description || 'No description available for this title.'}</p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4 border-t border-white/10">
                      <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                        <span className="text-[11px] text-gray-400 font-bold block mb-0.5">Title</span>
                        <p className="text-xs font-bold text-white truncate">{movieDetails.title}</p>
                      </div>
                      <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                        <span className="text-[11px] text-gray-400 font-bold block mb-0.5">Release Year</span>
                        <p className="text-xs font-bold text-white">{movieDetails.year || movieDetails.releaseDate?.substring(0,4) || 'Unknown'}</p>
                      </div>
                      <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                        <span className="text-[11px] text-gray-400 font-bold block mb-0.5">IMDb Rating</span>
                        <p className="text-xs font-bold text-amber-400">⭐ {movieDetails.imdbRatingValue || movieDetails.rate || 'N/A'}</p>
                      </div>
                      {movieDetails.genre && (
                        <div className="bg-black/40 p-3 rounded-xl border border-white/5 col-span-2">
                          <span className="text-[11px] text-gray-400 font-bold block mb-0.5">Genres</span>
                          <p className="text-xs font-bold text-cyan-300">{movieDetails.genre}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tab 3: More Like This */}
                {activeDetailTab === 'more' && (
                  <div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                      {moreLikeThis.length > 0 ? moreLikeThis.map((m: any, idx: number) => (
                        <div 
                          key={m.id || m.subjectId || idx} 
                          className="row-poster-card" 
                          onClick={() => handleMovieClick(m)}
                        >
                          <img src={m.cover?.url || m.coverUrl || m.cover} alt={m.title} className="row-poster-img" />
                          <span className="row-poster-title">{m.title}</span>
                        </div>
                      )) : (
                        <div className="col-span-full py-8 text-center text-gray-400 text-sm">No similar items found.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="movie-list-view pb-24">
            {/* 📱 MOBILE HERO SLIDER CAROUSEL */}
            {activeTab === 'home' && !searchQuery && heroMovies.length > 0 && (
              <div className="mobile-hero-slider">
                <img 
                  src={heroMovies[heroIndex]?.cover?.url || heroMovies[heroIndex]?.coverUrl || heroMovies[heroIndex]?.cover} 
                  alt={heroMovies[heroIndex]?.title} 
                  className="mobile-hero-bg" 
                />
                <div className="mobile-hero-overlay"></div>
                <div className="mobile-hero-body">
                  <h2 className="mobile-hero-title">{heroMovies[heroIndex]?.title}</h2>
                  <div className="glass-action-panel">
                    <button 
                      onClick={() => handleMovieClick(heroMovies[heroIndex])} 
                      className="neon-play-btn"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"/></svg> ▶ Play
                    </button>
                    <button 
                      onClick={() => handleMovieClick(heroMovies[heroIndex])} 
                      className="glass-info-btn"
                    >
                      ℹ Info
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 📱 CURATED MOVIE ROWS */}
            {activeTab === 'home' && !searchQuery && (
              <div className="mobile-curated-rows">
                {hindiMovies.length > 0 && (
                  <div className="movie-row-section">
                    <div className="movie-row-header flex justify-between items-center">
                      <h3 className="movie-row-title">Top Hindi Dubbed</h3>
                      <div className="flex items-center gap-2">
                        <button onClick={() => scrollRow('row-hindi', 'left')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll left">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
                        </button>
                        <button onClick={() => scrollRow('row-hindi', 'right')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll right">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        <button 
                          onClick={() => openCategoryMore({ classify: 'Hindi dub' })}
                          className="text-cyan-400 hover:text-cyan-300 font-bold text-xs sm:text-sm flex items-center gap-1 cursor-pointer transition-colors ml-1"
                        >
                          More <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                      </div>
                    </div>
                    <div className="movie-row-scroll" id="row-hindi">
                      {hindiMovies.map((m, idx) => (
                        <div key={m.id || m.subjectId || idx} className="row-poster-card" onClick={() => handleMovieClick(m)}>
                          <img src={m.cover?.url || m.coverUrl || m.cover} alt={m.title} className="row-poster-img" />
                          <span className="row-poster-title">{m.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {bollywoodMovies.length > 0 && (
                  <div className="movie-row-section">
                    <div className="movie-row-header flex justify-between items-center">
                      <h3 className="movie-row-title">Bollywood Blockbusters</h3>
                      <div className="flex items-center gap-2">
                        <button onClick={() => scrollRow('row-bolly', 'left')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll left">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
                        </button>
                        <button onClick={() => scrollRow('row-bolly', 'right')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll right">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        <button 
                          onClick={() => openCategoryMore({ country: 'India' })}
                          className="text-cyan-400 hover:text-cyan-300 font-bold text-xs sm:text-sm flex items-center gap-1 cursor-pointer transition-colors ml-1"
                        >
                          More <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                      </div>
                    </div>
                    <div className="movie-row-scroll" id="row-bolly">
                      {bollywoodMovies.map((m, idx) => (
                        <div key={m.id || m.subjectId || idx} className="row-poster-card" onClick={() => handleMovieClick(m)}>
                          <img src={m.cover?.url || m.coverUrl || m.cover} alt={m.title} className="row-poster-img" />
                          <span className="row-poster-title">{m.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {hollywoodMovies.length > 0 && (
                  <div className="movie-row-section">
                    <div className="movie-row-header flex justify-between items-center">
                      <h3 className="movie-row-title">Hollywood Hits</h3>
                      <div className="flex items-center gap-2">
                        <button onClick={() => scrollRow('row-holly', 'left')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll left">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
                        </button>
                        <button onClick={() => scrollRow('row-holly', 'right')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll right">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        <button 
                          onClick={() => openCategoryMore({ country: 'United States' })}
                          className="text-cyan-400 hover:text-cyan-300 font-bold text-xs sm:text-sm flex items-center gap-1 cursor-pointer transition-colors ml-1"
                        >
                          More <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                      </div>
                    </div>
                    <div className="movie-row-scroll" id="row-holly">
                      {hollywoodMovies.map((m, idx) => (
                        <div key={m.id || m.subjectId || idx} className="row-poster-card" onClick={() => handleMovieClick(m)}>
                          <img src={m.cover?.url || m.coverUrl || m.cover} alt={m.title} className="row-poster-img" />
                          <span className="row-poster-title">{m.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {actionMovies.length > 0 && (
                  <div className="movie-row-section">
                    <div className="movie-row-header flex justify-between items-center">
                      <h3 className="movie-row-title">Action & Adventure</h3>
                      <div className="flex items-center gap-2">
                        <button onClick={() => scrollRow('row-action', 'left')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll left">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
                        </button>
                        <button onClick={() => scrollRow('row-action', 'right')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll right">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        <button 
                          onClick={() => openCategoryMore({ genre: 'Action' })}
                          className="text-cyan-400 hover:text-cyan-300 font-bold text-xs sm:text-sm flex items-center gap-1 cursor-pointer transition-colors ml-1"
                        >
                          More <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                      </div>
                    </div>
                    <div className="movie-row-scroll" id="row-action">
                      {actionMovies.map((m, idx) => (
                        <div key={m.id || m.subjectId || idx} className="row-poster-card" onClick={() => handleMovieClick(m)}>
                          <img src={m.cover?.url || m.coverUrl || m.cover} alt={m.title} className="row-poster-img" />
                          <span className="row-poster-title">{m.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {thrillerMovies.length > 0 && (
                  <div className="movie-row-section">
                    <div className="movie-row-header flex justify-between items-center">
                      <h3 className="movie-row-title">Thriller & Suspense</h3>
                      <div className="flex items-center gap-2">
                        <button onClick={() => scrollRow('row-thriller', 'left')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll left">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
                        </button>
                        <button onClick={() => scrollRow('row-thriller', 'right')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll right">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        <button 
                          onClick={() => openCategoryMore({ genre: 'Thriller' })}
                          className="text-cyan-400 hover:text-cyan-300 font-bold text-xs sm:text-sm flex items-center gap-1 cursor-pointer transition-colors ml-1"
                        >
                          More <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                      </div>
                    </div>
                    <div className="movie-row-scroll" id="row-thriller">
                      {thrillerMovies.map((m, idx) => (
                        <div key={m.id || m.subjectId || idx} className="row-poster-card" onClick={() => handleMovieClick(m)}>
                          <img src={m.cover?.url || m.coverUrl || m.cover} alt={m.title} className="row-poster-img" />
                          <span className="row-poster-title">{m.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {horrorMovies.length > 0 && (
                  <div className="movie-row-section">
                    <div className="movie-row-header flex justify-between items-center">
                      <h3 className="movie-row-title">Horror Movies</h3>
                      <div className="flex items-center gap-2">
                        <button onClick={() => scrollRow('row-horror', 'left')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll left">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
                        </button>
                        <button onClick={() => scrollRow('row-horror', 'right')} className="p-1.5 rounded-full bg-white/5 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-white/10 transition-all cursor-pointer" aria-label="Scroll right">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        <button 
                          onClick={() => openCategoryMore({ genre: 'Horror' })}
                          className="text-cyan-400 hover:text-cyan-300 font-bold text-xs sm:text-sm flex items-center gap-1 cursor-pointer transition-colors ml-1"
                        >
                          More <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                      </div>
                    </div>
                    <div className="movie-row-scroll" id="row-horror">
                      {horrorMovies.map((m, idx) => (
                        <div key={m.id || m.subjectId || idx} className="row-poster-card" onClick={() => handleMovieClick(m)}>
                          <img src={m.cover?.url || m.coverUrl || m.cover} alt={m.title} className="row-poster-img" />
                          <span className="row-poster-title">{m.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <section className="page-heading">
              <p className="section-kicker">Now playing around you</p>
              <h2>
                {searchQuery 
                  ? `Search Results: ${searchQuery}` 
                  : activeTab === 'home' ? 'All Recent Releases'
                  : activeTab === 'movies' ? 'Movies'
                  : activeTab === 'tvshows' ? 'TV Shows'
                  : activeTab === 'anime' ? 'Anime'
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
        
        {loadingMore && !selectedMovieId && (
          <div className="py-8 text-center text-gray-400">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" role="status">
              <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">Loading...</span>
            </div>
            <p className="mt-2 text-sm" style={{ fontStyle: 'italic' }}>{roastMoreMessage}</p>
          </div>
        )}
        
        {/* Invisible target for IntersectionObserver infinite scrolling */}
        {!selectedMovieId && <div ref={loaderRef} style={{ height: '20px', width: '100%' }} />}
          </div>
        )}
      </main>
      
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
        <div className="premium-backdrop" style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(20px)', background: 'rgba(0,0,0,0.85)' }}>
          <div className="premium-shell" style={{ width: '100%', maxWidth: '500px', padding: '0', background: 'linear-gradient(180deg, #1a1625 0%, #0f1016 100%)', border: '1px solid rgba(255,82,0,0.5)', borderRadius: '16px', textAlign: 'center' }}>
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
        <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(5px)', background: 'rgba(0,0,0,0.6)' }}>
          <div style={{ width: '100%', maxWidth: '400px', position: 'relative', padding: '32px', textAlign: 'center', background: '#1a1625', border: '1px solid rgba(255,183,77,0.3)', borderRadius: '16px' }}>
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

      {/* Backdrop to close settings dropdown on any screen touch/click */}
      {isAccountMenuOpen && (
        <div 
          className="fixed inset-0 z-[990] bg-transparent cursor-default" 
          onClick={() => setIsAccountMenuOpen(false)}
        />
      )}
      
      {/* Account Settings Dropdown Overlay */}
      {isAccountMenuOpen && account && (
        <div className="account-dropdown z-[1000]">
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
            <li onClick={() => { setIsAccountMenuOpen(false); setIsWatchHistoryOpen(true); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Watch History ({watchHistory.length})
            </li>
            <li onClick={() => { setIsAccountMenuOpen(false); setIsDownloadsModalOpen(true); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Downloads & Offline
            </li>
            <li onClick={() => { setIsAccountMenuOpen(false); setIsPreferencesModalOpen(true); }}>
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

      {/* 🕒 Watch History Modal */}
      {isWatchHistoryOpen && (
        <div className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#12141a] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
              <h3 className="text-xl font-extrabold text-white flex items-center gap-2">
                <span>🕒</span> Watch History
              </h3>
              <button onClick={() => setIsWatchHistoryOpen(false)} className="text-gray-400 hover:text-white p-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {watchHistory.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-3xl mb-2">🎬</p>
                  <p className="font-semibold text-white">No watch history yet</p>
                  <p className="text-xs text-gray-400 mt-1">Movies you click or play will appear here for 1-tap resumption.</p>
                </div>
              ) : (
                watchHistory.map((item, idx) => (
                  <div key={item.id || idx} className="flex items-center justify-between bg-white/5 hover:bg-white/10 p-3 rounded-xl border border-white/5 transition-all">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => { setIsWatchHistoryOpen(false); loadMovieDetails(item.id); }}>
                      {item.cover ? (
                        <img src={item.cover} alt={item.title} className="w-12 h-16 object-cover rounded-lg flex-shrink-0" />
                      ) : (
                        <div className="w-12 h-16 bg-gray-800 rounded-lg flex items-center justify-center text-xs">🍿</div>
                      )}
                      <div>
                        <h4 className="text-sm font-bold text-white line-clamp-1">{item.title}</h4>
                        <span className="text-[11px] text-cyan-400">{item.watchedAt}</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => { setIsWatchHistoryOpen(false); loadMovieDetails(item.id); }}
                      className="px-3 py-1.5 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 rounded-lg text-xs font-bold transition-colors"
                    >
                      Resume ▶
                    </button>
                  </div>
                ))
              )}
            </div>

            {watchHistory.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/10 flex justify-end">
                <button 
                  onClick={() => { setWatchHistory([]); localStorage.removeItem('popcorn_watch_history'); }}
                  className="text-xs font-bold text-red-400 hover:text-red-300"
                >
                  Clear Watch History
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 📥 Downloads & Offline Media Modal */}
      {isDownloadsModalOpen && (
        <div className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#12141a] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
              <h3 className="text-xl font-extrabold text-white flex items-center gap-2">
                <span>📥</span> Downloads & Offline Media
              </h3>
              <button onClick={() => setIsDownloadsModalOpen(false)} className="text-gray-400 hover:text-white p-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-cyan-950/40 border border-cyan-500/30 p-3 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider">Offline Cache Engine</h4>
                  <p className="text-xs text-gray-300">Fast 0-second instant loading enabled</p>
                </div>
                <span className="px-2 py-1 bg-cyan-400/20 text-cyan-400 font-extrabold text-xs rounded">Active</span>
              </div>

              <div className="text-center py-8 text-gray-400">
                <p className="text-3xl mb-2">⚡</p>
                <p className="font-semibold text-white">Direct Downloads Enabled</p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                  Click on any movie details page to access direct 1080p, 720p, & 480p download links!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ⚙️ Preferences Modal */}
      {isPreferencesModalOpen && (
        <div className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#12141a] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-5 pb-3 border-b border-white/10">
              <h3 className="text-xl font-extrabold text-white flex items-center gap-2">
                <span>⚙️</span> App Preferences
              </h3>
              <button onClick={() => setIsPreferencesModalOpen(false)} className="text-gray-400 hover:text-white p-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="space-y-5">
              {/* Preferred Quality */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Default Video Quality</label>
                <div className="grid grid-cols-3 gap-2">
                  {['1080p HD', '720p SD', 'Auto'].map(q => (
                    <button
                      key={q}
                      onClick={() => {
                        const updated = { ...userPreferences, quality: q };
                        setUserPreferences(updated);
                        localStorage.setItem('popcorn_user_preferences', JSON.stringify(updated));
                      }}
                      className={`py-2 text-xs font-bold rounded-xl border transition-all ${userPreferences.quality === q ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_12px_rgba(0,229,255,0.4)]' : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preferred Audio */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Default Dub Audio</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Hindi', 'English', 'Original'].map(lang => (
                    <button
                      key={lang}
                      onClick={() => {
                        const updated = { ...userPreferences, audioLang: lang };
                        setUserPreferences(updated);
                        localStorage.setItem('popcorn_user_preferences', JSON.stringify(updated));
                      }}
                      className={`py-2 text-xs font-bold rounded-xl border transition-all ${userPreferences.audioLang === lang ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_12px_rgba(0,229,255,0.4)]' : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'}`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto Play Next */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <div>
                  <h4 className="text-sm font-bold text-white">Auto-Play Next Episode</h4>
                  <p className="text-xs text-gray-400">Play next episode automatically when finished</p>
                </div>
                <button
                  onClick={() => {
                    const updated = { ...userPreferences, autoPlayNext: !userPreferences.autoPlayNext };
                    setUserPreferences(updated);
                    localStorage.setItem('popcorn_user_preferences', JSON.stringify(updated));
                  }}
                  className={`w-12 h-6 rounded-full transition-colors relative p-1 ${userPreferences.autoPlayNext ? 'bg-cyan-500' : 'bg-gray-700'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${userPreferences.autoPlayNext ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📱 MOBILE BOTTOM NAVIGATION BAR */}
      {!playingVideo && (
        <nav className="mobile-bottom-nav">
          <button 
            onClick={() => handleTabClick('home')} 
            className={`mobile-nav-item ${activeTab === 'home' && !searchQuery && !selectedMovieId ? 'active' : ''}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span>Home</span>
          </button>
          <button 
            onClick={() => handleTabClick('movies')} 
            className={`mobile-nav-item ${activeTab === 'movies' && !searchQuery && !selectedMovieId ? 'active' : ''}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h18M3 12h18M3 16.5h18"/></svg>
            <span>Movies</span>
          </button>
          <button 
            onClick={() => handleTabClick('tvshows')} 
            className={`mobile-nav-item ${activeTab === 'tvshows' && !searchQuery && !selectedMovieId ? 'active' : ''}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>
            <span>TV Shows</span>
          </button>
          <button 
            onClick={() => handleTabClick('anime')} 
            className={`mobile-nav-item ${activeTab === 'anime' && !searchQuery && !selectedMovieId ? 'active' : ''}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span>Anime</span>
          </button>
          <button 
            onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)} 
            className="mobile-nav-item"
          >
            <div className="w-5 h-5 rounded-full bg-cover bg-center border border-cyan-400" style={account ? { backgroundImage: `url(${account.avatar})` } : {}}></div>
            <span>Account</span>
          </button>
        </nav>
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
