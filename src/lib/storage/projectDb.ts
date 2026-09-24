/**
 * IndexedDB persistence for ProjectRecord — chosen over localStorage
 * because a project's snapshot (boundary vertices, no-spray zones) can
 * comfortably exceed localStorage's ~5MB synchronous-only budget for a
 * large or complex field, and this project's own architecture rule is
 * zero-cloud/offline-first (docs/Rules.md Rule 1) — everything has to
 * live in the browser. This is browser-API glue, not pure logic (see
 * project.ts for the testable record-shape functions this wraps),
 * verified with a real browser pass rather than unit-tested, consistent
 * with this project's convention for IndexedDB/Cache-API/fetch glue
 * (e.g. resilientSatelliteTiles.ts, download.ts).
 */
import type { ProjectRecord } from './project'

const DB_NAME = 'fieldwise-projects'
const DB_VERSION = 1
const STORE_NAME = 'projects'
/** Just the active project's id — kept in localStorage (sync, trivial size) so app boot can decide what to load before the first async IndexedDB round-trip resolves. */
const ACTIVE_PROJECT_ID_KEY = 'fieldwise.activeProjectId'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open the projects database.'))
  })
  return dbPromise
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const request = fn(tx.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Project storage request failed.'))
  })
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return withStore('readonly', (store) => store.getAll())
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const result = await withStore<ProjectRecord | undefined>('readonly', (store) => store.get(id))
  return result ?? null
}

export async function putProject(record: ProjectRecord): Promise<void> {
  await withStore('readwrite', (store) => store.put(record))
}

export async function deleteProject(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id))
}

export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_ID_KEY)
  } catch {
    return null // private browsing / storage disabled — fall back to "no remembered project" rather than throw
  }
}

export function setActiveProjectId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_PROJECT_ID_KEY, id)
    else localStorage.removeItem(ACTIVE_PROJECT_ID_KEY)
  } catch {
    // ignore — losing the "remembered active project" convenience is fine, it just means the next load starts fresh
  }
}
