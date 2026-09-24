import { distance } from './math'
import type { BoundaryEdge, BoundarySource, FieldBoundary, LatLng, LocalPoint, ProvenanceKind } from './types'

function defaultProvenanceFor(source: BoundarySource): ProvenanceKind {
  // GPS walk and drone-walk are ground-truth acts — points captured in the
  // field at known locations — so they start verified. Satellite tracing
  // and file imports all carry the same risk (a dated, possibly-stale prior)
  // regardless of where the file came from.
  return source === 'gps-walk' || source === 'drone-walk' ? 'walked' : 'satellite'
}

/**
 * Builds a FieldBoundary from a vertex ring, generating sequential edges
 * with provenance defaulted from the source. This is the one place edge
 * IDs/indices get created, so callers (map UI, tests, delta corrections)
 * don't have to hand-roll the edge list.
 */
export function createBoundary(
  vertices: LatLng[],
  source: BoundarySource,
  opts: { imageryDate?: string; accuracyM?: number; id?: string } = {},
): FieldBoundary {
  const kind = defaultProvenanceFor(source)
  const edges: BoundaryEdge[] = vertices.map((_, i) => ({
    id: `e${i}`,
    fromIndex: i,
    toIndex: (i + 1) % vertices.length,
    provenance: {
      kind,
      imageryDate: kind === 'satellite' ? opts.imageryDate : undefined,
      accuracyM: kind === 'walked' ? opts.accuracyM : undefined,
      verifiedAt: kind !== 'satellite' ? new Date().toISOString() : undefined,
    },
  }))

  return {
    id: opts.id ?? `field-${Date.now()}`,
    vertices,
    edges,
    source,
    createdAt: new Date().toISOString(),
  }
}

export function edgeLengthLocal(localVertices: LocalPoint[], edge: BoundaryEdge): number {
  return distance(localVertices[edge.fromIndex], localVertices[edge.toIndex])
}
