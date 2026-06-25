// Daily Rep service worker — makes the installed PWA / a reopened tab load offline.
// Strategy: cache-first for immutable hashed static assets, network-first for navigations with an
// offline shell fallback. Cross-origin requests (Supabase) are never intercepted.
//
// CACHE is versioned: bump it on any release that changes caching behaviour so `activate` purges the
// stale cache. A new worker does NOT auto-activate — it installs and waits, and the client
// (ServiceWorkerRegister) surfaces a "new version — reload" prompt. Only on the user's tap do we
// SKIP_WAITING + take over, so a deploy never yanks the page mid-action and a returning user is moved
// off a stale shell (whose hashed chunk refs a deploy may have purged → ChunkLoadError) on consent.
const CACHE = 'daily-rep-v2'
const SHELL = ['/']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // leave Supabase / cross-origin alone

  // Immutable build assets + icons → cache-first (hashed filenames, so a new deploy cache-misses → fresh).
  if (
    url.pathname.startsWith('/_next/static') ||
    url.pathname.startsWith('/icon') ||
    url.pathname.startsWith('/apple-touch-icon') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
            return res
          }),
      ),
    )
    return
  }

  // Page navigations → network-first; on failure fall back to the cached app shell so the app opens
  // offline (the client store hydrates from localStorage from there).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit || caches.match(request))),
    )
  }
})
