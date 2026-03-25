/**
 * Service Worker - Metro Transit Mobile PWA
 * 
 * Purpose: Cache-first offline-first strategy for seamless offline operation
 * Strategy: Cache all assets on install, serve from cache when offline, network-first for updates
 * 
 * Offline Support:
 * - All HTML, CSS, JS, and icons cached on installation
 * - Full app functionality available offline (timer continues, state persists)
 * - Network requests update cache when online
 * - Automatic cache cleanup on activation
 * 
 * Activation:
 * 1. Install event: Cache all critical assets
 * 2. Activate event: Clean old cache versions
 * 3. Fetch event: Serve from cache, update from network in background
 * 
 * Asset Categories:
 * - Static: index.html, styles.css, app.js (must cache)
 * - Icons: SVG favicon, apple-touch-icon, manifest icons (must cache)
 * - Manifest: manifest.json (must cache)
 * 
 * Cache Version: 'metro-transit-v1'
 * Update this version to invalidate all user caches (forces re-download)
 */

'use strict';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Cache version (update to invalidate old caches) */
const CACHE_VERSION = 'metro-transit-v1';

/** Cache name with version */
const CACHE_NAME = `${CACHE_VERSION}-assets`;

/** URLs to cache on installation (critical assets for offline operation) */
const URLS_TO_CACHE = [
  '/transit-ticket/',
  '/transit-ticket/index.html',
  '/transit-ticket/styles.css',
  '/transit-ticket/app.js',
  '/transit-ticket/manifest.json',
  '/transit-ticket/icons/icon-192.png',
  '/transit-ticket/icons/icon-512.png',
];

// ============================================================================
// INSTALL EVENT - Cache critical assets
// ============================================================================

/**
 * Install event: Cache all critical assets
 * 
 * Fired when SW is first installed or updated
 * Use skipWaiting() to activate immediately (aggressive caching)
 * 
 * Process:
 * 1. Open cache storage with version name
 * 2. Attempt to cache all critical assets
 * 3. Log success/failure
 * 4. Skip waiting to activate immediately
 */
self.addEventListener('install', event => {
  console.log('[SW] Installing, caching assets...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(URLS_TO_CACHE)
          .then(() => {
            console.log('[SW] Successfully cached all assets');
          })
          .catch(err => {
            // Log failure but don't throw - some assets may be unavailable
            console.warn('[SW] Failed to cache some assets:', err);
            // Cache what we could
            return cache.addAll(
              URLS_TO_CACHE.filter(url => !url.includes('icon'))
            );
          });
      })
      .then(() => {
        // Activate immediately without waiting for old SWs to close
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Install failed:', err);
      })
  );
});

// ============================================================================
// ACTIVATE EVENT - Cleanup old caches
// ============================================================================

/**
 * Activate event: Clean up old cache versions
 * 
 * Fired when SW becomes active (after skipWaiting or old SWs closed)
 * Use clientsClaim() to immediately control all pages
 * 
 * Process:
 * 1. Get list of all cache names
 * 2. Delete caches that don't match current version
 * 3. Claim all clients immediately
 */
self.addEventListener('activate', event => {
  console.log('[SW] Activating, cleaning old caches...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            // Delete if not current version
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Claim all clients immediately (don't wait for page refresh)
        return self.clients.claim();
      })
      .then(() => {
        console.log('[SW] Activation complete');
      })
      .catch(err => {
        console.error('[SW] Activation error:', err);
      })
  );
});

// ============================================================================
// FETCH EVENT - Cache-first strategy with network fallback
// ============================================================================

/**
 * Fetch event: Serve from cache, update from network
 * 
 * Strategy: Cache-first (offline-optimized)
 * 1. Check if request is in cache
 * 2. If cached, serve immediately
 * 3. If not cached, fetch from network and cache response
 * 4. If network fails AND not cached, return offline page or error
 * 
 * Request Types:
 * - HTML: Cache, but also check network for updates
 * - CSS/JS: Cache permanently (versioned files)
 * - Assets (icons, images): Cache permanently
 * - API/external: Network-first, fallback to cache
 * 
 * @param {FetchEvent} event
 */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Only handle GET requests
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }
  
  // Handle different content types
  const isNavigate = request.mode === 'navigate';
  const isImage = request.destination === 'image';
  const isStyle = request.destination === 'style';
  const isScript = request.destination === 'script';
  
  // ========== STRATEGY 1: Cache-first for static assets ==========
  if (isStyle || isScript || isImage) {
    event.respondWith(
      caches.match(request)
        .then(cached => {
          if (cached) {
            return cached;
          }
          
          return fetch(request)
            .then(response => {
              // Cache successful responses
              if (response && response.status === 200 && response.type === 'basic') {
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(request, response.clone());
                });
              }
              return response;
            })
            .catch(err => {
              // Network failed and not cached
              console.warn('[SW] Fetch failed:', request.url, err);
              return null;
            });
        })
    );
    return;
  }
  
  // ========== STRATEGY 2: Network-first with cache fallback for HTML ==========
  if (isNavigate) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache successful responses
          if (response && response.status === 200 && response.type === 'basic') {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, response.clone());
            });
          }
          return response;
        })
        .catch(err => {
          // Network failed, try cache
          console.log('[SW] Network failed, checking cache:', request.url);
          return caches.match(request);
        })
    );
    return;
  }
  
  // ========== STRATEGY 3: Cache-first default ==========
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) {
          return cached;
        }
        
        return fetch(request)
          .then(response => {
            // Cache successful responses
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, response.clone());
              });
            }
            return response;
          })
          .catch(err => {
            console.warn('[SW] Fetch error:', request.url, err);
            return null;
          });
      })
  );
});

// ============================================================================
// MESSAGE HANDLER - Communication with page
// ============================================================================

/**
 * Message event: Handle messages from app.js
 * 
 * Allows page to communicate with SW for cache management, etc.
 * Message types:
 * - 'skipWaiting': Activate new SW immediately
 * - 'clearCache': Clear all cached data (user action)
 * 
 * @param {ExtendableMessageEvent} event
 */
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};
  
  if (type === 'skipWaiting') {
    self.skipWaiting();
  } else if (type === 'clearCache') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Cache cleared');
      event.ports[0].postMessage({ success: true });
    });
  } else if (type === 'getCacheSize') {
    // Estimate cache size (browser API limitations)
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(estimate => {
        event.ports[0].postMessage({
          usage: estimate.usage,
          quota: estimate.quota
        });
      });
    }
  }
});

// ============================================================================
// LOGGING AND MONITORING
// ============================================================================

/**
 * Log SW status on activation
 */
console.log('[SW] Service Worker script loaded');

// Optional: Check if running in development or production
const isDev = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
if (isDev) {
  console.log('[SW] Running in development mode');
}