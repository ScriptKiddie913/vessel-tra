import { useState, useEffect, useCallback } from 'react'
import { Newspaper, RefreshCw, X, Minimize2, Maximize2, Globe, Shield, Anchor, Rocket, AlertTriangle, ExternalLink } from 'lucide-react'

interface NewsArticle {
  title: string; url: string; source: string; date: string; image: string; tone: number | null; country: string
}

interface GeoEvent {
  title: string; url: string; lat: number; lng: number; tone: number | null
}

const SUPABASE_BASE = 'https://czbfzqegmwmglahhilio.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6YmZ6cWVnbXdtZ2xhaGhpbGlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzI0NjcsImV4cCI6MjA4ODU0ODQ2N30.eqq0C19uy6MUlTrnmhWp81zyptAV9kpLKdGtcrFZsx4'
const NEWS_URL = `${SUPABASE_BASE}/functions/v1/news-feed`

const CATEGORIES = [
  { id: 'global', label: 'GLOBAL', icon: Globe },
  { id: 'military', label: 'MILITARY', icon: Shield },
  { id: 'threats', label: 'THREATS', icon: AlertTriangle },
  { id: 'maritime', label: 'MARITIME', icon: Anchor },
  { id: 'space', label: 'SPACE', icon: Rocket },
]

function toneColor(tone: number | null): string {
  if (tone === null) return '#6b7280'
  if (tone < -5) return '#ef4444'
  if (tone < -1) return '#f97316'
  if (tone < 1) return '#6b7280'
  if (tone < 5) return '#22c55e'
  return '#10b981'
}

function toneLabel(tone: number | null): string {
  if (tone === null) return ''
  if (tone < -5) return 'HOSTILE'
  if (tone < -1) return 'NEGATIVE'
  if (tone < 1) return 'NEUTRAL'
  if (tone < 5) return 'POSITIVE'
  return 'FAVORABLE'
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const y = dateStr.slice(0, 4), m = dateStr.slice(4, 6), d = dateStr.slice(6, 8)
    const h = dateStr.slice(9, 11), min = dateStr.slice(11, 13), s = dateStr.slice(13, 15)
    const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`)
    const diff = Date.now() - date.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  } catch { return '' }
}

export default function NewsFeed() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [geoEvents, setGeoEvents] = useState<GeoEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState('global')
  const [error, setError] = useState<string | null>(null)

  const fetchNews = useCallback(async (mode: string) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(NEWS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ mode }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setArticles(data.articles || [])
      setGeoEvents(data.geoEvents || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen || isMinimized) return
    const timer = setTimeout(() => fetchNews(category), 800)
    return () => clearTimeout(timer)
  }, [isOpen, isMinimized, category, fetchNews])

  useEffect(() => {
    if (!isOpen || isMinimized) return
    const iv = setInterval(() => fetchNews(category), 10 * 60 * 1000)
    return () => clearInterval(iv)
  }, [isOpen, isMinimized, category, fetchNews])

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)}
        className="absolute bottom-24 right-3 z-[1001] flex items-center gap-2 px-4 py-2 rounded-full font-mono text-xs tracking-wider transition-all backdrop-blur-sm shadow-lg"
        style={{ background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.8), rgba(15, 23, 42, 0.8))', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#93c5fd' }}
      >
        <Newspaper size={14} />
        <span>NEWS INTEL</span>
        {articles.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-[8px] rounded-full" style={{ background: 'rgba(59,130,246,0.3)' }}>{articles.length}</span>}
      </button>
    )
  }

  return (
    <div className="absolute z-[1002] font-mono" style={{ bottom: isMinimized ? 'auto' : 80, left: 16, width: isMinimized ? 180 : 360, height: isMinimized ? 36 : 500, transition: 'all 0.2s ease' }}>
      <div className="w-full h-full flex flex-col bg-gray-950/95 backdrop-blur-md rounded-lg overflow-hidden shadow-2xl" style={{ border: '1px solid rgba(59, 130, 246, 0.2)' }}>
        <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ background: 'linear-gradient(90deg, rgba(30, 58, 138, 0.3), rgba(15, 23, 42, 0.3))', borderBottom: '1px solid rgba(59, 130, 246, 0.15)' }}>
          <Newspaper size={14} style={{ color: '#93c5fd' }} />
          <span style={{ color: '#93c5fd' }} className="text-[10px] font-bold tracking-[0.2em] flex-1">NEWS INTEL</span>
          <button onClick={() => fetchNews(category)} disabled={loading} className="text-gray-500 hover:text-blue-300 disabled:opacity-30"><RefreshCw size={11} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={() => setIsMinimized(!isMinimized)} className="text-gray-500 hover:text-blue-300">{isMinimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}</button>
          <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-red-400"><X size={12} /></button>
        </div>

        {!isMinimized && (
          <>
            <div className="shrink-0 flex overflow-x-auto scrollbar-hide px-2 py-1.5 gap-1" style={{ borderBottom: '1px solid rgba(59, 130, 246, 0.1)' }}>
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon
                return (
                  <button key={cat.id} onClick={() => setCategory(cat.id)}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[9px] tracking-wider transition-all border"
                    style={{ background: category === cat.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent', borderColor: category === cat.id ? 'rgba(59, 130, 246, 0.3)' : 'rgba(55, 65, 81, 0.2)', color: category === cat.id ? '#93c5fd' : '#6b7280' }}
                  ><Icon size={10} />{cat.label}</button>
                )
              })}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {error && <div className="p-3 text-[10px] text-red-400 text-center">⚠️ {error}</div>}
              {loading && articles.length === 0 && <div className="p-4 text-center text-[10px] text-gray-500"><RefreshCw size={12} className="animate-spin inline mr-2" style={{ color: '#93c5fd' }} />SCANNING...</div>}
              {articles.length === 0 && !loading && !error && <div className="p-4 text-center text-[10px] text-gray-600">No articles. Try another category.</div>}
              {articles.map((article, i) => (
                <a key={i} href={article.url} target="_blank" rel="noopener noreferrer" className="block px-3 py-2.5 transition-all hover:bg-gray-800/30" style={{ borderBottom: '1px solid rgba(55, 65, 81, 0.2)' }}>
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-gray-200 leading-relaxed line-clamp-2 font-medium">{article.title}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[8px] text-gray-500 truncate max-w-[120px]">{article.source}</span>
                        {article.tone !== null && <span className="text-[7px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: `${toneColor(article.tone)}20`, color: toneColor(article.tone) }}>{toneLabel(article.tone)}</span>}
                        <span className="text-[8px] text-gray-600">{timeAgo(article.date)}</span>
                        <ExternalLink size={8} className="text-gray-700 ml-auto shrink-0" />
                      </div>
                    </div>
                    {article.image && <div className="shrink-0 w-14 h-14 rounded overflow-hidden" style={{ border: '1px solid rgba(55, 65, 81, 0.3)' }}><img src={article.image} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /></div>}
                  </div>
                </a>
              ))}
            </div>

            <div className="shrink-0 px-3 py-1.5 flex items-center gap-3 text-[8px] text-gray-600" style={{ borderTop: '1px solid rgba(59, 130, 246, 0.1)' }}>
              <span>{articles.length} articles</span><span className="text-gray-800">|</span><span>{geoEvents.length} geolocated</span><span className="ml-auto text-gray-700">GDELT v2</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
