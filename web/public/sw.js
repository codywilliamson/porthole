// app-shell service worker: instant launch from home screen.
// hashed assets are immutable -> cache-first. navigations serve the cached
// shell immediately and revalidate in the background (old shell + old cached
// assets stay coherent across deploys). /api is never touched (sse + live data).
// background cache writes ride event.waitUntil — ios kills idle workers fast,
// so without it the silent refresh never lands and deploys don't propagate.
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
    event.respondWith(cacheFirst(event, req))
  } else {
    event.respondWith(staleWhileRevalidate(event, req))
  }
})

async function cacheFirst(event, req) {
  const cached = await caches.match(req)
  if (cached) return cached
  const res = await fetch(req)
  if (res.ok) {
    const cache = await caches.open(CACHE)
    event.waitUntil(cache.put(req, res.clone()))
  }
  return res
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(req)
  const refresh = fetch(req)
    .then(async (res) => {
      if (res.ok) {
        await cache.put(req, res.clone())
        // fresh shell landed -> drop hashed assets it no longer references,
        // otherwise the single cache grows unbounded across deploys
        if (req.mode === 'navigate') await pruneStaleAssets(cache, res.clone())
      }
      return res
    })
    .catch(() => cached)
  event.waitUntil(refresh)
  return cached ?? refresh
}

async function pruneStaleAssets(cache, res) {
  const html = await res.text()
  const referenced = new Set(html.match(/\/assets\/[\w.-]+/g) ?? [])
  const keys = await cache.keys()
  const stale = keys.filter((k) => {
    const path = new URL(k.url).pathname
    return path.startsWith('/assets/') && !referenced.has(path)
  })
  await Promise.all(stale.map((k) => cache.delete(k)))
}
