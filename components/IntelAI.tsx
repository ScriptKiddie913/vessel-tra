'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import { JAMMING_ZONES, AIS_VESSELS, GROUND_STATIONS } from '@/lib/intel-data'
import { Bot, Send, X, Minimize2, Maximize2, Zap, Shield, Target, Newspaper, Mail, CheckCircle, AlertTriangle } from 'lucide-react'
import type { SatCategory } from '@/lib/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ActionProposal {
  action: string
  successRate: number
  details: string
  severity: string
  incident: string
  location?: string
}

const SUPABASE_BASE = 'https://czbfzqegmwmglahhilio.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6YmZ6cWVnbXdtZ2xhaGhpbGlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzI0NjcsImV4cCI6MjA4ODU0ODQ2N30.eqq0C19uy6MUlTrnmhWp81zyptAV9kpLKdGtcrFZsx4'
const CHAT_URL = `${SUPABASE_BASE}/functions/v1/intel-chat`
const NEWS_URL = `${SUPABASE_BASE}/functions/v1/news-feed`
const EMAIL_URL = `${SUPABASE_BASE}/functions/v1/send-intel-action`

function getMapStateSnapshot(store: ReturnType<typeof useSatelliteStore.getState>) {
  const sampleSats = store.satellites.slice(0, 50).map(s => ({ name: s.name, noradId: s.noradId }))
  const sampleVessels = [
    ...AIS_VESSELS.map(v => ({ name: v.name, type: v.type, flag: v.flag, lat: v.lat, lng: v.lng, speed: v.speed, course: v.course })),
    ...store.liveVessels.slice(0, 30).map(v => ({ name: v.name, type: v.type, flag: v.flag, lat: v.lat, lng: v.lng, speed: v.speed, course: v.course })),
  ]
  const militaryFlights = store.liveFlights.filter(f => f.isMilitary).slice(0, 20).map(f => ({
    callsign: f.callsign, icao24: f.icao24, lat: f.lat, lng: f.lng, alt: f.alt, heading: f.heading, origin: f.origin,
  }))
  const intelAlerts = store.intelEvents.filter(e => e.severity === 'critical' || e.severity === 'high').slice(0, 20).map(e => ({
    title: e.title, category: e.category, severity: e.severity, lat: e.lat, lng: e.lng, location: e.location_name, time: e.event_time,
  }))
  return {
    totalSatellites: store.satellites.length, category: store.category, lockedSatellite: store.lockedId,
    sampleSatellites: sampleSats, totalLiveVessels: store.liveVessels.length, totalLiveFlights: store.liveFlights.length,
    militaryFlights, sampleVessels, intelAlerts,
    quakes: store.quakes.slice(0, 15).map(q => ({ mag: q.mag, place: q.place, lat: q.lat, lng: q.lng, depth: q.depth, tsunami: q.tsunami })),
    events: store.events.slice(0, 15).map(e => ({ title: e.title, category: e.category, lat: e.lat, lng: e.lng })),
    fires: store.fires.length, airQuality: store.airQuality.filter(a => a.aqi > 100).slice(0, 10).map(a => ({ station: a.station, aqi: a.aqi })),
    shodanDevices: store.shodanDevices.length,
    jammingZones: JAMMING_ZONES.filter(z => z.active).map(z => ({ name: z.name, type: z.type, severity: z.severity, source: z.source, center: z.center, radiusKm: z.radiusKm })),
    groundStations: GROUND_STATIONS.map(gs => ({ name: gs.name, type: gs.type, flag: gs.flag, lat: gs.lat, lng: gs.lng })),
    layers: { satellites: store.showSatellites, vessels: store.showVessels, flights: store.showFlights, quakes: store.showQuakes, events: store.showEvents, stations: store.showStations, fires: store.showFires, shodan: store.showShodan, airQuality: store.showAirQuality },
    godsEyeMode: store.godsEyeMode, timelineOffset: store.timelineOffset,
    indiaContext: 'Focus threats on India. Key zones: LAC, LoC, IOR, String of Pearls. Adversaries: China PLA, Pakistan Navy.',
  }
}

function parseCommands(text: string): Array<Record<string, any>> {
  const commands: Array<Record<string, any>> = []
  const regex = /```command\s*\n([\s\S]*?)\n```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    try { commands.push(JSON.parse(match[1].trim())) } catch {}
  }
  return commands
}

function parseActions(text: string): ActionProposal[] {
  const actions: ActionProposal[] = []
  const regex = /```action\s*\n([\s\S]*?)\n```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    try { actions.push(JSON.parse(match[1].trim())) } catch {}
  }
  return actions
}

function executeCommand(cmd: Record<string, any>) {
  const store = useSatelliteStore.getState()
  switch (cmd.action) {
    case 'lock_satellite': if (cmd.noradId) store.setLockedId(cmd.noradId); break
    case 'unlock_satellite': store.setLockedId(null); break
    case 'set_category': if (cmd.category) store.setCategory(cmd.category as SatCategory); break
    case 'toggle_layer':
      if (cmd.layer === 'satellites') store.toggleSatellites()
      else if (cmd.layer === 'vessels') store.toggleVessels()
      else if (cmd.layer === 'flights') store.toggleFlights()
      else if (cmd.layer === 'quakes') store.toggleQuakes()
      else if (cmd.layer === 'events') store.toggleEvents()
      else if (cmd.layer === 'stations') store.toggleStations()
      else if (cmd.layer === 'fires') store.toggleFires()
      else if (cmd.layer === 'shodan') store.toggleShodan()
      break
    case 'set_gods_eye': store.setGodsEyeMode(cmd.mode || null); break
    case 'search_satellite': if (cmd.query) store.setSearch(cmd.query); break
  }
}

const QUICK_ACTIONS = [
  { label: '🇮🇳 India Threat Scan', msg: 'Run a full threat assessment focused on India. For EACH threat detected, generate an ```action block with proposed counter-measure and success probability (0-100%).' },
  { label: '🚢 IOR Maritime SITREP', msg: 'Give me a detailed Indian Ocean Region situation report with action proposals for each threat. Include ```action blocks.' },
  { label: '✈️ Military Air Intel', msg: 'Analyze all military aircraft currently tracked. Provide ```action blocks for IAF response recommendations with success rates.' },
  { label: '⚡ LAC/LoC Border Intel', msg: 'Analyze LAC and LoC activity. Provide ```action blocks with counter-measures and success probability.' },
  { label: '🔴 String of Pearls Watch', msg: 'Status update on Chinese naval presence at String of Pearls ports. Provide ```action blocks for Indian Navy responses.' },
  { label: '📰 News + Intel Fusion', msg: 'Analyze the latest news alerts. For each critical/high severity news event, generate an ```action block with proposed response and success rate.' },
  { label: '🔥 OSINT Full Picture', msg: 'Give comprehensive OSINT briefing with ```action blocks for each threat identified.' },
  { label: '📋 Defense COA', msg: 'Generate Course of Action with ```action blocks for each recommended action with success probability.' },
]

export default function IntelAI() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [newsCache, setNewsCache] = useState<any[]>([])
  const [pendingActions, setPendingActions] = useState<ActionProposal[]>([])
  const [sendingEmail, setSendingEmail] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, pendingActions])

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const resp = await fetch(NEWS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
          body: JSON.stringify({ mode: 'global' }),
        })
        if (resp.ok) {
          const data = await resp.json()
          setNewsCache((data.articles || []).slice(0, 20).map((a: any) => ({ title: a.title, source: a.source, tone: a.tone, country: a.country, date: a.date })))
        }
      } catch {}
    }
    const t = setTimeout(fetchNews, 15000)
    const iv = setInterval(fetchNews, 15 * 60 * 1000)
    return () => { clearTimeout(t); clearInterval(iv) }
  }, [])

  const sendEmailAction = async (action: ActionProposal) => {
    const key = `${action.action}_${action.incident}`.slice(0, 100)
    setSendingEmail(key)
    try {
      const res = await fetch(EMAIL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
        body: JSON.stringify(action),
      })
      if (res.ok) {
        setEmailSent(prev => new Set(prev).add(key))
      }
    } catch (e) {
      console.error('Email send error:', e)
    } finally {
      setSendingEmail(null)
    }
  }

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText || input).trim()
    if (!text || isLoading) return

    const userMsg: Message = { role: 'user', content: text }
    const allMessages = [...messages, userMsg]
    setMessages(allMessages)
    if (!overrideText) setInput('')
    setIsLoading(true)
    setPendingActions([])

    const mapState = getMapStateSnapshot(useSatelliteStore.getState())

    let assistantSoFar = ''
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant') {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m)
        }
        return [...prev, { role: 'assistant', content: assistantSoFar }]
      })
    }

    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ messages: allMessages.map(m => ({ role: m.role, content: m.content })), mapState, newsContext: newsCache }),
      })

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }))
        upsertAssistant(`⚠️ ${err.error || `Error ${resp.status}`}`)
        setIsLoading(false)
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let textBuffer = ''
      let streamDone = false

      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break
        textBuffer += decoder.decode(value, { stream: true })
        let newlineIndex: number
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex)
          textBuffer = textBuffer.slice(newlineIndex + 1)
          if (line.endsWith('\r')) line = line.slice(0, -1)
          if (line.startsWith(':') || line.trim() === '') continue
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (jsonStr === '[DONE]') { streamDone = true; break }
          try {
            const parsed = JSON.parse(jsonStr)
            const content = parsed.choices?.[0]?.delta?.content as string | undefined
            if (content) upsertAssistant(content)
          } catch {
            textBuffer = line + '\n' + textBuffer
            break
          }
        }
      }

      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw) continue
          if (raw.endsWith('\r')) raw = raw.slice(0, -1)
          if (raw.startsWith(':') || raw.trim() === '') continue
          if (!raw.startsWith('data: ')) continue
          const jsonStr = raw.slice(6).trim()
          if (jsonStr === '[DONE]') continue
          try {
            const parsed = JSON.parse(jsonStr)
            const content = parsed.choices?.[0]?.delta?.content as string | undefined
            if (content) upsertAssistant(content)
          } catch {}
        }
      }

      // Parse commands and actions
      const commands = parseCommands(assistantSoFar)
      commands.forEach(executeCommand)
      const actions = parseActions(assistantSoFar)
      if (actions.length > 0) setPendingActions(actions)
    } catch (e) {
      console.error('Intel AI error:', e)
      upsertAssistant('⚠️ COMMS FAILURE. Check network connectivity.')
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, messages, newsCache])

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)}
        className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[1001] flex items-center gap-2 px-5 py-2.5 rounded-full font-mono text-xs tracking-wider transition-all backdrop-blur-sm shadow-lg"
        style={{ background: 'linear-gradient(135deg, rgba(255, 103, 0, 0.8), rgba(127, 29, 29, 0.6))', border: '1px solid rgba(255, 153, 51, 0.4)', color: '#ffcc99' }}
      >
        <Shield size={14} />
        <span>SoTaNik AI</span>
        <span className="text-[8px] ml-1 px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,153,51,0.2)', color: '#ff9933' }}>INDIA DEFENSE</span>
        {newsCache.length > 0 && <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{newsCache.length} NEWS</span>}
        <Zap size={10} style={{ color: '#ff9933' }} />
      </button>
    )
  }

  return (
    <div className="absolute z-[1002] font-mono" style={{ bottom: isMinimized ? 'auto' : 28, right: 16, width: isMinimized ? 200 : 460, height: isMinimized ? 36 : 600, transition: 'all 0.2s ease' }}>
      <div className="w-full h-full flex flex-col bg-gray-950/95 backdrop-blur-md rounded-lg overflow-hidden shadow-2xl" style={{ border: '1px solid rgba(255, 153, 51, 0.25)' }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ background: 'linear-gradient(90deg, rgba(255, 103, 0, 0.2), rgba(127, 29, 29, 0.15))', borderBottom: '1px solid rgba(255, 153, 51, 0.2)' }}>
          <Shield size={14} style={{ color: '#ff9933' }} />
          <span style={{ color: '#ffcc99' }} className="text-[10px] font-bold tracking-[0.2em] flex-1">SoTaNik_AI</span>
          <span className="text-[7px] px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(255,153,51,0.15)', color: '#ff9933', border: '1px solid rgba(255,153,51,0.2)' }}>🇮🇳 INDIA</span>
          <div className="flex items-center gap-1 mx-1"><div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /><span className="text-[8px] text-green-500">LIVE</span></div>
          {newsCache.length > 0 && <span className="text-[7px] px-1 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>📰{newsCache.length}</span>}
          <button onClick={() => setIsMinimized(!isMinimized)} className="text-gray-500 hover:text-orange-300">{isMinimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}</button>
          <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-red-400"><X size={12} /></button>
        </div>

        {!isMinimized && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
              {messages.length === 0 && (
                <div className="text-gray-600 text-[10px] leading-relaxed p-2">
                  <div className="flex items-center gap-2 mb-3">
                    <Target size={14} style={{ color: '#ff9933' }} />
                    <p style={{ color: 'rgba(255, 153, 51, 0.9)' }} className="font-bold tracking-wider">SoTaNik_AI — INDIA DEFENSE GEOSPATIAL AI</p>
                  </div>
                  <p className="text-gray-400">Multi-source intelligence platform with integrated news scanning. Monitors threats to India across all domains.</p>
                  <div className="mt-3 p-2 rounded" style={{ background: 'rgba(255, 153, 51, 0.08)', border: '1px solid rgba(255, 153, 51, 0.15)' }}>
                    <p className="text-[9px] font-bold tracking-wider mb-1" style={{ color: '#ff9933' }}>INTEL DOMAINS</p>
                    <p className="text-gray-500 text-[9px]">GEOINT · MARITIME · SIGINT · OSINT · CYBER · ADS-B · FIRMS · NEWS</p>
                  </div>
                  <div className="mt-3 p-2 rounded" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                    <p className="text-[9px] font-bold tracking-wider mb-1 text-blue-400">📰 NEWS INTEL INTEGRATED</p>
                    <p className="text-gray-500 text-[9px]">AI auto-scans global news for military, conflict, disaster alerts. Events geolocated on map. 7-day auto-purge. Critical alerts stored in DB.</p>
                  </div>
                  <div className="mt-3 p-2 rounded" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)' }}>
                    <p className="text-[9px] font-bold tracking-wider mb-1 text-green-400">📧 ACTION EMAIL DISPATCH</p>
                    <p className="text-gray-500 text-[9px]">Select any proposed action to send via secure email with success probability analysis.</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-800/50">
                    <p className="text-[9px] text-gray-600 mb-2 tracking-wider">QUICK ACTIONS</p>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_ACTIONS.map((qa, i) => (
                        <button key={i} onClick={() => sendMessage(qa.msg)}
                          className="px-2 py-1 text-[9px] rounded border transition-all hover:text-orange-300 hover:border-orange-500/20"
                          style={{ borderColor: 'rgba(255, 153, 51, 0.15)', color: '#999' }}
                        >{qa.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] px-3 py-2 rounded-lg text-[11px] leading-relaxed border`}
                    style={{
                      background: msg.role === 'user' ? 'rgba(255, 103, 0, 0.15)' : 'rgba(31, 41, 55, 0.5)',
                      borderColor: msg.role === 'user' ? 'rgba(255, 153, 51, 0.25)' : 'rgba(55, 65, 81, 0.3)',
                      color: msg.role === 'user' ? '#ffcc99' : '#d1d5db',
                    }}
                  >
                    <div className="whitespace-pre-wrap break-words"
                      dangerouslySetInnerHTML={{
                        __html: msg.content
                          .replace(/```command[\s\S]*?```/g, '<span style="color:#ff9933;font-size:9px">⚡ COMMAND EXECUTED</span>')
                          .replace(/```action[\s\S]*?```/g, '<span style="color:#22c55e;font-size:9px">✅ ACTION PROPOSED — SEE BELOW</span>')
                          .replace(/```alert[\s\S]*?```/g, '<span style="color:#ef4444;font-size:9px">🔴 ALERT GENERATED</span>')
                          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#e5e7eb">$1</strong>')
                          .replace(/`(.*?)`/g, '<code style="background:rgba(31,41,55,0.8);padding:1px 4px;border-radius:3px;color:#ff9933">$1</code>')
                          .replace(/^### (.*?)$/gm, '<div style="color:#ff9933;font-weight:bold;margin-top:8px;font-size:11px">$1</div>')
                          .replace(/^## (.*?)$/gm, '<div style="color:#ffcc99;font-weight:bold;margin-top:10px;font-size:12px">$1</div>')
                          .replace(/^- (.*?)$/gm, '<div style="padding-left:8px">• $1</div>')
                          .replace(/\n/g, '<br/>')
                      }}
                    />
                  </div>
                </div>
              ))}

              {/* Action proposals with email dispatch */}
              {pendingActions.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[9px] text-green-400 font-bold tracking-wider flex items-center gap-1">
                    <Target size={10} /> PROPOSED ACTIONS — SELECT TO EMAIL
                  </div>
                  {pendingActions.map((action, i) => {
                    const key = `${action.action}_${action.incident}`.slice(0, 100)
                    const isSent = emailSent.has(key)
                    const isSending = sendingEmail === key
                    return (
                      <div key={i} className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(34,197,94,0.05)' }}>
                        <div className="px-3 py-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${action.severity === 'critical' ? 'bg-red-500/20 text-red-400' : action.severity === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'}`}>
                              {action.severity?.toUpperCase() || 'MEDIUM'}
                            </span>
                            <span className="text-[9px] text-gray-500 truncate flex-1">{action.incident}</span>
                          </div>
                          <p className="text-[11px] text-green-300 font-medium">{action.action}</p>
                          {action.details && <p className="text-[9px] text-gray-500 mt-1">{action.details}</p>}
                          <div className="flex items-center gap-3 mt-2">
                            <div className="flex-1">
                              <div className="flex items-center justify-between text-[9px] mb-1">
                                <span className="text-gray-500">SUCCESS PROBABILITY</span>
                                <span className="text-green-400 font-bold">{action.successRate}%</span>
                              </div>
                              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${action.successRate}%`, background: action.successRate > 70 ? '#22c55e' : action.successRate > 40 ? '#f59e0b' : '#ef4444' }} />
                              </div>
                            </div>
                            <button
                              onClick={() => sendEmailAction(action)}
                              disabled={isSending || isSent}
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[9px] font-bold transition-all ${isSent ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-orange-500/20 text-orange-300 border border-orange-500/30 hover:bg-orange-500/30'}`}
                            >
                              {isSent ? <><CheckCircle size={10} /> SENT</> : isSending ? <><Mail size={10} className="animate-pulse" /> SENDING...</> : <><Mail size={10} /> EMAIL</>}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="flex justify-start">
                  <div className="border px-3 py-2 rounded-lg" style={{ background: 'rgba(31,41,55,0.5)', borderColor: 'rgba(55,65,81,0.3)' }}>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#ff9933', animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#ff9933', animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#ff9933', animationDelay: '300ms' }} />
                      </div>
                      <span className="text-[9px] text-gray-600">FUSING MULTI-INT DATA...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {messages.length > 0 && !isLoading && (
              <div className="shrink-0 px-2 py-1 border-t border-gray-800/30 overflow-x-auto scrollbar-hide">
                <div className="flex gap-1">
                  {QUICK_ACTIONS.slice(0, 5).map((qa, i) => (
                    <button key={i} onClick={() => sendMessage(qa.msg)}
                      className="shrink-0 px-2 py-0.5 text-[8px] rounded border border-gray-800/30 text-gray-600 hover:text-orange-300 hover:border-orange-500/20 transition-all"
                    >{qa.label}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="shrink-0 p-2" style={{ borderTop: '1px solid rgba(255, 153, 51, 0.1)' }}>
              <div className="flex gap-2">
                <input value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }}}
                  placeholder="Intel query... (e.g. 'China threat near Andaman')"
                  className="flex-1 bg-gray-800/50 border border-gray-700/30 rounded px-3 py-2 text-[11px] text-white placeholder-gray-600 focus:outline-none"
                  disabled={isLoading}
                />
                <button onClick={() => sendMessage()} disabled={isLoading || !input.trim()}
                  className="px-3 py-2 rounded text-orange-300 disabled:opacity-30"
                  style={{ background: 'rgba(255, 103, 0, 0.2)', border: '1px solid rgba(255, 153, 51, 0.2)' }}
                ><Send size={14} /></button>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[8px] text-gray-700">
                <span>TOP SECRET // INDIA EYES ONLY // SoTaNik_AI</span>
                <span className="ml-auto flex items-center gap-1"><Newspaper size={8} className="text-blue-500" />{newsCache.length} NEWS</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
