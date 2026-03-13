import { useEffect, useRef } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'

const SUPABASE_PROJECT_ID = 'czbfzqegmwmglahhilio'
const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6YmZ6cWVnbXdtZ2xhaGhpbGlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzI0NjcsImV4cCI6MjA4ODU0ODQ2N30.eqq0C19uy6MUlTrnmhWp81zyptAV9kpLKdGtcrFZsx4'

export function useAISStream() {
  const setLiveVessels = useSatelliteStore(s => s.setLiveVessels)
  const pollingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null

    const fetchVessels = async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ais-vessels`, {
          headers: {
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'apikey': SUPABASE_KEY,
          },
          signal: AbortSignal.timeout(30000),
        })
        
        if (!res.ok) {
          console.error(`[AIS] Edge function returned ${res.status}`)
          return
        }
        
        const data = await res.json()
        if (!cancelled && data.vessels && data.vessels.length > 0) {
          const src = data.sources || {};
          console.log(`[AIS] ✅ ${data.count} vessels worldwide (digitraffic: ${src.digitraffic || 0}, kystverket: ${src.kystverket || 0}, sat-ais: ${src['sat-ais'] || 0}, aisstream: ${src.aisstream || 0})`)
          setLiveVessels(data.vessels)
        }
      } catch (e) {
        console.error('[AIS] Fetch error:', e)
      } finally {
        pollingRef.current = false
      }
    }

    console.log('[AIS] Starting vessel polling via edge function...')
    fetchVessels()
    interval = setInterval(fetchVessels, 25000)

    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
    }
  }, [setLiveVessels])
}
