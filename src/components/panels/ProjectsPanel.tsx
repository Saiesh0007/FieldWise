import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { DEFAULT_DRONE_PROFILE } from '@/lib/geo/defaults'
import {
  createProjectRecord,
  describeProjectSnapshot,
  renameProjectRecord,
  sortProjectsByRecency,
  uniqueProjectName,
  type ProjectRecord,
} from '@/lib/storage/project'
import { deleteProject, getActiveProjectId, listProjects, putProject, setActiveProjectId } from '@/lib/storage/projectDb'
import { useFieldStore } from '@/store/useFieldStore'

interface ProjectsPanelProps {
  open: boolean
  onClose: () => void
}

/**
 * AeroGCS Green's "Projects"/"Home" views, consolidated into one panel —
 * the two overlapped enough in the source spec (both show a project
 * list) that a second, near-duplicate menu item would just be
 * confusing. Lists every saved project (see lib/storage/project.ts for
 * the record shape, projectDb.ts for the IndexedDB it's stored in),
 * with rename/delete/open, and a "+ New Project" flow that names a
 * project up front — this is the one place project creation is
 * explicit; the ordinary "just start clicking" flow (Import panel ->
 * Load sample field, etc.) still lazily creates an "Untitled Project"
 * on the pilot's first real action instead, so the zero-friction demo
 * path never changes (see useProjectAutosave.ts).
 */
export function ProjectsPanel({ open, onClose }: ProjectsPanelProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const activeProjectId = useFieldStore((s) => s.activeProjectId)
  const loadProjectSnapshot = useFieldStore((s) => s.loadProjectSnapshot)
  const setActiveProject = useFieldStore((s) => s.setActiveProject)
  const resetSession = useFieldStore((s) => s.reset)

  const refresh = () => {
    setLoading(true)
    listProjects()
      .then((records) => setProjects(sortProjectsByRecency(records)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) refresh()
  }, [open])

  if (!open) return null

  const openProject = (record: ProjectRecord) => {
    loadProjectSnapshot(record.id, record.name, record.snapshot)
    setActiveProjectId(record.id)
    onClose()
  }

  const createProject = async () => {
    const name = uniqueProjectName(newName.trim() || 'Untitled Project', projects.map((p) => p.name))
    const record = createProjectRecord(
      { boundary: null, noSprayZones: [], droneProfile: DEFAULT_DRONE_PROFILE, sweepStrategy: { kind: 'min-turns' } },
      name,
    )
    await putProject(record)
    resetSession()
    setActiveProject(record.id, record.name)
    setActiveProjectId(record.id)
    setCreating(false)
    setNewName('')
    onClose()
  }

  const submitRename = async (record: ProjectRecord) => {
    const renamed = renameProjectRecord(record, renameValue)
    await putProject(renamed)
    if (getActiveProjectId() === record.id) setActiveProject(record.id, renamed.name)
    setRenamingId(null)
    refresh()
  }

  const confirmDelete = async (id: string) => {
    await deleteProject(id)
    if (getActiveProjectId() === id) {
      setActiveProjectId(null)
      if (activeProjectId === id) resetSession()
    }
    setConfirmDeleteId(null)
    refresh()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-(--radius-card) bg-(--surface-panel) shadow-(--shadow-panel)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--border-subtle) px-4 py-3">
          <h2 className="text-sm font-semibold text-(--text-primary)">Projects</h2>
          <button type="button" onClick={onClose} className="text-(--text-muted) hover:text-(--text-primary)" aria-label="Close">
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="border-b border-(--border-subtle) p-3">
          {creating ? (
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createProject()}
                placeholder="Project name"
                className="flex-1 rounded-(--radius-control) border border-(--border-subtle) bg-(--surface-panel) px-2.5 py-1.5 text-sm transition-colors focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              <Button size="sm" variant="primary" onClick={createProject}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="primary" className="w-full" onClick={() => setCreating(true)}>
              + New Project
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-3 text-center text-xs text-(--text-muted)">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="p-3 text-center text-xs text-(--text-muted)">
              No saved projects yet — start editing a field (or create one above) and it'll appear here automatically.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {projects.map((record) => (
                <li
                  key={record.id}
                  className="rounded-(--radius-control) border border-(--border-subtle) p-2.5"
                  style={record.id === activeProjectId ? { borderColor: 'var(--color-brand-400)' } : undefined}
                >
                  {renamingId === record.id ? (
                    <div className="flex gap-1.5">
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitRename(record)}
                        className="flex-1 rounded-(--radius-control) border border-(--border-subtle) bg-(--surface-panel) px-2 py-1 text-sm"
                      />
                      <Button size="sm" variant="primary" onClick={() => submitRename(record)}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" onClick={() => openProject(record)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-1.5 truncate text-sm font-medium text-(--text-primary)">
                          {record.name}
                          {record.id === activeProjectId && (
                            <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">Active</span>
                          )}
                        </div>
                        <div className="text-xs text-(--text-muted)">
                          {describeProjectSnapshot(record.snapshot)} · {new Date(record.updatedAt).toLocaleString()}
                        </div>
                      </button>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(record.id)
                            setRenameValue(record.name)
                          }}
                          className="rounded px-1.5 py-1 text-xs text-(--text-secondary) hover:bg-(--surface-panel-raised)"
                        >
                          Rename
                        </button>
                        {confirmDeleteId === record.id ? (
                          <button type="button" onClick={() => confirmDelete(record.id)} className="rounded px-1.5 py-1 text-xs font-medium text-danger">
                            Confirm?
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(record.id)}
                            className="rounded px-1.5 py-1 text-xs text-danger hover:bg-danger-bg"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
