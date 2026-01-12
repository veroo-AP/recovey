<?php
// Configuration file for Google Recovery System

// Security settings
define('SECRET_KEY', 'google_recovery_' . md5(__DIR__));
define('SESSION_LIFETIME', 3600); // 1 hour
define('MAX_REQUESTS_PER_MINUTE', 30);
define('RATE_LIMIT_ENABLED', true);

// Google API settings
define('GOOGLE_BASE_URL', 'https://accounts.google.com');
define('USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

// CORS settings
define('ALLOWED_ORIGINS', [
    'http://localhost',
    'http://localhost:8000',
    'https://yourdomain.com'
]);

// Database settings (if using database)
define('DB_ENABLED', false);
define('DB_HOST', 'localhost');
define('DB_NAME', 'google_recovery');
define('DB_USER', 'root');
define('DB_PASS', '');

// Proxy settings
define('PROXY_ENABLED', false);
define('PROXY_LIST', [
    // Add your proxy servers here
]);

// Logging settings
define('LOG_ENABLED', true);
define('LOG_FILE', __DIR__ . '/logs/recovery.log');

// Security headers
$securityHeaders = [
    'X-Content-Type-Options' => 'nosniff',
    'X-Frame-Options' => 'SAMEORIGIN',
    'X-XSS-Protection' => '1; mode=block',
    'Referrer-Policy' => 'strict-origin-when-cross-origin'
];

// Function to set security headers
function setSecurityHeaders() {
    global $securityHeaders;
    foreach ($securityHeaders as $header => $value) {
        header("$header: $value");
    }
}

// Function to validate origin
function validateOrigin() {
    if (!empty($_SERVER['HTTP_ORIGIN'])) {
        $origin = $_SERVER['HTTP_ORIGIN'];
        if (in_array($origin, ALLOWED_ORIGINS)) {
            header("Access-Control-Allow-Origin: $origin");
            header("Access-Control-Allow-Credentials: true");
        }
    }
}

// Function to log events
function logEvent($message, $level = 'INFO') {
    if (LOG_ENABLED) {
        $timestamp = date('Y-m-d H:i:s');
        $logMessage = "[$timestamp] [$level] $message\n";
        file_put_contents(LOG_FILE, $logMessage, FILE_APPEND | LOCK_EX);
    }
}

// Rate limiting function
function checkRateLimit($ip) {
    if (!RATE_LIMIT_ENABLED) return true;
    
    $cacheFile = __DIR__ . '/cache/ratelimit_' . md5($ip) . '.json';
    
    if (file_exists($cacheFile)) {
        $data = json_decode(file_get_contents($cacheFile), true);
        $currentTime = time();
        
        if ($data['timestamp'] > $currentTime - 60) {
            if ($data['count'] >= MAX_REQUESTS_PER_MINUTE) {
                return false;
            }
            $data['count']++;
        } else {
            $data = ['timestamp' => $currentTime, 'count' => 1];
        }
    } else {
        $data = ['timestamp' => time(), 'count' => 1];
    }
    
    file_put_contents($cacheFile, json_encode($data));
    return true;
}

// Initialize session
if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => SESSION_LIFETIME,
        'path' => '/',
        'domain' => '',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict'
    ]);
    session_start();
    session_regenerate_id(true);
}
?>