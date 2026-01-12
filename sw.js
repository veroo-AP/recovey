// Service Worker for Google Recovery System
const CACHE_NAME = 'google-recovery-v5';
const API_BASE = '/api/';

self.addEventListener('install', (event) => {
    console.log('🛠️ Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll([
                    '/',
                    '/index.html',
                    '/style.css',
                    '/script.js',
                    '/manifest.json'
                ]);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker activated');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
        .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Handle API requests
    if (url.pathname.startsWith(API_BASE)) {
        event.respondWith(
            handleApiRequest(event.request)
        );
        return;
    }
    
    // Handle static assets
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    if (response) {
                        return response;
                    }
                    return fetch(event.request);
                })
        );
    }
});

async function handleApiRequest(request) {
    try {
        // Try network first for API requests
        const response = await fetch(request);
        
        // Clone response to cache
        const responseToCache = response.clone();
        
        // Cache successful responses
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, responseToCache);
        }
        
        return response;
        
    } catch (error) {
        console.error('API request failed:', error);
        
        // Try cache as fallback
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return error response
        return new Response(JSON.stringify({
            success: false,
            error: 'Network error',
            message: 'Please check your internet connection'
        }), {
            status: 503,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
    }
}

// Handle messages from main thread
self.addEventListener('message', (event) => {
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Background sync for offline support
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-recovery') {
        console.log('🔄 Background sync triggered');
        // Handle background sync here
    }
});

// Push notifications
self.addEventListener('push', (event) => {
    const data = event.data.json();
    
    const options = {
        body: data.body || 'Google Recovery System',
        icon: '/icon.png',
        badge: '/badge.png',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || '/'
        }
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'Google Recovery', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                for (const client of clientList) {
                    if (client.url === event.notification.data.url && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(event.notification.data.url);
                }
            })
    );
});