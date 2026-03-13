'use client'

import { useState, useEffect, useRef } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import { analyzeThreats, type ThreatAlert } from '@/lib/threat-engine'
import { AlertTriangle, Shield, X, ChevronDown, ChevronUp, Bell, BellOff } from 'lucide-react'

const LEVEL_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  CRITICAL: { bg: 'bg-red-950/80', border: 'border-red-500/40', text: 'text-red-400', icon: '🔴' },
  HIGH: { bg: 'bg-orange-950/60', border: 'border-orange-500/30', text: 'text-orange-400', icon: '🟠' },
  MEDIUM: { bg: 'bg-yellow-950/40', border: 'border-yellow-500/20', text: 'text-yellow-400', icon: '🟡' },
  LOW: { bg: 'bg-blue-950/30', border: 'border-blue-500/15', text: 'text-blue-400', icon: '🔵' },
}

export default function ThreatAlerts() {
  const { liveVessels, quakes, events } = useSatelliteStore()
  const [alerts, setAlerts] = useState<ThreatAlert[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const prevCountRef = useRef(0)

  // Run threat analysis every 15 seconds
  useEffect(() => {
    if (isPaused) return

    const analyze = () => {
      const newAlerts = analyzeThreats(liveVessels, quakes, events, alerts)
      if (newAlerts.length > 0) {
        setAlerts(prev => {
          const merged = [...newAlerts, ...prev]
          // Keep max 50 alerts
          return merged.slice(0, 50)
        })
      }
    }

    analyze()
    const iv = setInterval(analyze, 15000)
    return () => clearInterval(iv)
  }, [liveVessels, quakes, events, isPaused]) // eslint-disable-line react-hooks/exhaustive-deps

  // Alert sound on new critical/high alerts
  useEffect(() => {
    const activeCount = alerts.filter(a => !a.dismissed && (a.level === 'CRITICAL' || a.level === 'HIGH')).length
    if (activeCount > prevCountRef.current && !isPaused) {
      // Flash the button
      setIsOpen(true)
    }
    prevCountRef.current = activeCount
  }, [alerts, isPaused])

  const dismiss = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a))
  }

  const dismissAll = () => {
    setAlerts(prev => prev.map(a => ({ ...a, dismissed: true })))
  }

  const activeAlerts = alerts.filter(a => !a.dismissed)
  const criticalCount = activeAlerts.filter(a => a.level === 'CRITICAL').length
  const highCount = activeAlerts.filter(a => a.level === 'HIGH').length

  return (
    <>
      {/* Floating alert button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`absolute top-3 left-1/2 translate-x-32 z-[1001] flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-[10px] tracking-wider transition-all border backdrop-blur-sm ${
          criticalCount > 0
            ? 'bg-red-950/80 border-red-500/40 text-red-400 animate-pulse'
            : highCount > 0
              ? 'bg-orange-950/60 border-orange-500/30 text-orange-400'
              : activeAlerts.length > 0
                ? 'bg-yellow-950/40 border-yellow-600/20 text-yellow-500'
                : 'bg-gray-900/80 border-gray-700/30 text-gray-500'
        }`}
      >
        <AlertTriangle size={12} />
        <span>THREATS</span>
        {activeAlerts.length > 0 && (
          <span className="bg-red-600/80 text-white text-[9px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
            {activeAlerts.length}
          </span>
        )}
      </button>

      {/* Alert Panel */}
      {isOpen && (
        <div
          className="absolute top-12 right-4 z-[1001] w-[400px] max-h-[500px] flex flex-col bg-gray-950/95 backdrop-blur-md border border-gray-700/30 rounded-lg overflow-hidden shadow-2xl font-mono"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-red-950/30 border-b border-red-500/15 shrink-0">
            <Shield size={14} className="text-red-400" />
            <span className="text-red-300 text-[10px] font-bold tracking-[0.2em] flex-1">
              THREAT ASSESSMENT
            </span>
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`p-1 rounded transition-colors ${isPaused ? 'text-red-400' : 'text-gray-500 hover:text-gray-300'}`}
              title={isPaused ? 'Resume scanning' : 'Pause scanning'}
            >
              {isPaused ? <BellOff size={12} /> : <Bell size={12} />}
            </button>
            {activeAlerts.length > 0 && (
              <button
                onClick={dismissAll}
                className="text-[9px] text-gray-500 hover:text-gray-300 px-2 py-0.5 border border-gray-700/30 rounded transition-colors"
              >
                CLEAR ALL
              </button>
            )}
            <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-red-400 transition-colors">
              <X size={12} />
            </button>
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-800/50 text-[9px]">
            <span className="text-gray-600">{isPaused ? '⏸ PAUSED' : '🔄 SCANNING'}</span>
            <span className="text-gray-700">|</span>
            {criticalCount > 0 && <span className="text-red-400">🔴 {criticalCount} CRITICAL</span>}
            {highCount > 0 && <span className="text-orange-400">🟠 {highCount} HIGH</span>}
            <span className="text-gray-500">{activeAlerts.length} TOTAL</span>
          </div>

          {/* Alert list */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {activeAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                <Shield size={24} className="mb-2 opacity-30" />
                <p className="text-[10px]">NO ACTIVE THREATS</p>
                <p className="text-[9px] text-gray-700 mt-1">Continuous monitoring active</p>
              </div>
            ) : (
              activeAlerts.map(alert => {
                const style = LEVEL_STYLES[alert.level] || LEVEL_STYLES.LOW
                const isExpanded = expandedId === alert.id
                return (
                  <div
                    key={alert.id}
                    className={`border-b border-gray-800/30 ${style.bg} transition-all`}
                  >
                    <div
                      className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-white/[0.02]"
                      onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                    >
                      <span className="text-xs mt-0.5 shrink-0">{style.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold ${style.text}`}>{alert.level}</span>
                          <span className="text-[9px] text-gray-600 uppercase">{alert.type.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="text-[11px] text-gray-300 mt-0.5 truncate">{alert.title}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[8px] text-gray-700">
                          {new Date(alert.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isExpanded ? <ChevronUp size={10} className="text-gray-600" /> : <ChevronDown size={10} className="text-gray-600" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-3 pb-3 ml-6">
                        <p className="text-[10px] text-gray-400 leading-relaxed">{alert.description}</p>
                        {alert.recommendation && (
                          <div className="mt-2 px-2 py-1.5 bg-gray-800/40 border-l-2 border-blue-500/40 rounded-r">
                            <p className="text-[9px] text-blue-400 font-bold mb-0.5">RECOMMENDATION</p>
                            <p className="text-[10px] text-gray-400">{alert.recommendation}</p>
                          </div>
                        )}
                        {alert.location && (
                          <p className="text-[9px] text-gray-600 mt-1.5">
                            📍 {alert.location.lat.toFixed(2)}°N, {alert.location.lng.toFixed(2)}°E
                          </p>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); dismiss(alert.id) }}
                          className="mt-2 text-[9px] text-gray-600 hover:text-gray-400 border border-gray-700/30 px-2 py-0.5 rounded transition-colors"
                        >
                          DISMISS
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 px-3 py-1.5 border-t border-gray-800/50 text-[8px] text-gray-700">
            SoTaNik_AI THREAT ENGINE v2.0 · AUTO-SCAN 15s · {alerts.length} TOTAL PROCESSED
          </div>
        </div>
      )}
    </>
  )
}
