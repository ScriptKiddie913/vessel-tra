export interface WorldMainEndpointResult {
  ok: boolean
  source: string
  count: number
  error?: string
}

const DEFAULT_WORLD_MAIN_BASE = 'http://127.0.0.1:8000'

function getCandidates(path: string): string[] {
  const runtimeBase =
    typeof window !== 'undefined'
      ? ((window as unknown as { __WORLD_MAIN_API_BASE?: string }).__WORLD_MAIN_API_BASE ?? '').trim()
      : ''

  const remote = (runtimeBase.length > 0 ? runtimeBase : DEFAULT_WORLD_MAIN_BASE).replace(/\/$/, '')

  if (path.startsWith('http://') || path.startsWith('https://')) {
    return [path]
  }

  return [path, `${remote}${path}`]
}

function inferCount(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length
  if (!payload || typeof payload !== 'object') return 0

  const obj = payload as Record<string, unknown>
  if (typeof obj.count === 'number') return obj.count

  for (const key of ['items', 'data', 'events', 'features', 'articles', 'results', 'groups']) {
    const value = obj[key]
    if (Array.isArray(value)) return value.length
  }

  return Object.keys(obj).length
}

export async function probeWorldMainEndpoint(path: string): Promise<WorldMainEndpointResult> {
  return probeWorldMainEndpoints([path])
}

export async function probeWorldMainEndpoints(paths: string[]): Promise<WorldMainEndpointResult> {
  for (const path of paths) {
    const result = await probeSingleEndpoint(path)
    if (result.ok) return result
  }

  const fallback = paths[paths.length - 1] ?? ''
  const candidates = getCandidates(fallback)
  return {
    ok: false,
    source: candidates[candidates.length - 1] ?? fallback,
    count: 0,
    error: 'Endpoint unavailable from current app runtime',
  }
}

async function probeSingleEndpoint(path: string): Promise<WorldMainEndpointResult> {
  const candidates = getCandidates(path)

  for (const url of candidates) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) {
        continue
      }

      const payload = await response.json()
      return {
        ok: true,
        source: url,
        count: inferCount(payload),
      }
    } catch {
      // Try the next endpoint candidate.
    }
  }

  return {
    ok: false,
    source: candidates[candidates.length - 1],
    count: 0,
    error: 'Endpoint unavailable from current app runtime',
  }
}
