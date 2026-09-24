import { edgeLengthLocal } from './boundary'
import type { FieldBoundary, LocalPoint, ReadinessSummary } from './types'

/**
 * The Flight Readiness Gate's core logic: a flight is cleared only when
 * every edge is either verified (walked/confirmed) or its risk has been
 * explicitly accepted by the pilot — this is the enforcement mechanism
 * for "never trust the satellite input blindly". Kept as a pure function
 * over (boundary, localVertices) so it can be called on every provenance
 * change without touching the store, and re-tested against fixed inputs.
 */
export function computeReadiness(boundary: FieldBoundary, localVertices: LocalPoint[]): ReadinessSummary {
  let unverifiedEdges = 0
  let unverifiedLengthM = 0
  let acceptedRiskEdges = 0
  const blockingEdgeIds: string[] = []

  for (const edge of boundary.edges) {
    if (edge.provenance.kind !== 'satellite') continue // walked/confirmed are verified by construction

    if (edge.provenance.acceptedRisk) {
      acceptedRiskEdges++
      continue
    }

    unverifiedEdges++
    unverifiedLengthM += edgeLengthLocal(localVertices, edge)
    blockingEdgeIds.push(edge.id)
  }

  return {
    cleared: unverifiedEdges === 0,
    totalEdges: boundary.edges.length,
    unverifiedEdges,
    unverifiedLengthM,
    acceptedRiskEdges,
    blockingEdgeIds,
  }
}
