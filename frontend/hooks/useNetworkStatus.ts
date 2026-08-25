import { useState, useEffect, useRef, useCallback } from 'react'

export interface NetworkStatus {
  isOnline: boolean
  lastChecked: number
  /**
   * Register a callback that fires once each time the browser transitions from
   * offline → online.  Returns an unsubscribe function.
   */
  onReconnect: (cb: () => void) => () => void
}

const OFFLINE_THRESHOLD_MS = 3000

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof window === 'undefined') return true
    return navigator.onLine
  })
  const [lastChecked, setLastChecked] = useState(() => Date.now())

  // Set of callbacks to invoke on reconnect
  const reconnectListeners = useRef<Set<() => void>>(new Set())

  // Track previous online state so we can detect the offline → online edge
  const wasOnlineRef = useRef(isOnline)

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null

    const handleOnline = () => {
      const wasOffline = !wasOnlineRef.current
      wasOnlineRef.current = true
      setIsOnline(true)
      setLastChecked(Date.now())

      if (wasOffline) {
        // Fire all registered reconnect listeners
        reconnectListeners.current.forEach((cb) => {
          try {
            cb()
          } catch (err) {
            console.error('[useNetworkStatus] onReconnect listener threw:', err)
          }
        })
      }
    }

    const handleOffline = () => {
      timeoutId = setTimeout(() => {
        wasOnlineRef.current = false
        setIsOnline(false)
        setLastChecked(Date.now())
      }, OFFLINE_THRESHOLD_MS)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  /**
   * Subscribe to reconnect events.
   * Returns an unsubscribe function – callers should invoke it on unmount.
   */
  const onReconnect = useCallback((cb: () => void) => {
    reconnectListeners.current.add(cb)
    return () => {
      reconnectListeners.current.delete(cb)
    }
  }, [])

  return { isOnline, lastChecked, onReconnect }
}
