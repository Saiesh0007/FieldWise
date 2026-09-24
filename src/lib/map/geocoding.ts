/**
 * Place search — lets a pilot navigate to their own real field anywhere
 * in the world before tracing/walking a boundary, instead of only ever
 * seeing the fixed sample field. Uses Nominatim (OpenStreetMap's
 * geocoding service) specifically because, like the tile sources, it
 * needs no API key or signup.
 *
 * Nominatim's own usage policy asks for a valid Referer or User-Agent
 * identifying the calling application. A browser's `fetch` can't set a
 * custom User-Agent (the Fetch spec forbids it), but it always sends a
 * real Referer for a cross-origin request, which satisfies that policy
 * without any extra code here. The policy's other main ask — no heavy,
 * bulk automated use — is why the UI debounces search input rather than
 * querying on every keystroke (see LocationSearch.tsx).
 *
 * This is a separate OSM service (nominatim.openstreetmap.org) from the
 * tile fallback's tile.openstreetmap.org (see resilientSatelliteTiles.ts)
 * — different subdomain, different service, different rate-limit pool —
 * so searching a place doesn't compete with or exhaust the tile
 * fallback's own usage allowance.
 */

export interface GeocodeResult {
  id: string
  label: string
  lat: number
  lon: number
  /** [south, north, west, east] in degrees, when Nominatim provides one — used to fit the whole place in view rather than a fixed zoom level. */
  boundingBox: [number, number, number, number] | null
}

/**
 * Parses Nominatim's `/search?format=json` response into a clean,
 * validated result list. Defensive by design: Nominatim's fields
 * (lat/lon/boundingbox) come back as strings, not numbers, and a
 * malformed or unexpected entry should be skipped rather than crash the
 * whole search — this is parsing an external service's response, not
 * this app's own trusted data.
 */
export function parseNominatimResults(raw: unknown): GeocodeResult[] {
  if (!Array.isArray(raw)) return []

  const results: GeocodeResult[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>

    const lat = Number(obj.lat)
    const lon = Number(obj.lon)
    const label = typeof obj.display_name === 'string' ? obj.display_name : null
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !label) continue

    let boundingBox: GeocodeResult['boundingBox'] = null
    if (Array.isArray(obj.boundingbox) && obj.boundingbox.length === 4) {
      const nums = obj.boundingbox.map(Number)
      if (nums.every(Number.isFinite)) {
        boundingBox = [nums[0], nums[1], nums[2], nums[3]]
      }
    }

    const idSource = obj.place_id
    const id = typeof idSource === 'number' || typeof idSource === 'string' ? String(idSource) : `${lat},${lon}`

    results.push({ id, label, lat, lon, boundingBox })
  }
  return results
}

export class GeocodingError extends Error {}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const RESULT_LIMIT = 6

/** Browser-only glue (fetch + error mapping) around the pure parser above — verified with a real browser pass rather than unit-tested, same convention as this project's other network/browser glue (e.g. lib/export/download.ts, lib/map/resilientSatelliteTiles.ts). */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const url = `${NOMINATIM_SEARCH_URL}?format=json&limit=${RESULT_LIMIT}&q=${encodeURIComponent(trimmed)}`

  let response: Response
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw new GeocodingError('Could not reach the location search service — check your connection and try again.')
  }

  if (!response.ok) {
    throw new GeocodingError('The location search service is temporarily unavailable — try again in a moment.')
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new GeocodingError('The location search service returned something unexpected — try again in a moment.')
  }

  return parseNominatimResults(data)
}
