import { create } from 'zustand'
import { acceptEdgeRisk, applyWalkedEdgeCorrection, revokeAcceptedRisk } from '@/lib/geo/delta'
import { DEFAULT_DRONE_PROFILE } from '@/lib/geo/defaults'
import { planSprayPath } from '@/lib/geo/planner'
import {
  approximateCentroidLatLng,
  createLocalProjection,
  projectAll,
  type LocalProjection,
} from '@/lib/geo/projection'
import { computeReadiness } from '@/lib/geo/readiness'
import { loadSampleField } from '@/lib/geo/sampleField'
import type {
  DroneProfile,
  FieldBoundary,
  LatLng,
  NoSprayZone,
  ReadinessSummary,
  SprayPlan,
  SweepStrategy,
} from '@/lib/geo/types'
import { DEFAULT_PROJECT_NAME, type ProjectSnapshot } from '@/lib/storage/project'

/** The six-step pilot workflow, matches the header stepper 1:1. */
export const WORKFLOW_STEPS = ['import', 'verify', 'plan', 'simulate', 'export', 'send'] as const
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number]

export const STEP_LABELS: Record<WorkflowStep, string> = {
  import: 'Import',
  verify: 'Verify',
  plan: 'Plan',
  simulate: 'Simulate',
  export: 'Export',
  send: 'Send to Vehicle',
}

interface FieldState {
  currentStep: WorkflowStep

  boundary: FieldBoundary | null
  /**
   * A snapshot of `boundary` taken the moment it was first created/loaded
   * (Import, "Load sample field", or opening a saved project) — before
   * any walk/trim/accept-risk correction touches it. Kept alongside the
   * live boundary for the session's lifetime so Simulate's Blind vs.
   * Sighted replay has an honest "before" to compare the pilot's actual
   * corrections against, instead of a scripted stand-in. Never mutated
   * or reassigned by a correction action — see lib/geo/delta.ts, which
   * always returns a new boundary object rather than editing one in
   * place, so this reference stays exactly what it was at import time.
   */
  originalBoundary: FieldBoundary | null
  noSprayZones: NoSprayZone[]
  droneProfile: DroneProfile
  sweepStrategy: SweepStrategy

  /** The boundary's local metric projection — recomputed (centered on the new centroid) whenever the boundary changes. */
  projection: LocalProjection | null
  /** Recomputed by the planner whenever boundary/zones/profile/strategy change. */
  sprayPlan: SprayPlan | null
  /** Set instead of sprayPlan when the planner throws (e.g. a drone profile field edited down to 0) — keeps a bad live edit from crashing the app. */
  planError: string | null
  /** Recomputed by the readiness engine whenever boundary edge provenance changes. */
  readiness: ReadinessSummary | null

  /** The edge currently selected on the map/Verify list — this is what the correction actions below act on. */
  selectedEdgeId: string | null

  /**
   * Which saved project (see lib/storage/project.ts) this session is —
   * null until the pilot's first field-producing action lazily creates
   * one (see App.tsx's autosave effect), so opening the app and just
   * looking around never writes an empty "Untitled Project" to disk.
   */
  activeProjectId: string | null
  activeProjectName: string

  /**
   * How long the last recompute() took, in milliseconds. Displayed live
   * in the header so "the plan re-plans in ~1s after a correction" is a
   * number judges can watch, not a claim to take on faith.
   */
  lastRecomputeMs: number | null

  setStep: (step: WorkflowStep) => void
  setBoundary: (boundary: FieldBoundary | null) => void
  addNoSprayZone: (zone: NoSprayZone) => void
  removeNoSprayZone: (id: string) => void
  /** Edit Obstacle (AeroGCS Green §12.3) — replaces one zone's geometry (a dragged polygon vertex, a resized circle, or a deleted vertex) by id. Never touches any other zone. */
  updateNoSprayZone: (id: string, update: Partial<Pick<NoSprayZone, 'vertices' | 'center' | 'radiusM'>>) => void
  setDroneProfile: (profile: DroneProfile) => void
  setSweepStrategy: (strategy: SweepStrategy) => void
  setSelectedEdgeId: (edgeId: string | null) => void
  /** "Walk a strip" / "Trim an edge" — both are this one delta merge, see lib/geo/delta.ts for why. */
  walkEdge: (edgeId: string, walkedPoints: LatLng[], accuracyM: number) => void
  acceptRisk: (edgeId: string) => void
  revokeRisk: (edgeId: string) => void
  loadSample: () => void
  reset: () => void

  /** Sets which project this session is, without touching any session data — used when a project is first lazily created or explicitly renamed. */
  setActiveProject: (id: string | null, name: string) => void
  /** Atomically replaces the whole session with a saved project's snapshot — the "Open project" action. */
  loadProjectSnapshot: (id: string, name: string, snapshot: ProjectSnapshot) => void
}

interface DerivedFields {
  projection: LocalProjection | null
  sprayPlan: SprayPlan | null
  planError: string | null
  readiness: ReadinessSummary | null
  lastRecomputeMs: number
}

/**
 * Recomputes projection/plan/readiness from scratch. This is the one
 * place those three derived values are produced — every mutating action
 * below funnels through it so the map, the readiness badge, and the plan
 * stats are always in sync with each other within a single render, never
 * showing a stale plan next to a fresh boundary for one frame.
 *
 * Pure geometry-core functions do the real work (lib/geo/planner.ts,
 * readiness.ts); this is just wiring, which is what keeps the ~1s
 * re-plan-on-correction path traceable — and it times itself, since
 * "instant re-plan" is a specific claim made to judges, not an assumption.
 */
function recompute(input: {
  boundary: FieldBoundary | null
  noSprayZones: NoSprayZone[]
  droneProfile: DroneProfile
  sweepStrategy: SweepStrategy
}): DerivedFields {
  const t0 = performance.now()
  const { boundary, noSprayZones, droneProfile, sweepStrategy } = input

  if (!boundary) {
    return { projection: null, sprayPlan: null, planError: null, readiness: null, lastRecomputeMs: performance.now() - t0 }
  }

  const origin = approximateCentroidLatLng(boundary.vertices)
  const projection = createLocalProjection(origin)
  const boundaryLocal = projectAll(projection, boundary.vertices)
  const noSprayZonesLocal = noSprayZones.map((zone) => projectAll(projection, zone.vertices))

  const readiness = computeReadiness(boundary, boundaryLocal)

  // A live-editable drone profile (the Plan panel's NumberFields) can
  // transiently hold an invalid value (e.g. a field cleared mid-edit) —
  // planSprayPath validates and throws rather than silently misbehaving,
  // so this must not be allowed to crash the whole store. Readiness
  // above is computed either way, since it doesn't depend on the profile.
  let sprayPlan: SprayPlan | null = null
  let planError: string | null = null
  try {
    sprayPlan = planSprayPath({ boundaryLocal, noSprayZonesLocal, droneProfile, sweepStrategy })
  } catch (err) {
    planError = err instanceof Error ? err.message : 'Failed to plan the spray path.'
  }

  const lastRecomputeMs = performance.now() - t0
  console.log(`[FieldWise] Re-planned in ${lastRecomputeMs.toFixed(1)}ms`)

  return { projection, sprayPlan, planError, readiness, lastRecomputeMs }
}

const initialState = {
  currentStep: 'import' as WorkflowStep,
  boundary: null as FieldBoundary | null,
  originalBoundary: null as FieldBoundary | null,
  noSprayZones: [] as NoSprayZone[],
  droneProfile: DEFAULT_DRONE_PROFILE,
  sweepStrategy: { kind: 'min-turns' } as SweepStrategy,
  projection: null as LocalProjection | null,
  sprayPlan: null as SprayPlan | null,
  planError: null as string | null,
  readiness: null as ReadinessSummary | null,
  selectedEdgeId: null as string | null,
  lastRecomputeMs: null as number | null,
  activeProjectId: null as string | null,
  activeProjectName: DEFAULT_PROJECT_NAME,
}

/**
 * Single source of truth for the field/plan session. This is a hackathon
 * MVP with no auth/backend, so state lives client-side only; persistence
 * to IndexedDB (saved fields/missions) hooks in here later without
 * changing the shape consumers see.
 */
export const useFieldStore = create<FieldState>((set) => ({
  ...initialState,

  setStep: (step) => set({ currentStep: step }),

  setBoundary: (boundary) =>
    set((state) => ({
      boundary,
      // A fresh boundary from Import — re-snapshot the Blind baseline to match.
      originalBoundary: boundary,
      selectedEdgeId: null,
      ...recompute({ ...state, boundary }),
    })),

  addNoSprayZone: (zone) =>
    set((state) => {
      const noSprayZones = [...state.noSprayZones, zone]
      return { noSprayZones, ...recompute({ ...state, noSprayZones }) }
    }),

  removeNoSprayZone: (id) =>
    set((state) => {
      const noSprayZones = state.noSprayZones.filter((z) => z.id !== id)
      return { noSprayZones, ...recompute({ ...state, noSprayZones }) }
    }),

  updateNoSprayZone: (id, update) =>
    set((state) => {
      const noSprayZones = state.noSprayZones.map((z) => (z.id === id ? { ...z, ...update } : z))
      return { noSprayZones, ...recompute({ ...state, noSprayZones }) }
    }),

  setDroneProfile: (droneProfile) =>
    set((state) => ({ droneProfile, ...recompute({ ...state, droneProfile }) })),

  setSweepStrategy: (sweepStrategy) =>
    set((state) => ({ sweepStrategy, ...recompute({ ...state, sweepStrategy }) })),

  setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),

  walkEdge: (edgeId, walkedPoints, accuracyM) =>
    set((state) => {
      if (!state.boundary || !state.projection) return state
      // Lets a DeltaError (e.g. a self-crossing trace) propagate up to
      // the caller rather than silently applying nothing — the pilot
      // needs to know the correction was rejected and why.
      const boundary = applyWalkedEdgeCorrection(state.boundary, edgeId, walkedPoints, accuracyM, state.projection)
      return { boundary, selectedEdgeId: null, ...recompute({ ...state, boundary }) }
    }),

  acceptRisk: (edgeId) =>
    set((state) => {
      if (!state.boundary) return state
      const boundary = acceptEdgeRisk(state.boundary, edgeId)
      return { boundary, ...recompute({ ...state, boundary }) }
    }),

  revokeRisk: (edgeId) =>
    set((state) => {
      if (!state.boundary) return state
      const boundary = revokeAcceptedRisk(state.boundary, edgeId)
      return { boundary, ...recompute({ ...state, boundary }) }
    }),

  loadSample: () => {
    const preset = loadSampleField()
    set((state) => ({
      boundary: preset.boundary,
      originalBoundary: preset.boundary,
      noSprayZones: preset.noSprayZones,
      sweepStrategy: preset.sweepStrategy,
      droneProfile: DEFAULT_DRONE_PROFILE,
      selectedEdgeId: null,
      ...recompute({
        boundary: preset.boundary,
        noSprayZones: preset.noSprayZones,
        droneProfile: DEFAULT_DRONE_PROFILE,
        sweepStrategy: preset.sweepStrategy,
      }),
      currentStep: state.currentStep === 'import' ? 'verify' : state.currentStep,
    }))
  },

  setActiveProject: (activeProjectId, activeProjectName) => set({ activeProjectId, activeProjectName }),

  loadProjectSnapshot: (activeProjectId, activeProjectName, snapshot) =>
    set(() => ({
      activeProjectId,
      activeProjectName,
      boundary: snapshot.boundary,
      // Older saved projects (before this field existed) fall back to the
      // live boundary — Blind vs. Sighted will read as "no corrections
      // yet" for them, which is honest: there's no recorded pre-correction
      // state to compare against.
      originalBoundary: snapshot.originalBoundary ?? snapshot.boundary,
      noSprayZones: snapshot.noSprayZones,
      droneProfile: snapshot.droneProfile,
      sweepStrategy: snapshot.sweepStrategy,
      selectedEdgeId: null,
      currentStep: snapshot.boundary ? 'verify' : 'import',
      ...recompute(snapshot),
    })),

  reset: () => set(initialState),
}))

// Exposed for callers (e.g. tests, devtools) that need a one-shot read
// without subscribing to the store.
export function getFieldStoreState() {
  return useFieldStore.getState()
}
