<?php
require_once 'config.php';
require_once 'session.php';

class AuthManager {
    private $session;
    
    public function __construct() {
        $this->session = RecoverySession::getInstance();
    }
    
    public function validateRequest() {
        // Check rate limiting
        $ip = $_SERVER['REMOTE_ADDR'];
        if (!checkRateLimit($ip)) {
            $this->jsonResponse(['error' => 'Rate limit exceeded'], 429);
            exit;
        }
        
        // Validate session
        if (!$this->session->isValid()) {
            $this->session->clear();
            $this->jsonResponse(['error' => 'Session expired'], 401);
            exit;
        }
        
        // Validate CSRF token for POST requests
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $this->validateCSRFToken();
        }
        
        return true;
    }
    
    private function validateCSRFToken() {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['csrf_token'] ?? null;
        $sessionToken = $this->session->get('csrf_token');
        
        if (!$token || !$sessionToken || !hash_equals($sessionToken, $token)) {
            $this->jsonResponse(['error' => 'Invalid CSRF token'], 403);
            exit;
        }
    }
    
    public function generateCSRFToken() {
        $token = bin2hex(random_bytes(32));
        $this->session->set('csrf_token', $token);
        return $token;
    }
    
    public function generateSessionToken() {
        return hash_hmac('sha256', $this->session->getSessionId(), SECRET_KEY);
    }
    
    public function validateSessionToken($token) {
        $expected = $this->generateSessionToken();
        return hash_equals($expected, $token);
    }
    
    public function jsonResponse($data, $statusCode = 200) {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        
        // Add CSRF token to response if not present
        if (!isset($data['csrf_token'])) {
            $data['csrf_token'] = $this->generateCSRFToken();
        }
        
        echo json_encode($data);
        exit;
    }
    
    public function getRequestData() {
        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
        
        if (strpos($contentType, 'application/json') !== false) {
            $input = file_get_contents('php://input');
            return json_decode($input, true) ?: [];
        }
        
        return $_POST;
    }
}

// Initialize auth manager
$auth = new AuthManager();
?>