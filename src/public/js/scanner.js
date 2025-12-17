// Initialize Socket.io connection
const socket = io();

let currentSessionId = null;

// DOM Elements
const steps = {
    initial: document.getElementById('step-initial'),
    loading: document.getElementById('step-loading'),
    qr: document.getElementById('step-qr'),
    success: document.getElementById('step-success'),
    error: document.getElementById('step-error')
};

const elements = {
    startBtn: document.getElementById('startScanBtn'),
    retryBtn: document.getElementById('retryBtn'),
    copyBtn: document.getElementById('copyBtn'),
    qrImage: document.getElementById('qrImage'),
    currentSessionIdSpan: document.getElementById('currentSessionId'),
    sessionIdInput: document.getElementById('sessionIdInput'),
    phoneNumber: document.getElementById('phoneNumber'),
    expiresAt: document.getElementById('expiresAt'),
    errorMessage: document.getElementById('errorMessage'),
    statusMessage: document.getElementById('statusMessage')
};

// Show specific step
function showStep(stepName) {
    Object.values(steps).forEach(step => {
        if (step) step.classList.remove('active');
    });
    if (steps[stepName]) {
        steps[stepName].classList.add('active');
    }
}

// Show status message
function showStatus(message, type = 'info') {
    if (elements.statusMessage) {
        elements.statusMessage.textContent = message;
        elements.statusMessage.className = `status-message ${type}`;
        elements.statusMessage.style.display = 'block';
        
        setTimeout(() => {
            elements.statusMessage.style.display = 'none';
        }, 5000);
    }
}

// Start scan process
async function startScan() {
    try {
        showStep('loading');
        showStatus('Initializing WhatsApp client...', 'info');

        const response = await fetch('/scan/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            currentSessionId = data.sessionId;
            
            // Update UI with session ID
            if (elements.currentSessionIdSpan) {
                elements.currentSessionIdSpan.textContent = currentSessionId;
            }

            // Listen for QR code
            socket.on(`qr-${currentSessionId}`, handleQRCode);
            
            // Listen for authentication
            socket.on(`authenticated-${currentSessionId}`, handleAuthenticated);
            
            // Listen for ready event
            socket.on(`ready-${currentSessionId}`, handleReady);
            
            // Listen for errors
            socket.on(`error-${currentSessionId}`, handleError);

            showStatus('Waiting for QR code...', 'info');
        } else {
            throw new Error(data.message || 'Failed to start scan');
        }
    } catch (error) {
        console.error('Error starting scan:', error);
        showError('Failed to start scan: ' + error.message);
    }
}

// Handle QR code received
function handleQRCode(data) {
    console.log('QR Code received');
    showStep('qr');
    
    if (elements.qrImage && data.qr) {
        elements.qrImage.src = data.qr;
        showStatus('QR Code generated! Please scan with WhatsApp', 'success');
    }
}

// Handle authentication
function handleAuthenticated(data) {
    console.log('Authenticated:', data);
    showStatus('Authentication successful! Connecting...', 'success');
}

// Handle ready (session created)
function handleReady(data) {
    console.log('Session ready:', data);
    showStep('success');
    
    // Populate success information
    if (elements.sessionIdInput) {
        elements.sessionIdInput.value = data.sessionId;
    }
    
    if (elements.phoneNumber) {
        elements.phoneNumber.textContent = data.phoneNumber || 'N/A';
    }
    
    if (elements.expiresAt) {
        // Assuming 7 days from now
        const expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        elements.expiresAt.textContent = expiryDate.toLocaleString();
    }

    showStatus('Session created successfully!', 'success');
    
    // Clean up socket listeners
    cleanupSocketListeners();
}

// Handle errors
function handleError(data) {
    console.error('Error:', data);
    showError(data.error || 'An error occurred during scanning');
    cleanupSocketListeners();
}

// Show error step
function showError(message) {
    showStep('error');
    if (elements.errorMessage) {
        elements.errorMessage.textContent = message;
    }
    showStatus(message, 'error');
}

// Clean up socket listeners
function cleanupSocketListeners() {
    if (currentSessionId) {
        socket.off(`qr-${currentSessionId}`);
        socket.off(`authenticated-${currentSessionId}`);
        socket.off(`ready-${currentSessionId}`);
        socket.off(`error-${currentSessionId}`);
    }
}

// Copy session ID to clipboard
function copyToClipboard() {
    if (elements.sessionIdInput) {
        elements.sessionIdInput.select();
        document.execCommand('copy');
        
        if (elements.copyBtn) {
            const originalText = elements.copyBtn.textContent;
            elements.copyBtn.textContent = 'Copied!';
            elements.copyBtn.style.background = '#10b981';
            
            setTimeout(() => {
                elements.copyBtn.textContent = originalText;
                elements.copyBtn.style.background = '';
            }, 2000);
        }

        showStatus('Session ID copied to clipboard!', 'success');
    }
}

// Event Listeners
if (elements.startBtn) {
    elements.startBtn.addEventListener('click', startScan);
}

if (elements.retryBtn) {
    elements.retryBtn.addEventListener('click', () => {
        currentSessionId = null;
        showStep('initial');
    });
}

if (elements.copyBtn) {
    elements.copyBtn.addEventListener('click', copyToClipboard);
}

// Socket connection events
socket.on('connect', () => {
    console.log('Connected to server');
    showStatus('Connected to server', 'success');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    showStatus('Disconnected from server', 'error');
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    showStatus('Connection error: ' + error.message, 'error');
});

// Initial state
console.log('Scanner script loaded');
showStep('initial');
