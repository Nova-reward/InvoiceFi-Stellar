/**
 * Unit tests for the offline mutation queue (IndexedDB persistence + replay).
 *
 * Acceptance criteria verified:
 *  AC1 – Offline mutations are persisted to IndexedDB and survive a browser
 *         refresh while offline.
 *  AC2 – On reconnect, queued mutations are replayed in FIFO order.
 *  AC3 – Conflict on replay triggers the ConflictResolution modal with the
 *         server's current value vs. the queued value.
 *  AC4 – Replay failures (non-conflict errors) mark the queue item as failed
 *         and notify the user.
 *  AC5 – (covered by AC1–AC4 together) Queue items are removed on success.
 */

// ─── IndexedDB fake ──────────────────────────────────────────────────────────
// jest-environment-jsdom ships with a minimal IDBFactory stub but the full
// transactional surface isn't always available.  We provide a lightweight
// in-memory implementation so tests are deterministic and fast.

type StoreData = Map<string, any>
const idbStores: Map<string, StoreData> = new Map()

function getOrCreateStore(dbName: string, storeName: string): StoreData {
  const key = `${dbName}::${storeName}`
  if (!idbStores.has(key)) idbStores.set(key, new Map())
  return idbStores.get(key)!
}

function makeRequest<T>(result: T): IDBRequest<T> {
  const listeners: { [k: string]: ((e: any) => void)[] } = { success: [], error: [] }
  const req = {
    result,
    error: null,
    onsuccess: null as any,
    onerror: null as any,
    addEventListener(type: string, fn: (e: any) => void) {
      ;(listeners[type] ??= []).push(fn)
    },
    removeEventListener() {},
    dispatchEvent: () => true,
    readyState: 'done',
    source: null,
    transaction: null,
  } as unknown as IDBRequest<T>

  // Fire onsuccess asynchronously (micro-task) so callers can set handlers
  Promise.resolve().then(() => {
    ;(req as any).onsuccess?.({ target: req })
    listeners.success?.forEach((fn) => fn({ target: req }))
  })

  return req
}

function buildFakeIDB() {
  const openRequests: {
    onsuccess?: (e: any) => void
    onerror?: (e: any) => void
    onupgradeneeded?: (e: any) => void
    result?: IDBDatabase
    error: null
  }[] = []

  const fakeIDB = {
    open(dbName: string, _version?: number) {
      const store = getOrCreateStore(dbName, 'mutations')

      const fakeStore = {
        add: (item: any) => {
          store.set(item.id, { ...item })
          return makeRequest(item.id)
        },
        put: (item: any) => {
          store.set(item.id, { ...item })
          return makeRequest(item.id)
        },
        get: (id: string) => makeRequest(store.get(id)),
        delete: (id: string) => {
          store.delete(id)
          return makeRequest(undefined)
        },
        getAll: () => makeRequest(Array.from(store.values())),
        createIndex: () => {},
        index: () => ({ openCursor: () => makeRequest(null) }),
        objectStoreNames: { contains: () => false } as any,
      }

      const fakeDB: Partial<IDBDatabase> = {
        objectStoreNames: { contains: () => false } as any,
        createObjectStore: () => fakeStore as any,
        transaction: (_storeName: any, _mode: any) => ({
          objectStore: () => fakeStore,
          oncomplete: null,
          onerror: null,
          commit: () => {},
          abort: () => {},
        } as any),
        close: () => {},
      }

      const req: any = {
        result: fakeDB,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      }

      openRequests.push(req)

      Promise.resolve().then(() => {
        // Simulate upgradeneeded on first open (store doesn't exist yet)
        req.onupgradeneeded?.({ target: req })
        req.onsuccess?.({ target: req })
      })

      return req
    },
    deleteDatabase: () => makeRequest(undefined),
    cmp: () => 0,
    databases: async () => [],
  }

  return fakeIDB as unknown as IDBFactory
}

// ─── Test setup ──────────────────────────────────────────────────────────────

import {
  enqueueMutation,
  getAllQueuedItems,
  updateQueueItem,
  removeQueueItem,
  useOfflineQueue,
  type QueuedMutation,
} from '../../hooks/useOfflineQueue'
import { renderHook, act, waitFor } from '@testing-library/react'

beforeEach(() => {
  // Reset the in-memory IDB state between tests
  idbStores.clear()
  Object.defineProperty(global, 'indexedDB', {
    value: buildFakeIDB(),
    writable: true,
    configurable: true,
  })
})

// ─── Helper ───────────────────────────────────────────────────────────────────

const makePayload = (id: string) => ({
  invoiceId: id,
  amount: 100,
  action: 'fund' as const,
})

// ─── AC1: Persistence ─────────────────────────────────────────────────────────

describe('AC1 – IndexedDB persistence', () => {
  test('enqueueMutation persists an item with status "queued"', async () => {
    const item = await enqueueMutation('fund invoice A', makePayload('A'))

    expect(item.id).toBeDefined()
    expect(item.status).toBe('queued')
    expect(item.attempts).toBe(0)
    expect(item.label).toBe('fund invoice A')
    expect(item.payload).toEqual(makePayload('A'))
    expect(item.createdAt).toBeDefined()
  })

  test('getAllQueuedItems returns all persisted items', async () => {
    await enqueueMutation('fund invoice A', makePayload('A'))
    await enqueueMutation('fund invoice B', makePayload('B'))

    const items = await getAllQueuedItems()
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.label)).toContain('fund invoice A')
    expect(items.map((i) => i.label)).toContain('fund invoice B')
  })

  test('item survives a simulated "refresh" (re-read from IDB)', async () => {
    const original = await enqueueMutation('fund invoice C', makePayload('C'))

    // Simulate: page reloads, reads queue from IDB
    const items = await getAllQueuedItems()
    const found = items.find((i) => i.id === original.id)

    expect(found).toBeDefined()
    expect(found!.status).toBe('queued')
    expect(found!.payload).toEqual(original.payload)
  })

  test('updateQueueItem persists status changes', async () => {
    const item = await enqueueMutation('update invoice D', makePayload('D'))
    await updateQueueItem({ ...item, status: 'replaying', attempts: 1 })

    const items = await getAllQueuedItems()
    const updated = items.find((i) => i.id === item.id)!
    expect(updated.status).toBe('replaying')
    expect(updated.attempts).toBe(1)
  })

  test('removeQueueItem deletes the item from IDB', async () => {
    const item = await enqueueMutation('cancel invoice E', makePayload('E'))
    await removeQueueItem(item.id)

    const items = await getAllQueuedItems()
    expect(items.find((i) => i.id === item.id)).toBeUndefined()
  })
})

// ─── AC2: FIFO replay ─────────────────────────────────────────────────────────

describe('AC2 – FIFO replay order', () => {
  test('replayQueue calls onReplay in createdAt order', async () => {
    // Enqueue three items with a small time gap between them
    const first = await enqueueMutation('mutation 1', makePayload('1'))
    await new Promise((r) => setTimeout(r, 5))
    const second = await enqueueMutation('mutation 2', makePayload('2'))
    await new Promise((r) => setTimeout(r, 5))
    const third = await enqueueMutation('mutation 3', makePayload('3'))

    const replayOrder: string[] = []
    const onReplay = jest.fn(async (item: QueuedMutation) => {
      replayOrder.push(item.id)
    })

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay })
    )

    await act(async () => {
      await result.current.replayQueue()
    })

    expect(replayOrder).toEqual([first.id, second.id, third.id])
  })

  test('successfully replayed items are removed from the queue', async () => {
    await enqueueMutation('mutation A', makePayload('A'))
    await enqueueMutation('mutation B', makePayload('B'))

    const onReplay = jest.fn(async () => { /* success */ })
    const { result } = renderHook(() => useOfflineQueue({ onReplay }))

    await act(async () => {
      await result.current.replayQueue()
    })

    const remaining = await getAllQueuedItems()
    expect(remaining).toHaveLength(0)
  })

  test('onReplaySuccess is called for each replayed item', async () => {
    await enqueueMutation('mutation X', makePayload('X'))

    const onReplay = jest.fn(async () => {})
    const onReplaySuccess = jest.fn()
    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay, onReplaySuccess })
    )

    await act(async () => {
      await result.current.replayQueue()
    })

    expect(onReplaySuccess).toHaveBeenCalledTimes(1)
    expect(onReplaySuccess.mock.calls[0][0].label).toBe('mutation X')
  })
})

// ─── AC3: Conflict handling ───────────────────────────────────────────────────

describe('AC3 – Conflict on replay triggers conflict handler', () => {
  test('onConflict is called with local payload and server data', async () => {
    const localPayload = makePayload('conflict-invoice')
    await enqueueMutation('fund conflict-invoice', localPayload)

    const serverValue = { ...localPayload, amount: 999, serverVersion: true }
    const onReplay = jest.fn(async () => {
      throw new Error(`CONFLICT:${JSON.stringify(serverValue)}`)
    })
    const onConflict = jest.fn()

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay, onConflict })
    )

    await act(async () => {
      await result.current.replayQueue()
    })

    expect(onConflict).toHaveBeenCalledTimes(1)
    const [conflictItem, conflictServer] = onConflict.mock.calls[0]
    expect(conflictItem.status).toBe('conflict')
    expect(conflictItem.payload).toEqual(localPayload)
    expect(conflictServer).toEqual(serverValue)
  })

  test('conflict item is marked "conflict" in the queue', async () => {
    const item = await enqueueMutation('fund conflict-invoice-2', makePayload('ci2'))

    const onReplay = jest.fn(async () => {
      throw new Error('CONFLICT:{"amount":42}')
    })
    const onConflict = jest.fn()

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay, onConflict })
    )

    await act(async () => {
      await result.current.replayQueue()
    })

    const items = await getAllQueuedItems()
    const found = items.find((i) => i.id === item.id)!
    expect(found.status).toBe('conflict')
  })

  test('resolveConflict("server") removes item from queue', async () => {
    const item = await enqueueMutation('conflict item', makePayload('ci3'))
    // Manually mark as conflict
    await updateQueueItem({ ...item, status: 'conflict' })

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay: jest.fn() })
    )

    await act(async () => {
      await result.current.resolveConflict(item.id, 'server')
    })

    const items = await getAllQueuedItems()
    expect(items.find((i) => i.id === item.id)).toBeUndefined()
  })

  test('resolveConflict("local") resets item to queued with 0 attempts', async () => {
    const item = await enqueueMutation('conflict item local', makePayload('ci4'))
    await updateQueueItem({ ...item, status: 'conflict', attempts: 2 })

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay: jest.fn() })
    )

    await act(async () => {
      await result.current.resolveConflict(item.id, 'local')
    })

    const items = await getAllQueuedItems()
    const found = items.find((i) => i.id === item.id)!
    expect(found.status).toBe('queued')
    expect(found.attempts).toBe(0)
  })

  test('resolveConflict("merge") stores merged payload and resets to queued', async () => {
    const item = await enqueueMutation('conflict item merge', makePayload('ci5'))
    await updateQueueItem({ ...item, status: 'conflict' })

    const mergedPayload = { invoiceId: 'ci5', amount: 150, action: 'fund', merged: true }

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay: jest.fn() })
    )

    await act(async () => {
      await result.current.resolveConflict(item.id, 'merge', mergedPayload)
    })

    const items = await getAllQueuedItems()
    const found = items.find((i) => i.id === item.id)!
    expect(found.status).toBe('queued')
    expect(found.payload).toEqual(mergedPayload)
  })
})

// ─── AC4: Non-conflict replay failures ───────────────────────────────────────

describe('AC4 – Non-conflict replay failures', () => {
  test('onReplayError is called with the failed item and error', async () => {
    await enqueueMutation('failing mutation', makePayload('F'))

    const networkError = new Error('Network request failed')
    const onReplay = jest.fn(async () => { throw networkError })
    const onReplayError = jest.fn()

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay, onReplayError })
    )

    await act(async () => {
      await result.current.replayQueue()
    })

    expect(onReplayError).toHaveBeenCalledTimes(1)
    const [failedItem, err] = onReplayError.mock.calls[0]
    expect(failedItem.label).toBe('failing mutation')
    expect(err).toBe(networkError)
  })

  test('item is marked "failed" after maxAttempts retries', async () => {
    const item = await enqueueMutation('keep failing', makePayload('KF'))
    const maxAttempts = 2

    const onReplay = jest.fn(async () => { throw new Error('always fails') })

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay, maxAttempts })
    )

    // First run exhausts attempt 1 → status 'queued' (still has attempts left)
    await act(async () => { await result.current.replayQueue() })

    // Second run exhausts attempt 2 → status 'failed'
    await act(async () => { await result.current.replayQueue() })

    const items = await getAllQueuedItems()
    const found = items.find((i) => i.id === item.id)!
    expect(found.status).toBe('failed')
    expect(found.attempts).toBe(maxAttempts)
  })

  test('failed items with maxAttempts are skipped on subsequent replay runs', async () => {
    const item = await enqueueMutation('exhausted item', makePayload('EX'))
    // Pre-mark as failed with attempts = maxAttempts (default 3)
    await updateQueueItem({ ...item, status: 'failed', attempts: 3 })

    const onReplay = jest.fn()

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay })
    )

    await act(async () => {
      await result.current.replayQueue()
    })

    expect(onReplay).not.toHaveBeenCalled()
  })

  test('lastError is stored on the failed item', async () => {
    const item = await enqueueMutation('error item', makePayload('ERR'))

    const onReplay = jest.fn(async () => { throw new Error('specific error message') })

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay, maxAttempts: 1 })
    )

    await act(async () => { await result.current.replayQueue() })

    const items = await getAllQueuedItems()
    const found = items.find((i) => i.id === item.id)!
    expect(found.lastError).toContain('specific error message')
  })
})

// ─── Concurrency guard ────────────────────────────────────────────────────────

describe('Replay concurrency guard', () => {
  test('concurrent replayQueue calls do not double-process items', async () => {
    await enqueueMutation('concurrent item', makePayload('CC'))

    let resolveFn!: () => void
    const slowReplay = jest.fn(
      () => new Promise<void>((res) => { resolveFn = res })
    )

    const { result } = renderHook(() =>
      useOfflineQueue({ onReplay: slowReplay })
    )

    // Start two concurrent replays
    let p1Done = false
    let p2Done = false
    act(() => {
      result.current.replayQueue().then(() => { p1Done = true })
      result.current.replayQueue().then(() => { p2Done = true })
    })

    // Resolve the slow replay
    resolveFn?.()
    await waitFor(() => p1Done && p2Done)

    // onReplay should only have been called once
    expect(slowReplay).toHaveBeenCalledTimes(1)
  })
})
