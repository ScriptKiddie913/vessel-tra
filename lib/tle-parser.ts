import type { TLESatellite } from './types'

export function parseTLEText(raw: string): TLESatellite[] {
  const lines = raw
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const sats: TLESatellite[] = []

  for (let i = 0; i < lines.length; i += 3) {
    if (i + 2 >= lines.length) break
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]

    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      // Malformed, skip
      continue
    }

    const noradId = line1.substring(2, 7).trim()

    sats.push({ name, line1, line2, noradId })
  }
  return sats
}

export function parseTLEJSON(data: any[]): TLESatellite[] {
  return data
    .filter((d) => d.TLE_LINE1 && d.TLE_LINE2)
    .map((d) => ({
      name: d.OBJECT_NAME || d.satname || 'UNKNOWN',
      line1: d.TLE_LINE1,
      line2: d.TLE_LINE2,
      noradId: String(d.NORAD_CAT_ID || '').trim(),
    }))
}
