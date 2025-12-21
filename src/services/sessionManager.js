// src/services/sessionManager.js - FIXED VERSION

const { Client, LocalAuth } = require('whatsapp-web.js');
const Session = require('../models/Session');
const { v4: uuidv4 } = require('uuid');
const CryptoJS = require('crypto-js');
const qrcode = require('qrcode');

class SessionManager {
  constructor() {
    this.activeClients = new Map();
  }

  // Generate unique session ID
  generateSessionId() {
    return `DEADX-${uuidv4().split('-')[0].toUpperCase()}`;
  }

  // Encrypt session data
  encryptData(data) {
    const key = process.env.ENCRYPTION_KEY || 'default-key-change-this';
    return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
  }

  // Decrypt session data
  decryptData(encryptedData) {
    const key = process.env.ENCRYPTION_KEY || 'default-key-change-this';
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  }

  // Initialize WhatsApp client for scanning
  async initializeClient(sessionId, io) {
    return new Promise(async (resolve, reject) => {
      try {
        const client = new Client({
          authStrategy: new LocalAuth({
            clientId: sessionId,
            dataPath: './.wwebjs_auth'
          }),
          puppeteer: {
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--single-process',
              '--disable-gpu'
            ]
          }
        });

        let qrRetries = 0;
        const maxQrRetries = 3;

        // QR Code event
        client.on('qr', async (qr) => {
          console.log(`QR Code generated for session: ${sessionId} (Attempt ${qrRetries + 1})`);
          qrRetries++;
          
          // Generate QR code as data URL
          const qrDataURL = await qrcode.toDataURL(qr);
          
          // Update session with QR code
          await Session.findOneAndUpdate(
            { sessionId },
            { qrCode: qrDataURL, status: 'pending' }
          );

          // Emit to frontend via Socket.io
          io.emit(`qr-${sessionId}`, { qr: qrDataURL });

          // If too many QR codes, something is wrong
          if (qrRetries >= maxQrRetries) {
            console.log(`Too many QR retries for ${sessionId}, stopping...`);
            await client.destroy();
            reject(new Error('Too many QR code generations'));
          }
        });

        // Authenticated event
        client.on('authenticated', async () => {
          console.log(`✅ Session authenticated: ${sessionId}`);
          io.emit(`authenticated-${sessionId}`, { message: 'Authenticated! Connecting...' });
        });

        // Ready event - THIS IS THE KEY MOMENT!
        client.on('ready', async () => {
          console.log(`✅ Client ready: ${sessionId}`);
          
          const info = client.info;
          const phoneNumber = info.wid.user;

          // Get session data
          const sessionData = {
            phoneNumber,
            authenticated: true,
            timestamp: Date.now(),
            platform: info.platform || 'unknown',
            pushname: info.pushname || 'Unknown'
          };

          // Encrypt and save to MongoDB with ACTIVE status
          const encrypted = this.encryptData(sessionData);
          
          const updatedSession = await Session.findOneAndUpdate(
            { sessionId },
            {
              sessionData: encrypted,
              phoneNumber,
              status: 'active', // ← CRITICAL: Mark as ACTIVE!
              qrCode: null
            },
            { new: true }
          );

          console.log(`✅ Session ${sessionId} marked as ACTIVE with phone: ${phoneNumber}`);

          // Emit success to frontend
          io.emit(`ready-${sessionId}`, { 
            sessionId, 
            phoneNumber,
            status: 'active',
            platform: info.platform,
            message: 'Session created successfully! You can now use this Session ID in your bot.' 
          });

          // Store client reference briefly
          this.activeClients.set(sessionId, client);
          
          // Auto-disconnect after 60 seconds to save resources
          // But keep session data in database!
          setTimeout(async () => {
            console.log(`Auto-disconnecting scanner client for: ${sessionId}`);
            try {
              if (this.activeClients.has(sessionId)) {
                await client.destroy();
                this.activeClients.delete(sessionId);
                console.log(`✅ Scanner client disconnected: ${sessionId}`);
              }
            } catch (e) {
              console.error('Error auto-disconnecting:', e.message);
            }
          }, 60000); // 60 seconds
          
          resolve({ sessionId, phoneNumber, status: 'active' });
        });

        // Auth failure event
        client.on('auth_failure', async (msg) => {
          console.error(`❌ Auth failure for ${sessionId}:`, msg);
          await Session.findOneAndUpdate(
            { sessionId },
            { status: 'expired' }
          );
          io.emit(`error-${sessionId}`, { error: 'Authentication failed. Please try again.' });
          
          // Clean up
          if (this.activeClients.has(sessionId)) {
            await client.destroy();
            this.activeClients.delete(sessionId);
          }
          
          reject(new Error('Authentication failed'));
        });

        // Disconnected event
        client.on('disconnected', async (reason) => {
          console.log(`Client disconnected: ${sessionId}`, reason);
          this.activeClients.delete(sessionId);
        });

        // Initialize the client
        console.log(`Initializing WhatsApp client for: ${sessionId}`);
        await client.initialize();

      } catch (error) {
        console.error('Error initializing client:', error);
        reject(error);
      }
    });
  }

  // Create new session
  async createSession(io, metadata = {}) {
    const sessionId = this.generateSessionId();
    
    // Create session record in MongoDB
    const session = await Session.create({
      sessionId,
      status: 'pending',
      sessionData: this.encryptData({ initialized: true }),
      metadata
    });

    console.log(`Created new session: ${sessionId}`);

    // Start WhatsApp client initialization (don't wait for it)
    this.initializeClient(sessionId, io).catch(err => {
      console.error(`Failed to initialize session ${sessionId}:`, err.message);
    });

    return { sessionId, session };
  }

  // Get session by ID
  async getSession(sessionId) {
    const session = await Session.findBySessionId(sessionId);
    if (!session) {
      throw new Error('Session not found or expired');
    }
    return session;
  }

  // Validate and decrypt session
  async validateSession(sessionId) {
    const session = await this.getSession(sessionId);
    
    if (session.isExpired()) {
      throw new Error('Session has expired');
    }

    const decryptedData = this.decryptData(session.sessionData);
    
    return {
      sessionId: session.sessionId,
      phoneNumber: session.phoneNumber,
      status: session.status,
      data: decryptedData,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    };
  }

  // Delete session
  async deleteSession(sessionId) {
    // Destroy client if active
    const client = this.activeClients.get(sessionId);
    if (client) {
      try {
        await client.destroy();
      } catch (e) {
        console.error('Error destroying client:', e.message);
      }
      this.activeClients.delete(sessionId);
    }

    // Delete from database
    await Session.findOneAndDelete({ sessionId });
    
    return { success: true, message: 'Session deleted' };
  }
}

module.exports = new SessionManager();
