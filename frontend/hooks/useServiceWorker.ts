import { useEffect, useState } from 'react'

export interface ServiceWorkerStatus {
  isRegistered: boolean
  updateAvailable: boolean
}

export function useServiceWorker(): ServiceWorkerStatus {
  const [isRegistered, setIsRegistered] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        })
        setIsRegistered(true)

        // Check for updates periodically
        const checkForUpdates = async () => {
          try {
            await registration.update()
            if (registration.waiting) {
              setUpdateAvailable(true)
            }
          } catch (error) {
            console.log('Failed to check for SW updates:', error)
          }
        }

        // Check on registration and then every minute
        checkForUpdates()
        const interval = setInterval(checkForUpdates, 60000)

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setUpdateAvailable(true)
              }
            })
          }
        })

        return () => clearInterval(interval)
      } catch (error) {
        console.log('Service Worker registration failed:', error)
      }
    }

    registerSW()
  }, [])

  return { isRegistered, updateAvailable }
}
