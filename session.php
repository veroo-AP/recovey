<?php
require_once 'config.php';

class RecoverySession {
    private static $instance = null;
    
    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        if (!isset($_SESSION['recovery'])) {
            $_SESSION['recovery'] = [
                'id' => uniqid('rec_', true),
                'created' => time(),
                'data' => [],
                'cookies' => [],
                'params' => [],
                'state' => 'initial',
                'device_approval' => [
                    'requested' => false,
                    'approved' => false,
                    'notification_sent' => false
                ]
            ];
        }
    }
    
    public function get($key, $default = null) {
        $keys = explode('.', $key);
        $value = $_SESSION['recovery'];
        
        foreach ($keys as $k) {
            if (isset($value[$k])) {
                $value = $value[$k];
            } else {
                return $default;
            }
        }
        
        return $value;
    }
    
    public function set($key, $value) {
        $keys = explode('.', $key);
        $data = &$_SESSION['recovery'];
        
        foreach ($keys as $i => $k) {
            if ($i === count($keys) - 1) {
                $data[$k] = $value;
            } else {
                if (!isset($data[$k]) || !is_array($data[$k])) {
                    $data[$k] = [];
                }
                $data = &$data[$k];
            }
        }
        
        return $this;
    }
    
    public function updateParams($params) {
        $current = $this->get('params', []);
        $this->set('params', array_merge($current, $params));
    }
    
    public function updateCookies($cookies) {
        $current = $this->get('cookies', []);
        $this->set('cookies', array_merge($current, $cookies));
    }
    
    public function setState($state) {
        $this->set('state', $state);
    }
    
    public function getState() {
        return $this->get('state');
    }
    
    public function clear() {
        $_SESSION['recovery'] = [
            'id' => uniqid('rec_', true),
            'created' => time(),
            'data' => [],
            'cookies' => [],
            'params' => [],
            'state' => 'initial',
            'device_approval' => [
                'requested' => false,
                'approved' => false,
                'notification_sent' => false
            ]
        ];
    }
    
    public function isValid() {
        $created = $this->get('created');
        return (time() - $created) < SESSION_LIFETIME;
    }
    
    public function getSessionId() {
        return $this->get('id');
    }
    
    public function toArray() {
        return $_SESSION['recovery'];
    }
}

// Initialize session
$session = RecoverySession::getInstance();
?>