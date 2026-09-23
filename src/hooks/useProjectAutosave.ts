import { useEffect, useRef } from 'react'
import { createProjectRecord, touchProjectRecord, type ProjectRecord } from '@/lib/storage/project'
import { putProject, setActiveProjectId } from '@/lib/storage/projectDb'
import { useFieldStore } from '@/store/useFieldStore'

const AUTOSAVE_DEBOUNCE_MS = 600

/**
 * Transparently autosaves the current session — no "Save" button
 * anywhere, matching how the rest of FieldWise already works (every edit
 * re-plans and re-renders immediately; a project is just "the session,"
 * persisted).
 *
 * Deliberately does *not* resume the last-open project on launch — every
 * fresh app start begins from a blank "Untitled Project," even if a
 * previous session left one active. Reopening a specific saved project
 * is the Projects panel's job (`ProjectsPanel.tsx`'s `openProject`),
 * which explicitly loads a snapshot and sets it active; this hook only
 * ever autosaves whatever the *current* session becomes, it never reaches
 * backward into IndexedDB to decide what that session should start as.
 *
 * The one other deliberate exception: opening the app and never touching
 * anything creates nothing. A project is only lazily created (named
 * "Untitled Project") on the pilot's first real action that produces a
 * boundary — otherwise every idle visit would leave behind an empty
 * project record. Explicitly creating a named project via the Projects
 * panel's "+ New Project" bypasses this entirely (that record already
 * exists by the time this hook's autosave effect runs).
 */
export function useProjectAutosave() {
  const boundary = useFieldStore((s) => s.boundary)
  const originalBoundary = useFieldStore((s) => s.originalBoundary)
  const noSprayZones = useFieldStore((s) => s.noSprayZones)
  const droneProfile = useFieldStore((s) => s.droneProfile)
  const sweepStrategy = useFieldStore((s) => s.sweepStrategy)
  const spacingOverrideM = useFieldStore((s) => s.spacingOverrideM)
  const headLock = useFieldStore((s) => s.headLock)
  const planOffsetLocal = useFieldStore((s) => s.planOffsetLocal)
  const planSplitPercent = useFieldStore((s) => s.planSplitPercent)
  const planSplitDirection = useFieldStore((s) => s.planSplitDirection)
  const activeProjectId = useFieldStore((s) => s.activeProjectId)
  const activeProjectName = useFieldStore((s) => s.activeProjectName)
  const setActiveProject = useFieldStore((s) => s.setActiveProject)

  const recordRef = useRef<ProjectRecord | null>(null)

  useEffect(() => {
    const snapshot = {
      boundary,
      originalBoundary,
      noSprayZones,
      droneProfile,
      sweepStrategy,
      spacingOverrideM,
      headLock,
      planOffsetLocal,
      planSplitPercent,
      planSplitDirection,
    }

    const timer = window.setTimeout(() => {
      if (!activeProjectId) {
        if (!boundary) return // nothing worth persisting yet
        const created = createProjectRecord(snapshot, activeProjectName)
        recordRef.current = created
        putProject(created).then(() => {
          setActiveProjectId(created.id)
          setActiveProject(created.id, created.name)
        })
        return
      }

      // `activeProjectName` (from the store) is the source of truth for
      // the name, not recordRef — a rename made through the Projects
      // panel updates the store but doesn't reach back into this ref, so
      // trusting a stale ref name here would silently revert a rename on
      // the next autosave tick.
      const now = new Date().toISOString()
      const base: ProjectRecord = recordRef.current
        ? { ...recordRef.current, name: activeProjectName }
        : { id: activeProjectId, name: activeProjectName, createdAt: now, updatedAt: now, snapshot }
      const touched = touchProjectRecord(base, snapshot)
      recordRef.current = touched
      putProject(touched)
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [
    boundary,
    originalBoundary,
    noSprayZones,
    droneProfile,
    sweepStrategy,
    spacingOverrideM,
    headLock,
    planOffsetLocal,
    planSplitPercent,
    planSplitDirection,
    activeProjectId,
    activeProjectName,
    setActiveProject,
  ])
}
