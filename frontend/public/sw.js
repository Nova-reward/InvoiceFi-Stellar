const CACHE_NAME = 'invoicefi-v1'
const STATIC_ASSETS = [
  '/',
  '/dashboard/investor/pool',
]
const API_CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        console.log('Some static assets could not be cached')
      })
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Skip non-GET requests and non-HTTP URLs
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return
  }

  // API requests: network first, fallback to cache
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response
          }

          const responseToCache = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache)
          })

          return response
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            return (
              cachedResponse ||
              new Response('Offline - no cached response available', {
                status: 503,
              })
            )
          })
        })
    )
  } else {
    // Static assets: cache first, fallback to network
    event.respondWith(
      caches.match(request).then((response) => {
        return response || fetch(request)
      })
    )
  }
})
