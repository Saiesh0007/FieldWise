import { useEffect, useRef } from 'react'
import { createProjectRecord, touchProjectRecord, uniqueProjectName, type ProjectRecord } from '@/lib/storage/project'
import { listProjects, putProject, setActiveProjectId } from '@/lib/storage/projectDb'
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
        // Every fresh launch starts with activeProjectName at its default
        // (ADR-020 — no boot-time resume), so without this check every
        // session that does the "just start clicking" demo flow would
        // lazily create another project sharing that exact same default
        // name. Disambiguate against whatever's already saved before
        // creating, the same way a file manager avoids two files named
        // identically in one folder.
        listProjects().then((existing) => {
          const name = uniqueProjectName(activeProjectName, existing.map((r) => r.name))
          const created = createProjectRecord(snapshot, name)
          recordRef.current = created
          return putProject(created).then(() => {
            setActiveProjectId(created.id)
            setActiveProject(created.id, created.name)
          })
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
