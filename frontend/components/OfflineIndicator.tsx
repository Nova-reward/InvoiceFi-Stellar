'use client'

import { useEffect, useState } from 'react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'

export function OfflineIndicator() {
  const { isOnline, lastChecked } = useNetworkStatus()
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    if (!isOnline) {
      setShowBanner(true)
    } else {
      const timer = setTimeout(() => setShowBanner(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [isOnline])

  if (!showBanner) return null

  return (
    <div
      className="offline-banner"
      role="status"
      aria-live="polite"
      aria-label={isOnline ? 'Connection restored' : 'No internet connection'}
    >
      <div className="offline-banner-content">
        <span className="offline-icon">⚠️</span>
        <span className="offline-text">
          {isOnline ? '✓ Back online - syncing data...' : '⚠️ You are offline - some features may be limited'}
        </span>
      </div>
    </div>
  )
}
