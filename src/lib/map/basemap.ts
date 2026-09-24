import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { TILE_PROTOCOL } from './resilientSatelliteTiles'

export const SATELLITE_SOURCE_ID = 'satellite'
export const SATELLITE_LAYER_ID = 'satellite'

export type BaseMapMode = 'satellite' | 'street'

/** Standard OpenStreetMap raster tiles — also the tile-fallback's backup provider (resilientSatelliteTiles.ts), reused here as an explicit, user-chosen alternative to satellite imagery rather than just an emergency fallback. */
const STREET_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png']
const SATELLITE_TILES = [`${TILE_PROTOCOL}://{z}/{x}/{y}`]
const SATELLITE_ATTRIBUTION = 'Esri, Maxar, Earthstar Geographics · OpenStreetMap contributors (backup)'
const STREET_ATTRIBUTION = 'OpenStreetMap contributors'

/**
 * Esri World Imagery — chosen specifically because it needs no API key or
 * signup. That matters twice over here: a solo 2-day build has no time
 * for key-provisioning friction, and judges opening a shared demo link
 * shouldn't hit a blank map because a key wasn't set up for them.
 * Attribution is required and is surfaced via MapLibre's attribution
 * control.
 *
 * The tile URL points at the fwsat:// custom protocol (see
 * resilientSatelliteTiles.ts), not Esri directly — that layer handles
 * session-long caching and falling back to a different provider when
 * Esri errors or serves its "not yet available" placeholder, entirely
 * transparently to this style definition.
 */
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    [SATELLITE_SOURCE_ID]: {
      type: 'raster',
      tiles: SATELLITE_TILES,
      tileSize: 256,
      maxzoom: 19,
      attribution: SATELLITE_ATTRIBUTION,
    },
  },
  layers: [{ id: SATELLITE_LAYER_ID, type: 'raster', source: SATELLITE_SOURCE_ID }],
}

/**
 * AeroGCS Green's "Toggle Map View" — switches the base layer between
 * satellite imagery and a plain street/label map, in place. Swaps just
 * the one base source+layer rather than map.setStyle() (which would
 * tear down and require re-adding every other source/layer FieldMap
 * manages — boundary, zones, spray plan, heatmap, and more): this way
 * nothing else on the map is disturbed. Same remove-and-re-add
 * mechanism as retryTileSource in resilientSatelliteTiles.ts, and for
 * the same reason (setTiles() on an unchanged-looking source doesn't
 * reliably force a reload) — kept as a mirror function here rather than
 * a shared helper since the two also carry different attribution text.
 */
export function setBaseMapMode(map: MapLibreMap, mode: BaseMapMode): void {
  const layers = map.getStyle()?.layers ?? []
  const baseIndex = layers.findIndex((l) => l.id === SATELLITE_LAYER_ID)
  const beforeId = baseIndex >= 0 ? layers[baseIndex + 1]?.id : undefined

  if (map.getLayer(SATELLITE_LAYER_ID)) map.removeLayer(SATELLITE_LAYER_ID)
  if (map.getSource(SATELLITE_SOURCE_ID)) map.removeSource(SATELLITE_SOURCE_ID)

  map.addSource(SATELLITE_SOURCE_ID, {
    type: 'raster',
    tiles: mode === 'satellite' ? SATELLITE_TILES : STREET_TILES,
    tileSize: 256,
    maxzoom: 19,
    attribution: mode === 'satellite' ? SATELLITE_ATTRIBUTION : STREET_ATTRIBUTION,
  })
  map.addLayer({ id: SATELLITE_LAYER_ID, type: 'raster', source: SATELLITE_SOURCE_ID }, beforeId)
}
