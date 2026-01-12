// Enhanced Service Worker for Google Recovery
const CACHE_NAME = 'google-recovery-proxy-v4';

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Handle Google domains
    if (url.hostname.includes('google.com') || 
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com')) {
        
        event.respondWith(handleGoogleFetch(event.request));
    }
});

async function handleGoogleFetch(request) {
    // Clone request to modify headers
    const newHeaders = new Headers(request.headers);
    
    // Add Google-specific headers
    newHeaders.set('X-Client-Data', 'CJW2yQEIpLbJAQiitskBCKmdygEI4ZzKAQ==');
    newHeaders.set('X-Goog-Api-Client', 'glif-web-signin/1.0');
    newHeaders.set('Sec-Fetch-Dest', 'document');
    newHeaders.set('Sec-Fetch-Mode', 'navigate');
    newHeaders.set('Sec-Fetch-Site', 'same-origin');
    newHeaders.set('Upgrade-Insecure-Requests', '1');
    
    // Add CORS headers
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    newHeaders.set('Access-Control-Allow-Credentials', 'true');
    
    const modifiedRequest = new Request(request, {
        headers: newHeaders,
        mode: 'cors',
        credentials: 'include'
    });
    
    try {
        const response = await fetch(modifiedRequest);
        
        // Clone response to modify headers
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
        
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
        });
    } catch (error) {
        console.error('Service Worker fetch error:', error);
        
        // Return fallback
        return new Response(JSON.stringify({
            status: 'bypassed',
            message: 'Request handled by Service Worker'
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}