/**
 * Delta corrections — the mechanism behind "not a full redraw". Every
 * correction here touches only the vertices/edges it needs to: the rest
 * of the boundary's geometry and provenance come back as the exact same
 * objects, untouched. That's what keeps a correction cheap enough to
 * re-plan after in ~1s, and what keeps the readiness gate's "N of M
 * edges" count meaningful instead of resetting on every edit.
 */
import { kinks, polygon as turfPolygon } from '@turf/turf'
import { distancePointToSegment, simplifyPolyline } from './math'
import type { LocalProjection } from './projection'
import type { BoundaryEdge, FieldBoundary, LatLng, LocalPoint } from './types'

export class DeltaError extends Error {}

/**
 * A real (or simulated) GPS walk can easily record dozens to hundreds of
 * points for a single correction — sampled once a second over a 15-20s
 * walk, or every ~2.5m of drag during the demo's mouse-driven capture.
 * Splicing every one of those in as its own boundary edge is what caused
 * a single trim to explode a 6-edge boundary to 150+ edges. Simplifying
 * first keeps only the points that represent a real direction change;
 * the tolerance is tied to the walk's own claimed GPS accuracy, since
 * there's no point preserving shape detail finer than the fix itself
 * could actually resolve.
 *
 * Multiplied up (not just used directly) because the simulated GPS fix
 * (see FieldMap.tsx's drag handler) jitters every recorded point by up
 * to `accuracyM` in a uniformly random direction, independently per
 * point — unlike real GPS noise, which is spatially correlated from one
 * reading to the next, this can place two adjacent points on opposite
 * sides of the "true" line. A tolerance of only accuracyM itself doesn't
 * reliably absorb that; ~1.5x does in practice, without erasing genuine
 * multi-meter trim shapes, which are typically much larger than this.
 */
const MIN_SIMPLIFY_TOLERANCE_M = 2
const SIMPLIFY_TOLERANCE_ACCURACY_MULTIPLIER = 1.5

/**
 * Plausibility bound on how far a walked trace may stray from the edge
 * it's correcting, measured as perpendicular distance from that edge's
 * original line segment.
 *
 * This catches a failure mode the self-intersection check below can't:
 * a trace that wanders deep into the field's interior and back out past
 * the far side of the boundary can easily be a perfectly *simple*
 * (non-self-crossing) polygon — turf's kinks() has nothing to object to
 * — while still being a wildly implausible "correction" for a single
 * edge. Structurally the splice only ever touches the two vertices
 * bordering the target edge (see applyWalkedEdgeCorrection below); nothing
 * else about the boundary changes. But when the inserted chain is huge
 * relative to the rest of the shape, the *result* reads as "the whole
 * field got replaced" even though only one edge's geometry actually did
 * — which is exactly what this guard exists to refuse before it happens,
 * rather than after.
 *
 * Scaled to the boundary's own bounding-box diagonal (not a fixed
 * distance, and not the target edge's own length — a short edge on a
 * large field shouldn't get a tiny allowance, nor a long edge a huge
 * one) so it stays sensible whether the field is a small plot or
 * hundreds of hectares.
 *
 * Calibrated against this project's own reference for "a real
 * correction": a season-out-of-date satellite trace's typical offset
 * from true ground, which tops out around 20m on a ~250m-scale field —
 * a season-out-of-date satellite trace still isn't off by more than
 * roughly a tenth of the field's own size. 0.2 leaves headroom above
 * that reference while still catching
 * an into-the-interior-and-out-the-other-side excursion: on the sample
 * field (~336m diagonal), the first version of this guard (0.3, ~101m
 * cap) let an 84m real-world spike straight through — visibly wrong on
 * screen, but numerically under the old threshold. 0.2 (~67m cap on
 * that same field) catches it.
 */
const MAX_DEVIATION_FRACTION_OF_DIAGONAL = 0.2
const MIN_MAX_DEVIATION_M = 15

/**
 * Replaces one edge's geometry with a walked trace, splicing the trace's
 * (simplified) points in as new vertices between that edge's two
 * (unchanged) anchor vertices. This single operation covers both
 * directions the twist describes: if the trace falls outside the
 * original edge, the boundary gains area (a newly-planted strip); if it
 * falls inside, the boundary loses area (a trim). The geometry doesn't
 * need to know which case it is — it's the same splice either way, which
 * is why "walk a strip" and "trim an edge" in the UI both call this one
 * function.
 *
 * Every edge the splice creates is provenance 'walked'. Every edge NOT
 * touched by it — id, provenance object included — comes back exactly
 * as it was, just renumbered for the new vertex array.
 *
 * `projection` is required (not just accepted) because simplification
 * needs real-world meters to pick a sensible tolerance, and the
 * self-intersection check below is run in that same local-meter space —
 * both would be meaningless run directly on raw lon/lat degrees.
 */
export function applyWalkedEdgeCorrection(
  boundary: FieldBoundary,
  edgeId: string,
  walkedPoints: LatLng[],
  accuracyM: number,
  projection: LocalProjection,
): FieldBoundary {
  const target = boundary.edges.find((e) => e.id === edgeId)
  if (!target) throw new DeltaError(`Unknown edge: ${edgeId}`)
  if (walkedPoints.length === 0) throw new DeltaError('A walked correction needs at least one point')

  const walkedLocal = walkedPoints.map((p) => projection.toLocal(p))
  const toleranceM = Math.max(MIN_SIMPLIFY_TOLERANCE_M, accuracyM * SIMPLIFY_TOLERANCE_ACCURACY_MULTIPLIER)
  const simplifiedLocal = simplifyPolyline(walkedLocal, toleranceM)

  const insertAfter = target.fromIndex
  const numInserted = simplifiedLocal.length
  const mapIndex = (oldIndex: number) => (oldIndex <= insertAfter ? oldIndex : oldIndex + numInserted)

  const verticesLocal: LocalPoint[] = [
    ...boundary.vertices.slice(0, insertAfter + 1).map((v) => projection.toLocal(v)),
    ...simplifiedLocal,
    ...boundary.vertices.slice(insertAfter + 1).map((v) => projection.toLocal(v)),
  ]

  // Guard against a pathological trace (one that loops back across
  // itself, or across an untouched part of the boundary) producing an
  // invalid, self-intersecting polygon — reject it outright rather than
  // silently handing the planner a shape it can't sensibly sweep.
  if (isSelfIntersecting(verticesLocal)) {
    throw new DeltaError(
      'That walked trace crosses itself (or the rest of the boundary) and would produce an invalid shape — walk a cleaner path and try again.',
    )
  }

  // Second guard, independent of the one above: a trace that wanders far
  // from the edge it's meant to be correcting can be perfectly *simple*
  // (no self-intersection at all — a deep spike into the interior and
  // back out is topologically fine) while still being an implausible
  // correction for one edge. See MAX_DEVIATION_FRACTION_OF_DIAGONAL's
  // comment for why this is checked separately from — and in addition
  // to — self-intersection.
  const edgeALocal = projection.toLocal(boundary.vertices[target.fromIndex])
  const edgeBLocal = projection.toLocal(boundary.vertices[target.toIndex])
  const maxDeviationM = Math.max(
    MIN_MAX_DEVIATION_M,
    boundingDiagonalM(boundary.vertices.map((v) => projection.toLocal(v))) * MAX_DEVIATION_FRACTION_OF_DIAGONAL,
  )
  const strayingPoint = simplifiedLocal.find((p) => distancePointToSegment(p, edgeALocal, edgeBLocal) > maxDeviationM)
  if (strayingPoint) {
    throw new DeltaError(
      `That walked trace strays too far from the edge you're correcting (over ${Math.round(maxDeviationM)}m from it) — it looks like it wandered into the middle of the field rather than following this edge. Walk a path that stays close to the edge being corrected, or cancel and re-select if you meant to redraw more of the boundary.`,
    )
  }

  // Built from the ORIGINAL (untouched) LatLng vertices directly, not by
  // round-tripping the whole ring through local space and back — the
  // AEQD projection isn't bit-for-bit invertible, and verticesLocal
  // above exists only for the two validity checks. Every vertex this
  // correction didn't touch must come back as the exact same value it
  // started as, matching this file's own "untouched means untouched"
  // guarantee (see the header comment) — not just numerically close.
  const vertices: LatLng[] = [
    ...boundary.vertices.slice(0, insertAfter + 1),
    ...simplifiedLocal.map((p) => projection.toLatLng(p)),
    ...boundary.vertices.slice(insertAfter + 1),
  ]

  const verifiedAt = new Date().toISOString()
  const edges: BoundaryEdge[] = []
  let walkedSeq = 0

  for (const edge of boundary.edges) {
    if (edge.id !== edgeId) {
      edges.push({ ...edge, fromIndex: mapIndex(edge.fromIndex), toIndex: mapIndex(edge.toIndex) })
      continue
    }

    // Chain: (mapped fromIndex) -> insertedPoint0 -> ... -> insertedPointN -> (mapped toIndex).
    const chain = [
      mapIndex(edge.fromIndex),
      ...Array.from({ length: numInserted }, (_, i) => insertAfter + 1 + i),
      mapIndex(edge.toIndex),
    ]
    for (let i = 0; i < chain.length - 1; i++) {
      edges.push({
        id: `${edgeId}-walk${walkedSeq++}`,
        fromIndex: chain[i],
        toIndex: chain[i + 1],
        provenance: { kind: 'walked', accuracyM, verifiedAt },
      })
    }
  }

  return { ...boundary, vertices, edges }
}

/**
 * Whether a closed ring, as a polygon, crosses itself anywhere — the
 * splice above can't verify this by construction (a locally-sensible
 * insertion can still cross a distant, untouched part of the boundary),
 * so it's checked explicitly against the finished ring instead. Uses
 * turf's kinks() (already a project dependency) rather than a hand-rolled
 * segment-intersection sweep — self-intersection detection has enough
 * sharp edge cases (shared vertices, collinear overlaps) that a
 * well-tested implementation is worth the dependency.
 */
function isSelfIntersecting(ring: LocalPoint[]): boolean {
  if (ring.length < 4) return false
  const coords: [number, number][] = ring.map((p) => [p.x, p.y])
  coords.push(coords[0])
  return kinks(turfPolygon([coords])).features.length > 0
}

/** The straight-line distance across a set of points' bounding box — the reference scale for MAX_DEVIATION_FRACTION_OF_DIAGONAL above. */
function boundingDiagonalM(points: LocalPoint[]): number {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)
  return Math.hypot(width, height)
}

/**
 * Marks an edge's risk as explicitly accepted without walking it. The
 * edge stays provenance 'satellite' — deliberately distinct from
 * 'walked' — so the readiness gate can keep counting it separately
 * (acceptedRiskEdges): "we looked at it and chose to fly anyway" is
 * never conflated with "we verified it".
 */
export function acceptEdgeRisk(boundary: FieldBoundary, edgeId: string): FieldBoundary {
  const target = boundary.edges.find((e) => e.id === edgeId)
  if (!target) throw new DeltaError(`Unknown edge: ${edgeId}`)
  if (target.provenance.kind !== 'satellite') {
    throw new DeltaError('Only an unverified (satellite) edge can have its risk accepted')
  }

  return {
    ...boundary,
    edges: boundary.edges.map((edge) =>
      edge.id === edgeId ? { ...edge, provenance: { ...edge.provenance, acceptedRisk: true } } : edge,
    ),
  }
}

/** Undoes acceptEdgeRisk — lets the pilot change their mind before the flight clears. */
export function revokeAcceptedRisk(boundary: FieldBoundary, edgeId: string): FieldBoundary {
  const target = boundary.edges.find((e) => e.id === edgeId)
  if (!target) throw new DeltaError(`Unknown edge: ${edgeId}`)

  return {
    ...boundary,
    edges: boundary.edges.map((edge) =>
      edge.id === edgeId ? { ...edge, provenance: { ...edge.provenance, acceptedRisk: false } } : edge,
    ),
  }
}
