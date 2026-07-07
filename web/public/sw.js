// app-shell service worker: instant launch from home screen.
// hashed assets are immutable -> cache-first. navigations serve the cached
// shell immediately and revalidate in the background (old shell + old cached
// assets stay coherent across deploys). /api is never touched (sse + live data).
const CACHE = 'porthole-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req))
  } else {
    event.respondWith(staleWhileRevalidate(req))
  }
})

async function cacheFirst(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  const res = await fetch(req)
  if (res.ok) {
    const cache = await caches.open(CACHE)
    cache.put(req, res.clone())
  }
  return res
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(req)
  const refresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => cached)
  return cached ?? refresh
}
