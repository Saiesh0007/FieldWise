/**
 * A resilient satellite tile source: caches successfully-loaded tiles in
 * the browser's Cache API (so panning/zooming back over already-seen
 * ground never re-requests it from Esri), and falls back to a
 * completely different tile provider (OpenStreetMap's standard raster
 * tiles) whenever Esri either errors out or serves its "Map data not
 * yet available" placeholder — confirmed via direct sampling (see
 * tileUrl.ts) to be a static, byte-identical image Esri returns with an
 * ordinary 200 OK, not an HTTP error MapLibre would otherwise surface on
 * its own.
 *
 * Implemented as a custom MapLibre protocol (`fwsat://`) registered
 * once at module load, rather than a second map source — from
 * MapLibre's point of view there's still exactly one "satellite"
 * source; this just controls what bytes come back for a given tile.
 *
 * The fallback provider is NOT satellite imagery (OSM is a line/label
 * map) — that's a genuine visual step down, used only when the primary
 * source is unavailable, and surfaced to the user via
 * onTileSourceStatusChange rather than silently swapped in unlabeled.
 *
 * This file is deliberately thin glue around the pure, unit-tested
 * logic in tileUrl.ts (URL building, placeholder detection) — the parts
 * that talk to fetch/Cache API/MapLibre itself are verified with a real
 * browser pass instead, the same convention lib/export/download.ts uses
 * for its own browser-only glue.
 */
import { addProtocol, type Map as MapLibreMap } from 'maplibre-gl'
import { buildTileUrl, looksLikePlaceholderTile, parseTileRequestUrl } from './tileUrl'

export const TILE_PROTOCOL = 'fwsat'
const CACHE_NAME = 'fieldwise-satellite-tiles-v1'
const PRIMARY_TEMPLATE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const FALLBACK_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

export interface TileSourceStatus {
  /** True once at least one tile has had to fall back to the non-satellite provider this session. */
  usingFallback: boolean
}

type StatusListener = (status: TileSourceStatus) => void
const listeners = new Set<StatusListener>()
let fallbackActive = false

function setFallbackActive(active: boolean) {
  if (fallbackActive === active) return
  fallbackActive = active
  for (const listener of listeners) listener({ usingFallback: fallbackActive })
}

/** Subscribes to fallback-provider status changes (for the "showing backup map" banner). Returns an unsubscribe function. */
export function onTileSourceStatusChange(listener: StatusListener): () => void {
  listeners.add(listener)
  listener({ usingFallback: fallbackActive }) // fire immediately with current state, so a late subscriber isn't stuck showing stale "all good"
  return () => listeners.delete(listener)
}

let registered = false

/** Registers the fwsat:// protocol. Safe to call more than once (e.g. across HMR reloads in dev) — only registers on the first call. */
export function registerResilientSatelliteProtocol(): void {
  if (registered) return
  registered = true

  addProtocol(TILE_PROTOCOL, async (params, abortController) => {
    const parsed = parseTileRequestUrl(params.url)
    if (!parsed) throw new Error(`Malformed fwsat tile URL: ${params.url}`)
    const { z, x, y } = parsed

    const primaryUrl = buildTileUrl(PRIMARY_TEMPLATE, z, x, y)
    const cache = await caches.open(CACHE_NAME)

    // Already have a known-good copy of this exact tile from earlier in
    // the session — serve it straight from the Cache API, no network
    // round-trip at all. This is what actually reduces how often the app
    // asks Esri for anything in the first place, not just what happens
    // when a request fails.
    const cached = await cache.match(primaryUrl)
    if (cached) {
      return { data: await cached.arrayBuffer() }
    }

    try {
      const response = await fetch(primaryUrl, { signal: abortController.signal })
      if (response.ok) {
        const buffer = await response.clone().arrayBuffer()
        if (!looksLikePlaceholderTile(buffer.byteLength)) {
          await cache.put(primaryUrl, response)
          setFallbackActive(false)
          return { data: buffer }
        }
        // Falls through to the fallback provider below — this is Esri's
        // real "no data (yet)" placeholder, not something worth caching
        // or displaying as if it were the field itself.
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
      // Any other fetch failure (network error, CORS, rate limiting
      // manifesting as a hard error rather than the placeholder above) —
      // also falls through to the fallback provider.
    }

    setFallbackActive(true)
    const fallbackUrl = buildTileUrl(FALLBACK_TEMPLATE, z, x, y)
    const fallbackResponse = await fetch(fallbackUrl, { signal: abortController.signal })
    return { data: await fallbackResponse.arrayBuffer() }
  })
}

/**
 * Manual "Retry" action. Doesn't touch the Cache API (it only ever holds
 * confirmed-real tiles, never placeholders or fallback tiles, so there's
 * nothing bad cached to clear) — it needs to force MapLibre to actually
 * re-request every currently-visible tile.
 *
 * `RasterTileSource.setTiles()` with the exact same URL template it
 * already has turned out NOT to reliably do that in testing — MapLibre's
 * internal diffing has no reason to treat an unchanged tile template as
 * "please reload", so a tile it already considers loaded (even if that
 * "load" was a fallback tile) can just sit there. Removing and re-adding
 * the source and layer is heavier but uses only public, documented APIs
 * and is unambiguous: there is no existing source for anything to diff
 * against, so every visible tile gets a fresh request. Fine for a rare,
 * explicit user action like this one.
 */
export function retryTileSource(map: MapLibreMap, sourceId: string, layerId: string): void {
  // The satellite layer must go back in at the BOTTOM of the stack (it's
  // the basemap) — addLayer with no `beforeId` appends to the top, which
  // would silently cover the boundary/plan/heatmap layers. Capture
  // whichever layer currently sits directly above it so it can be
  // re-inserted in exactly the same spot.
  const layers = map.getStyle()?.layers ?? []
  const satelliteIndex = layers.findIndex((l) => l.id === layerId)
  const beforeId = satelliteIndex >= 0 ? layers[satelliteIndex + 1]?.id : undefined

  if (map.getLayer(layerId)) map.removeLayer(layerId)
  if (map.getSource(sourceId)) map.removeSource(sourceId)

  map.addSource(sourceId, {
    type: 'raster',
    tiles: [`${TILE_PROTOCOL}://{z}/{x}/{y}`],
    tileSize: 256,
    maxzoom: 19,
    attribution: 'Esri, Maxar, Earthstar Geographics · OpenStreetMap contributors (backup)',
  })
  map.addLayer({ id: layerId, type: 'raster', source: sourceId }, beforeId)
}
