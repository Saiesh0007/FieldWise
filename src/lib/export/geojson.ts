/**
 * GeoJSON export — a single FeatureCollection bundling the boundary, the
 * no-spray zones, and the spray plan's legs (spray + transit), each
 * tagged with a `role` property so any GIS tool that opens the file can
 * filter/style the layers itself. This deliberately reuses the same
 * feature-builder functions the map itself renders from (lib/map/geojson.ts)
 * rather than a second, parallel conversion — so the exported file can
 * never quietly disagree with what's on screen.
 */
import type { Feature, FeatureCollection } from 'geojson'
import { boundaryToPolygonFeature, sprayPlanToFeatureCollections, zonesToFeatureCollection } from '@/lib/map/geojson'
import type { LocalProjection } from '@/lib/geo/projection'
import type { FieldBoundary, NoSprayZone, SprayPlan } from '@/lib/geo/types'

export function buildFieldGeoJson(
  boundary: FieldBoundary,
  noSprayZones: NoSprayZone[],
  sprayPlan: SprayPlan | null,
  projection: LocalProjection | null,
): FeatureCollection {
  const features: Feature[] = []

  const boundaryFeature = boundaryToPolygonFeature(boundary)
  features.push({ ...boundaryFeature, properties: { ...boundaryFeature.properties, role: 'boundary' } })

  for (const zoneFeature of zonesToFeatureCollection(noSprayZones).features) {
    features.push({ ...zoneFeature, properties: { ...zoneFeature.properties, role: 'no-spray-zone' } })
  }

  if (sprayPlan && projection) {
    const { spray, transit } = sprayPlanToFeatureCollections(sprayPlan, projection)
    for (const f of spray.features) features.push({ ...f, properties: { ...f.properties, role: 'spray-leg' } })
    for (const f of transit.features) features.push({ ...f, properties: { ...f.properties, role: 'transit-leg' } })
  }

  return { type: 'FeatureCollection', features }
}
