import type { StateStorage } from 'zustand/middleware'

/**
 * IndexedDB-backed `StateStorage` for Zustand `persist`. Replaces localStorage as the home of the
 * main app-state blob (`daily-rep-v1`) so workout history can grow well past localStorage's ~5MB
 * per-origin cap.
 *
 * IndexedDB is **async**, so the store rehydrates a tick after creation rather than synchronously —
 * consumers MUST gate on hydration (AppShell waits on `_hasHydrated`; `sync.ts` waits on
 * `onFinishHydration` before its first reconcile, so it can't push pre-hydration default state over
 * cloud data).
 *
 * Degrades gracefully so persistence never hard-fails: IndexedDB → localStorage → in-memory. And when
 * IndexedDB is present but empty, it seeds the first read from any pre-existing localStorage blob, so
 * data written before this migration is adopted on next load (then written through to IndexedDB).
 */

const DB_NAME = 'daily-rep'
const STORE_NAME = 'kv'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const request = run(tx.objectStore(STORE_NAME))
        tx.oncomplete = () => resolve(request.result)
        tx.onabort = tx.onerror = () => reject(tx.error)
      }),
  )
}

// Last-resort in-memory store so a session keeps working even if both IndexedDB and localStorage throw.
const memory = new Map<string, string>()

function lsGet(name: string): string | null {
  try {
    return localStorage.getItem(name)
  } catch {
    return memory.get(name) ?? null
  }
}
function lsSet(name: string, value: string): void {
  try {
    localStorage.setItem(name, value)
  } catch {
    memory.set(name, value)
  }
}
function lsDel(name: string): void {
  try {
    localStorage.removeItem(name)
  } catch {
    memory.delete(name)
  }
}

export const idbStorage: StateStorage = {
  async getItem(name) {
    if (!hasIDB()) return lsGet(name)
    try {
      const v = await withStore<string | undefined>('readonly', (s) => s.get(name))
      // IndexedDB has it → use it; otherwise adopt any pre-existing localStorage blob (one-time seed).
      return v ?? lsGet(name)
    } catch {
      return lsGet(name)
    }
  },
  async setItem(name, value) {
    if (!hasIDB()) return lsSet(name, value)
    try {
      await withStore('readwrite', (s) => s.put(value, name))
    } catch {
      lsSet(name, value)
    }
  },
  async removeItem(name) {
    if (!hasIDB()) return lsDel(name)
    try {
      await withStore('readwrite', (s) => s.delete(name))
    } catch {
      lsDel(name)
    }
  },
}
