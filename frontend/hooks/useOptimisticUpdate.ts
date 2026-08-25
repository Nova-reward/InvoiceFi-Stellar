import { useState, useCallback, useEffect } from 'react'
import { useNetworkStatus } from './useNetworkStatus'
import {
  useOfflineQueue,
  enqueueMutation as persistMutation,
  type QueuedMutation,
} from './useOfflineQueue'

export type OptimisticState = 'idle' | 'pending' | 'confirmed' | 'error' | 'conflict' | 'queued' | 'replaying'

export interface OptimisticUpdateConfig<T> {
  /**
   * Human-readable label shown in status messages (e.g. "fund invoice abc").
   * Used as the queue item label when the mutation is persisted offline.
   */
  label?: string
  onMutate: (previousData: T) => Promise<T>
  onSuccess?: (data: T) => void
  onError?: (error: Error, previousData: T) => void
  onConflict?: (localData: T, serverData: T) => T
  /**
   * Provide this to enable offline queueing.
   * Called during replay with the original payload so the mutation can be
   * re-attempted against the server.  Should throw normally on failure; throw
   * an Error whose message begins with "CONFLICT:<json>" to signal a conflict.
   */
  onQueuedReplay?: (payload: T) => Promise<T>
}

export interface ReplayStatus {
  /** Items currently visible in the queue (excluding succeeded ones). */
  queuedItems: QueuedMutation<unknown>[]
  /** Whether a replay pass is running right now. */
  isReplaying: boolean
}

export function useOptimisticUpdate<T>(config: OptimisticUpdateConfig<T>) {
  const { isOnline, onReconnect } = useNetworkStatus()

  const [state, setState] = useState<OptimisticState>('idle')
  const [optimisticData, setOptimisticData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [conflictData, setConflictData] = useState<{
    local: T
    server: T
    queueItemId?: string
  } | null>(null)
  const [isReplaying, setIsReplaying] = useState(false)
  const [queuedItems, setQueuedItems] = useState<QueuedMutation<unknown>[]>([])

  // ── Offline queue integration ───────────────────────────────────────────────

  const { replayQueue, resolveConflict: resolveQueueConflict, getAllQueuedItems } =
    useOfflineQueue({
      onReplay: async (item) => {
        if (!config.onQueuedReplay) {
          throw new Error('onQueuedReplay not configured')
        }
        const result = await config.onQueuedReplay(item.payload as T)
        config.onSuccess?.(result)
      },
      onReplaySuccess: async (_item) => {
        // Refresh our local snapshot of the queue
        const items = await getAllQueuedItems()
        setQueuedItems(items)
      },
      onReplayError: async (item, err) => {
        const items = await getAllQueuedItems()
        setQueuedItems(items)
        config.onError?.(err, item.payload as T)
        setState('error')
        setError(err)
      },
      onConflict: async (item, serverData) => {
        const items = await getAllQueuedItems()
        setQueuedItems(items)
        setState('conflict')
        setConflictData({
          local: item.payload as T,
          server: serverData as T,
          queueItemId: item.id,
        })
      },
    })

  // ── Subscribe to reconnect events ──────────────────────────────────────────

  useEffect(() => {
    if (!config.onQueuedReplay) return

    const unsubscribe = onReconnect(async () => {
      setIsReplaying(true)
      setState('replaying')
      try {
        await replayQueue()
      } finally {
        setIsReplaying(false)
        // Only reset to idle if we weren't left in conflict/error
        setState((prev) =>
          prev === 'replaying' ? 'idle' : prev
        )
      }
    })

    return unsubscribe
  }, [onReconnect, replayQueue, config.onQueuedReplay])

  // ── Core mutate ────────────────────────────────────────────────────────────

  const mutate = useCallback(
    async (previousData: T, mutationFn: () => Promise<T>) => {
      // If offline and queue support is configured, persist the mutation
      if (!isOnline && config.onQueuedReplay) {
        const label = config.label ?? 'invoice mutation'
        const queued = await persistMutation(label, previousData)
        setOptimisticData(previousData)
        setState('queued')
        setQueuedItems((prev) => [...prev, queued as QueuedMutation<unknown>])
        return { success: false, queued: true, queueItemId: queued.id }
      }

      setState('pending')
      setOptimisticData(previousData)
      setError(null)
      setConflictData(null)

      try {
        const serverData = await mutationFn()
        setState('confirmed')
        setOptimisticData(null)
        config.onSuccess?.(serverData)
        return { success: true, data: serverData }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setState('error')
        config.onError?.(error, previousData)
        setError(error)
        return { success: false, error }
      }
    },
    [isOnline, config]
  )

  // ── Conflict resolution ─────────────────────────────────────────────────────

  const resolveConflict = useCallback(
    async (resolution: 'local' | 'server' | 'merge', mergedData?: T) => {
      if (!conflictData) return

      // If this conflict came from a replayed queue item, delegate to the queue
      if (conflictData.queueItemId && config.onQueuedReplay) {
        await resolveQueueConflict(
          conflictData.queueItemId,
          resolution,
          resolution === 'merge' ? mergedData : undefined
        )
        setConflictData(null)

        // If the user chose to keep local or merge, replay again immediately
        if (resolution !== 'server') {
          setIsReplaying(true)
          setState('replaying')
          try {
            await replayQueue()
          } finally {
            setIsReplaying(false)
            setState('idle')
          }
        } else {
          setState('idle')
        }
        return
      }

      // Inline (non-queued) conflict resolution
      const finalData =
        resolution === 'local'
          ? conflictData.local
          : resolution === 'server'
            ? conflictData.server
            : mergedData || conflictData.local

      setState('confirmed')
      setConflictData(null)
      config.onSuccess?.(finalData)
    },
    [conflictData, config, resolveQueueConflict, replayQueue]
  )

  const reset = useCallback(() => {
    setState('idle')
    setOptimisticData(null)
    setError(null)
    setConflictData(null)
  }, [])

  return {
    state,
    optimisticData,
    error,
    conflictData,
    isReplaying,
    queuedItems,
    mutate,
    resolveConflict,
    reset,
  }
}
