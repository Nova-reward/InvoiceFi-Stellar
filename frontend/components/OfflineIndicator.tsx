'use client'

import { useEffect, useState } from 'react'

interface OfflineIndicatorProps {
  isConnected: boolean;
}

export function OfflineIndicator({ isConnected }: OfflineIndicatorProps) {
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    if (!isConnected) {
      setShowBanner(true)
    } else {
      // Keep banner showing briefly to confirm reconnection
      const timer = setTimeout(() => setShowBanner(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [isConnected])

  if (!showBanner) return null

  return (
    <div
      className={`offline-banner ${isConnected ? 'bg-green-500' : 'bg-red-500'} text-white p-2 text-center transition-all`}
      role="status"
      aria-live="polite"
      aria-label={isConnected ? 'Connection restored' : 'No connection to server'}
    >
      <div className="offline-banner-content flex justify-center items-center gap-2">
        <span className="offline-icon">{isConnected ? '✓' : '⚠️'}</span>
        <span className="offline-text">
          {isConnected
            ? 'Back online - live updates active.'
            : 'Socket disconnected - attempting to reconnect (live updates paused).'}
        </span>
      </div>
    </div>
  )
}