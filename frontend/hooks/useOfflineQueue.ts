/**
 * useOfflineQueue
 *
 * Persists pending mutations to IndexedDB so they survive a browser refresh
 * while the device is offline, then replays them in FIFO order once the
 * network is restored.
 *
 * DB layout:
 *   database : invoicefi-offline-queue   (version 1)
 *   store    : mutations
 *     keyPath  : id  (auto-generated UUID)
 *     indexes  : status, createdAt
 */

import { useCallback, useEffect, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueItemStatus = 'queued' | 'replaying' | 'succeeded' | 'failed' | 'conflict'

export interface QueuedMutation<T = unknown> {
  /** Unique stable identifier – created once and never mutated. */
  id: string
  /** Descriptive label used in error messages / UI (e.g. "fund invoice abc"). */
  label: string
  /** The serialisable payload the mutation needs to replay. */
  payload: T
  /** ISO-8601 timestamp of when the mutation was queued. */
  createdAt: string
  /** Current processing state. */
  status: QueueItemStatus
  /** Number of replay attempts made so far. */
  attempts: number
  /** ISO-8601 timestamp of the last attempt (undefined if never attempted). */
  lastAttemptAt?: string
  /** Human-readable error from the last failed attempt. */
  lastError?: string
}

export interface OfflineQueueOptions {
  /** Max consecutive replay attempts before marking an item as failed. Default 3. */
  maxAttempts?: number
  /**
   * Called for each queued item during replay.
   * Must throw on failure; must throw an error whose `message` starts with
   * "CONFLICT:" to signal a conflict (the remainder of the message is the
   * server-side value serialised as JSON).
   */
  onReplay: <T>(item: QueuedMutation<T>) => Promise<void>
  /** Called when a replay attempt succeeds. */
  onReplaySuccess?: <T>(item: QueuedMutation<T>) => void
  /** Called when a replay attempt fails with a non-conflict error. */
  onReplayError?: <T>(item: QueuedMutation<T>, error: Error) => void
  /**
   * Called when the server signals a conflict.
   * Receives the queued (local) value and the server value so the caller can
   * show the ConflictResolution modal.
   */
  onConflict?: <T>(item: QueuedMutation<T>, serverData: T) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME = 'invoicefi-offline-queue'
const DB_VERSION = 1
const STORE_NAME = 'mutations'

// ─── Low-level IndexedDB helpers ─────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function dbTransaction<R>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<R>
): Promise<R> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ─── Public helpers (usable outside the hook) ─────────────────────────────────

/** Add a new mutation to the IndexedDB queue. Returns the persisted item. */
export async function enqueueMutation<T>(
  label: string,
  payload: T
): Promise<QueuedMutation<T>> {
  const item: QueuedMutation<T> = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    label,
    payload,
    createdAt: new Date().toISOString(),
    status: 'queued',
    attempts: 0,
  }

  const db = await openDB()
  await dbTransaction(db, 'readwrite', (store) => store.add(item))
  db.close()
  return item
}

/** Retrieve all items currently in the queue, sorted oldest-first. */
export async function getAllQueuedItems<T = unknown>(): Promise<QueuedMutation<T>[]> {
  const db = await openDB()
  const items = await dbTransaction<QueuedMutation<T>[]>(
    db,
    'readonly',
    (store) => store.getAll()
  )
  db.close()
  // Ensure FIFO order regardless of IDB insertion order
  return items.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
}

/** Update an existing queue item in-place. */
export async function updateQueueItem<T>(
  item: QueuedMutation<T>
): Promise<void> {
  const db = await openDB()
  await dbTransaction(db, 'readwrite', (store) => store.put(item))
  db.close()
}

/** Permanently remove an item from the queue. */
export async function removeQueueItem(id: string): Promise<void> {
  const db = await openDB()
  await dbTransaction(db, 'readwrite', (store) => store.delete(id))
  db.close()
}

/** Mark a queue item as having a specific status and persist. */
export async function setQueueItemStatus(
  id: string,
  status: QueueItemStatus,
  extra?: Partial<QueuedMutation>
): Promise<void> {
  const db = await openDB()
  const item = await dbTransaction<QueuedMutation>(
    db,
    'readwrite',
    (store) => store.get(id)
  )
  if (!item) {
    db.close()
    return
  }
  const updated: QueuedMutation = { ...item, ...extra, status }
  await dbTransaction(db, 'readwrite', (store) => store.put(updated))
  db.close()
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useOfflineQueue
 *
 * Call `replayQueue()` whenever the network comes back online.
 * The hook serialises replay (one item at a time, FIFO) and delegates success /
 * conflict / failure notifications to the provided callbacks.
 */
export function useOfflineQueue(options: OfflineQueueOptions) {
  const { maxAttempts = 3, onReplay, onReplaySuccess, onReplayError, onConflict } = options

  // Guard against concurrent replay runs (e.g. rapid online/offline flaps).
  const replayingRef = useRef(false)

  const replayQueue = useCallback(async () => {
    if (replayingRef.current) return
    replayingRef.current = true

    try {
      const items = await getAllQueuedItems()
      const pending = items.filter(
        (item) => item.status === 'queued' || item.status === 'failed'
      )

      for (const item of pending) {
        // Skip items that already hit the attempt ceiling
        if (item.attempts >= maxAttempts) {
          continue
        }

        // Mark as replaying
        const replaying: QueuedMutation = {
          ...item,
          status: 'replaying',
          attempts: item.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
        }
        await updateQueueItem(replaying)

        try {
          await onReplay(replaying)

          // Success – remove from queue
          await removeQueueItem(replaying.id)
          onReplaySuccess?.(replaying)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))

          if (error.message.startsWith('CONFLICT:')) {
            // Extract the server value from the error message
            const serverJson = error.message.slice('CONFLICT:'.length)
            let serverData: unknown
            try {
              serverData = JSON.parse(serverJson)
            } catch {
              serverData = serverJson
            }

            const conflicted: QueuedMutation = {
              ...replaying,
              status: 'conflict',
              lastError: error.message,
            }
            await updateQueueItem(conflicted)
            onConflict?.(conflicted, serverData)
          } else {
            const failed: QueuedMutation = {
              ...replaying,
              status: replaying.attempts >= maxAttempts ? 'failed' : 'queued',
              lastError: error.message,
            }
            await updateQueueItem(failed)
            onReplayError?.(failed, error)
          }
        }
      }
    } finally {
      replayingRef.current = false
    }
  }, [maxAttempts, onReplay, onReplaySuccess, onReplayError, onConflict])

  /**
   * Resolve a conflicted item.
   * - 'local'  → keep the queued payload and retry once more
   * - 'server' → discard the queued item entirely
   * - 'merge'  → replace the queued payload with mergedPayload and retry
   */
  const resolveConflict = useCallback(
    async <T>(
      itemId: string,
      resolution: 'local' | 'server' | 'merge',
      mergedPayload?: T
    ) => {
      if (resolution === 'server') {
        await removeQueueItem(itemId)
        return
      }

      const db = await openDB()
      const item = await dbTransaction<QueuedMutation<T>>(
        db,
        'readwrite',
        (store) => store.get(itemId)
      )
      db.close()

      if (!item) return

      const updated: QueuedMutation<T> = {
        ...item,
        status: 'queued',
        attempts: 0, // reset so it gets retried
        payload: resolution === 'merge' && mergedPayload !== undefined
          ? mergedPayload
          : item.payload,
        lastError: undefined,
      }
      await updateQueueItem(updated)
    },
    []
  )

  return { replayQueue, resolveConflict, enqueueMutation, getAllQueuedItems }
}
