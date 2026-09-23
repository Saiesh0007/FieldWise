/**
 * The "Projects" system — AeroGCS Green's Dashboard has a Projects/Home
 * view (list, rename, delete, "+" to create) that FieldWise didn't have
 * at all until now; every session used to be the one unnamed field.
 * This is pure record-shape logic (construct/rename/touch/sort a
 * ProjectRecord), kept dependency-free so it's unit-testable without a
 * real IndexedDB — the actual database calls live in projectDb.ts.
 */
import type { DroneProfile, FieldBoundary, LocalPoint, NoSprayZone, SweepStrategy } from '@/lib/geo/types'

/** Exactly the session fields worth persisting — derived state (projection, sprayPlan, readiness, etc.) is cheap to recompute and never stored. */
export interface ProjectSnapshot {
  boundary: FieldBoundary | null
  /** The pre-correction snapshot Simulate's Blind vs. Sighted replay compares against — see useFieldStore's `originalBoundary`. Optional so records saved before this field existed still deserialize. */
  originalBoundary?: FieldBoundary | null
  noSprayZones: NoSprayZone[]
  droneProfile: DroneProfile
  sweepStrategy: SweepStrategy
  /** Manual Plan editing (AeroGCS Green §11) — Adjust Spacing override, Route Adjust's Head Lock, and Move Plan's accumulated offset. All optional so records saved before these fields existed still deserialize (falling back to "no override"). */
  spacingOverrideM?: number | null
  headLock?: boolean
  planOffsetLocal?: LocalPoint
  /** Plan Splitting (§11.8) — what fraction of the route (and from which end) is marked included. Optional, falls back to "100% / from start" (the whole route). */
  planSplitPercent?: number
  planSplitFromEnd?: boolean
}

export interface ProjectRecord {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  snapshot: ProjectSnapshot
}

export const DEFAULT_PROJECT_NAME = 'Untitled Project'

function generateProjectId(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createProjectRecord(snapshot: ProjectSnapshot, name: string = DEFAULT_PROJECT_NAME, now: Date = new Date()): ProjectRecord {
  const iso = now.toISOString()
  return { id: generateProjectId(), name, createdAt: iso, updatedAt: iso, snapshot }
}

/** Updates a record's snapshot (autosave) without touching its id/name/createdAt. */
export function touchProjectRecord(record: ProjectRecord, snapshot: ProjectSnapshot, now: Date = new Date()): ProjectRecord {
  return { ...record, snapshot, updatedAt: now.toISOString() }
}

export function renameProjectRecord(record: ProjectRecord, name: string, now: Date = new Date()): ProjectRecord {
  const trimmed = name.trim()
  return { ...record, name: trimmed.length > 0 ? trimmed : record.name, updatedAt: now.toISOString() }
}

/** Most-recently-updated first — what the Projects panel lists. */
export function sortProjectsByRecency(records: ProjectRecord[]): ProjectRecord[] {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** A one-line summary for a project row — "4.2 ha" if it has a plan-able boundary, otherwise "No field yet". */
export function describeProjectSnapshot(snapshot: ProjectSnapshot): string {
  if (!snapshot.boundary) return 'No field yet'
  const vertexCount = snapshot.boundary.vertices.length
  return `${vertexCount}-vertex boundary`
}
