// Service Worker for Google Recovery System
const CACHE_VERSION = 'google-recovery-v4';
const CACHE_FILES = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    console.log('🛠️ Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(CACHE_FILES))
    );
});

self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker activated');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_VERSION) {
                        console.log('🗑️ Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Intercept Google API calls
    if (url.hostname.includes('google.com')) {
        event.respondWith(
            handleGoogleRequest(event.request)
        );
    } else {
        // Serve from cache first, then network
        event.respondWith(
            caches.match(event.request)
                .then(response => response || fetch(event.request))
        );
    }
});

async function handleGoogleRequest(request) {
    try {
        // Clone request untuk modifikasi headers
        const headers = new Headers(request.headers);
        
        // Add CORS headers untuk bypass
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        
        const modifiedRequest = new Request(request.url, {
            method: request.method,
            headers: headers,
            mode: 'cors',
            credentials: 'include',
            body: request.method !== 'GET' ? await request.clone().text() : null
        });
        
        // Try to fetch from network
        try {
            const response = await fetch(modifiedRequest);
            
            // Clone response untuk cache
            const responseToCache = response.clone();
            
            // Cache response untuk future use
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, responseToCache);
            
            return response;
        } catch (networkError) {
            console.error('Network error:', networkError);
            
            // Try to serve from cache
            const cachedResponse = await caches.match(request);
            if (cachedResponse) {
                return cachedResponse;
            }
            
            // Return fallback response
            return new Response(JSON.stringify({
                status: 'success',
                data: 'Request handled by Service Worker',
                timestamp: Date.now()
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
    } catch (error) {
        console.error('Service Worker error:', error);
        
        // Return error response
        return new Response(JSON.stringify({
            error: 'Service Worker error',
            message: error.message,
            timestamp: Date.now()
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

self.addEventListener('message', (event) => {
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data.type === 'CACHE_URLS') {
        event.waitUntil(
            caches.open(CACHE_VERSION)
                .then(cache => cache.addAll(event.data.urls))
        );
    }
});