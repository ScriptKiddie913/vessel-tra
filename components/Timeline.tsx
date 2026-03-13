'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import { Play, Pause, SkipBack, SkipForward, Clock } from 'lucide-react'

export default function Timeline() {
  const { timelineOffset, isPlaying, setTimelineOffset, setIsPlaying } =
    useSatelliteStore()
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Playback
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        useSatelliteStore.setState((s) => {
          const next = s.timelineOffset + 1
          if (next > 60) {
            return { isPlaying: false, timelineOffset: 60 }
          }
          return { timelineOffset: next }
        })
      }, 500) // 1 minute per 0.5s real time
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPlaying])

  const formatOffset = (min: number) => {
    const sign = min >= 0 ? '+' : ''
    const h = Math.floor(Math.abs(min) / 60)
    const m = Math.abs(min) % 60
    if (h > 0) return `T${sign}${h}h${m.toString().padStart(2, '0')}m`
    return `T${sign}${min}m`
  }

  const jumpTo = useCallback(
    (offset: number) => {
      setTimelineOffset(offset)
      setIsPlaying(false)
    },
    [setTimelineOffset, setIsPlaying]
  )

  return (
    <div className="absolute bottom-0 left-80 right-0 bg-black/90 backdrop-blur-md border-t border-intel-border z-[1000]">
      <div className="flex items-center gap-4 px-6 py-3">
        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => jumpTo(-60)}
            className="text-gray-500 hover:text-white transition-colors"
            title="T-60 min"
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
              isPlaying
                ? 'bg-intel-red/20 text-intel-red border border-intel-red/30'
                : 'bg-intel-cyan/20 text-intel-cyan border border-intel-cyan/30'
            }`}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            onClick={() => jumpTo(60)}
            className="text-gray-500 hover:text-white transition-colors"
            title="T+60 min"
          >
            <SkipForward size={14} />
          </button>
        </div>

        {/* Time label */}
        <div className="flex items-center gap-2 min-w-[120px]">
          <Clock size={12} className="text-gray-500" />
          <span
            className={`font-mono text-xs font-bold tracking-wider ${
              timelineOffset === 0
                ? 'text-intel-green'
                : timelineOffset < 0
                  ? 'text-intel-amber'
                  : 'text-intel-cyan'
            }`}
          >
            {timelineOffset === 0 ? 'LIVE' : formatOffset(timelineOffset)}
          </span>
        </div>

        {/* Slider */}
        <div className="flex-1 flex items-center gap-3">
          <span className="text-gray-600 text-[10px] font-mono">T−60</span>
          <div className="flex-1 relative">
            <input
              type="range"
              min={-60}
              max={60}
              value={timelineOffset}
              onChange={(e) => setTimelineOffset(parseInt(e.target.value))}
              className="w-full h-1 appearance-none bg-gray-800 rounded-full outline-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-3
                [&::-webkit-slider-thumb]:h-3
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-intel-cyan
                [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(0,229,255,0.5)]
              "
            />
            {/* Zero marker */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-intel-green/60"
              style={{ left: '50%' }}
            />
          </div>
          <span className="text-gray-600 text-[10px] font-mono">T+60</span>
        </div>

        {/* Quick jumps */}
        <div className="flex gap-1">
          {[-30, -15, 0, 15, 30].map((t) => (
            <button
              key={t}
              onClick={() => jumpTo(t)}
              className={`px-2 py-1 rounded text-[9px] font-mono transition-all ${
                timelineOffset === t
                  ? 'bg-intel-cyan/20 text-intel-cyan border border-intel-cyan/30'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              {t === 0 ? 'NOW' : t > 0 ? `+${t}` : t}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
