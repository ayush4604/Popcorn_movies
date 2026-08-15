import React, { useState, useEffect } from 'react';
import { getLiveTvChannels } from '../api';

interface Channel {
  id: string;
  name: string;
  logo: string;
  country: string;
  categories: string[];
  url: string;
  backupUrls?: string[];
  quality: string;
  userAgent?: string;
}

interface LiveTvModuleProps {
  onPlayChannel: (channel: { title: string; url: string; backupUrls?: string[]; logo?: string }) => void;
}

const CATEGORIES = [
  { id: 'top', label: '🔥 Top Channels' },
  { id: 'news', label: '📰 News' },
  { id: 'sports', label: '⚽ Sports' },
  { id: 'movies', label: '🎬 Movies' },
  { id: 'entertainment', label: '🎭 Entertainment' },
  { id: 'music', label: '🎵 Music' },
  { id: 'kids', label: '👶 Kids' },
  { id: 'documentary', label: '🌍 Documentaries' },
];

const COUNTRIES = [
  { code: 'ALL', label: '🌏 All Countries' },
  { code: 'IN', label: '🇮🇳 India' },
  { code: 'US', label: '🇺🇸 United States' },
  { code: 'GB', label: '🇬🇧 United Kingdom' },
  { code: 'CA', label: '🇨🇦 Canada' },
  { code: 'AU', label: '🇦🇺 Australia' },
];

export const LiveTvModule: React.FC<LiveTvModuleProps> = ({ onPlayChannel }) => {
  const [category, setCategory] = useState('top');
  const [country, setCountry] = useState('ALL');
  const [search, setSearch] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    getLiveTvChannels(category, country, search, page, 40)
      .then((data) => {
        if (!isMounted) return;
        setChannels(data.items || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load Live TV channels:', err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [category, country, search, page]);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* 📺 Live TV Standalone Module Banner */}
      <div className="relative rounded-3xl overflow-hidden bg-gradient-to-r from-cyan-950/80 via-blue-950/50 to-purple-950/80 border border-cyan-500/30 p-6 sm:p-10 shadow-2xl backdrop-blur-xl">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 text-xs font-black uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span>IPTV Live Streams</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Live TV Broadcasts
            </h1>
            <p className="text-xs sm:text-sm text-gray-300 max-w-xl leading-relaxed">
              Stream news, sports, movies, and music channels 24/7 directly in HD quality with zero commercials.
            </p>
          </div>

          {/* Quick Stats Pill */}
          <div className="flex items-center gap-4 bg-white/5 border border-white/10 px-5 py-3 rounded-2xl backdrop-blur-md">
            <div className="text-center">
              <span className="block text-lg font-black text-cyan-400">{total}</span>
              <span className="text-[10px] text-gray-400 font-bold uppercase">Channels</span>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="text-center">
              <span className="block text-lg font-black text-emerald-400">100%</span>
              <span className="text-[10px] text-gray-400 font-bold uppercase">Free HD</span>
            </div>
          </div>
        </div>
      </div>

      {/* 🎛️ Filter & Search Controls Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-white/5 p-4 rounded-2xl border border-white/10 backdrop-blur-md">
        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setCategory(cat.id);
                setPage(1);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all whitespace-nowrap cursor-pointer border ${
                category === cat.id
                  ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_14px_rgba(0,229,255,0.4)]'
                  : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Right Controls: Country Select & Search Input */}
        <div className="flex items-center gap-3">
          {/* Country Selector */}
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setPage(1);
            }}
            className="bg-black/60 text-white text-xs font-bold px-3 py-2.5 rounded-xl border border-white/15 focus:outline-none focus:border-cyan-400 cursor-pointer"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code} className="bg-gray-900 text-white">
                {c.label}
              </option>
            ))}
          </select>

          {/* Search Input */}
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              placeholder="Search live channels..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-black/60 text-white text-xs font-medium px-4 py-2.5 pl-9 rounded-xl border border-white/15 focus:outline-none focus:border-cyan-400 placeholder:text-gray-500"
            />
            <svg
              className="absolute left-3 top-3 text-gray-400"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>
      </div>

      {/* 📺 Channel Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-44 rounded-2xl bg-white/5 animate-pulse border border-white/10" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="py-16 text-center bg-white/5 border border-white/10 rounded-3xl backdrop-blur-md">
          <div className="text-4xl mb-3">📡</div>
          <h3 className="text-lg font-bold text-white mb-1">No channels found</h3>
          <p className="text-xs text-gray-400">Try choosing a different category or country filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {channels.map((chan) => (
            <div
              key={chan.id}
              onClick={() => onPlayChannel({ title: chan.name, url: chan.url, backupUrls: chan.backupUrls, logo: chan.logo })}
              className="group relative bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-500/50 p-4 rounded-2xl flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_25px_rgba(0,229,255,0.15)] cursor-pointer overflow-hidden"
            >
              {/* Live Red Indicator Badge */}
              <div className="flex items-center justify-between mb-3">
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-red-500/20 border border-red-500/40 text-red-400 font-extrabold text-[10px] uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                  LIVE
                </span>
                {chan.quality && (
                  <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-500/30">
                    {chan.quality}
                  </span>
                )}
              </div>

              {/* Logo / Badge */}
              <div className="h-20 w-full flex items-center justify-center p-2 rounded-xl bg-black/40 border border-white/5 my-2 group-hover:scale-105 transition-transform">
                {chan.logo ? (
                  <img
                    src={chan.logo}
                    alt={chan.name}
                    loading="lazy"
                    decoding="async"
                    className="max-h-full max-w-full object-contain filter drop-shadow-md"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span className="text-xl font-black text-cyan-400 drop-shadow">
                    📺 {chan.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>

              {/* Channel Title & Country */}
              <div className="mt-2 space-y-1">
                <h4 className="font-extrabold text-white text-xs truncate group-hover:text-cyan-300 transition-colors">
                  {chan.name}
                </h4>
                <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold">
                  <span className="uppercase">{chan.categories[0] || 'General'}</span>
                  <span>{chan.country}</span>
                </div>
              </div>

              {/* Play Button Overlay */}
              <div className="mt-3 w-full py-1.5 bg-cyan-500/10 group-hover:bg-cyan-500 group-hover:text-black border border-cyan-500/30 text-cyan-300 font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 transition-all">
                <span>▶ Watch Live</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
