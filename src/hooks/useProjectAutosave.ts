import { useEffect, useRef } from 'react'
import { createProjectRecord, touchProjectRecord, type ProjectRecord } from '@/lib/storage/project'
import { getActiveProjectId, getProject, putProject, setActiveProjectId } from '@/lib/storage/projectDb'
import { useFieldStore } from '@/store/useFieldStore'

const AUTOSAVE_DEBOUNCE_MS = 600

/**
 * Resumes the last-open project on load, and transparently autosaves
 * from then on — no "Save" button anywhere, matching how the rest of
 * FieldWise already works (every edit re-plans and re-renders
 * immediately; a project is just "the session," persisted).
 *
 * The one deliberate exception: opening the app and never touching
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
  const activeProjectId = useFieldStore((s) => s.activeProjectId)
  const activeProjectName = useFieldStore((s) => s.activeProjectName)
  const setActiveProject = useFieldStore((s) => s.setActiveProject)
  const loadProjectSnapshot = useFieldStore((s) => s.loadProjectSnapshot)

  const recordRef = useRef<ProjectRecord | null>(null)
  const resumedRef = useRef(false)

  // Resume the remembered active project, once, on mount.
  useEffect(() => {
    const id = getActiveProjectId()
    if (!id) {
      resumedRef.current = true
      return
    }
    getProject(id)
      .then((record) => {
        if (record) {
          recordRef.current = record
          loadProjectSnapshot(record.id, record.name, record.snapshot)
        } else {
          setActiveProjectId(null) // the remembered project was deleted elsewhere — don't keep pointing at nothing
        }
      })
      .catch(() => {
        // IndexedDB unavailable (private browsing, storage disabled) — fall back to an unsaved session rather than block the app.
      })
      .finally(() => {
        resumedRef.current = true
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume-once, deliberately not re-run on every render
  }, [])

  useEffect(() => {
    if (!resumedRef.current) return // don't let the debounced autosave below race the initial resume and overwrite it with a blank session
    const snapshot = { boundary, originalBoundary, noSprayZones, droneProfile, sweepStrategy, spacingOverrideM, headLock, planOffsetLocal }

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
    activeProjectId,
    activeProjectName,
    setActiveProject,
  ])
}
