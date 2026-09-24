/**
 * Core domain types for FieldWise.
 *
 * These are intentionally the load-bearing types for the whole app — the
 * store, map layers, planner and exporters all read/write these shapes.
 * Algorithms (projection math, the boustrophedon planner, delta merging,
 * simulation) land in sibling files in `lib/geo/` in the next pass; this
 * file only fixes the vocabulary so everything built on top of it doesn't
 * have to change shape later.
 */

/** A geographic point, WGS84 lon/lat — GeoJSON order, degrees. */
export interface LatLng {
  lon: number
  lat: number
}

/**
 * A point in the field's local metric projection (meters), origin at the
 * field's centroid. All planning geometry (sweep lines, buffers, clipping)
 * happens in this space — never in raw lon/lat, where distances are
 * anisotropic and distort with latitude.
 */
export interface LocalPoint {
  x: number
  y: number
}

/**
 * Where a boundary edge's geometry came from, and how much it should be
 * trusted. This is the core of the "twist": the app never treats the
 * satellite trace as ground truth.
 */
export type ProvenanceKind = 'satellite' | 'walked' | 'confirmed'

export interface EdgeProvenance {
  kind: ProvenanceKind
  /** ISO date of the source satellite imagery, when kind === 'satellite'. */
  imageryDate?: string
  /** Estimated GPS accuracy radius in meters, when kind === 'walked'. */
  accuracyM?: number
  /** When this edge's provenance was last updated. */
  verifiedAt?: string
  /** Pilot explicitly accepted the risk instead of verifying (readiness gate override). */
  acceptedRisk?: boolean
}

/** One edge of the boundary polygon, between vertex[i] and vertex[i+1]. */
export interface BoundaryEdge {
  id: string
  fromIndex: number
  toIndex: number
  provenance: EdgeProvenance
}

export type BoundarySource = 'satellite-trace' | 'gps-walk' | 'drone-walk' | 'kml-import' | 'geojson-import'

/** The field boundary: a single closed polygon with per-edge provenance. */
export interface FieldBoundary {
  id: string
  vertices: LatLng[]
  edges: BoundaryEdge[]
  source: BoundarySource
  createdAt: string
  /** Optional one-tap imagery/GPS offset correction applied to every vertex. */
  calibrationOffset?: { dLon: number; dLat: number }
}

/** An exclusion zone (no-spray lane/obstacle) — subtracted from the coverage area. */
export interface NoSprayZone {
  id: string
  label: string
  vertices: LatLng[]
  /**
   * How the zone was drawn. `vertices` is always the authoritative polygon
   * (differencing, planning and export never need to know this) — this is
   * purely so the UI can show "circle, r=12m" and re-derive the original
   * center/radius for a shape that was drawn as a circle.
   */
  shape?: 'polygon' | 'circle'
  /** Present only when shape === 'circle'. */
  center?: LatLng
  radiusM?: number
}

/** Hardware profile for the spraying drone — kept generic, no vendor lock-in. */
export interface DroneProfile {
  id: string
  name: string
  /** Effective spray swath width, meters. */
  swathM: number
  /** Cruise speed during spraying, m/s. */
  speedMps: number
  /** Tank capacity, liters. */
  tankL: number
  /** Application rate, liters per hectare. */
  applicationRateLPerHa: number
  /** Cruise altitude AGL, meters. */
  altitudeM: number
  /** Usable flight time per battery/tank cycle, minutes. */
  enduranceMin: number
  /** Turnaround time added per pass-end turn, seconds. */
  turnPenaltySec: number
}

export type SweepStrategy =
  | { kind: 'min-turns' }
  | { kind: 'fixed-heading'; headingDeg: number }
  | { kind: 'crop-row'; headingDeg: number }

/** A single straight spray pass, in local meters. */
export interface SprayPass {
  start: LocalPoint
  end: LocalPoint
  /** true if the drone sprays while traversing this pass (vs. a transit/turn move). */
  spraying: boolean
}

/** One tank/battery cycle worth of passes, ending at a refill/swap point. */
export interface Sortie {
  index: number
  passes: SprayPass[]
  distanceM: number
  volumeL: number
  estimatedMinutes: number
}

/** The generated spray plan for a field + drone profile + sweep strategy. */
export interface SprayPlan {
  sorties: Sortie[]
  totalDistanceM: number
  totalVolumeL: number
  totalEstimatedMinutes: number
  areaHa: number
  headingDeg: number
}

/** Aggregate verification status the Flight Readiness Gate reads from. */
export interface ReadinessSummary {
  cleared: boolean
  totalEdges: number
  unverifiedEdges: number
  unverifiedLengthM: number
  acceptedRiskEdges: number
  /** IDs of the specific edges blocking clearance — what the map highlights and the gate lists. */
  blockingEdgeIds: string[]
}
