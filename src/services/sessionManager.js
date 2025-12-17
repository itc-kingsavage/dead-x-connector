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

        // QR Code event
        client.on('qr', async (qr) => {
          console.log(`QR Code generated for session: ${sessionId}`);
          
          // Generate QR code as data URL
          const qrDataURL = await qrcode.toDataURL(qr);
          
          // Update session with QR code
          await Session.findOneAndUpdate(
            { sessionId },
            { qrCode: qrDataURL, status: 'pending' }
          );

          // Emit to frontend via Socket.io
          io.emit(`qr-${sessionId}`, { qr: qrDataURL });
        });

        // Authenticated event
        client.on('authenticated', async () => {
          console.log(`Session authenticated: ${sessionId}`);
          io.emit(`authenticated-${sessionId}`, { message: 'Authenticated!' });
        });

        // Ready event
        client.on('ready', async () => {
          console.log(`Client ready: ${sessionId}`);
          
          const info = client.info;
          const phoneNumber = info.wid.user;

          // Get session data (this would be the authentication tokens)
          const sessionData = {
            phoneNumber,
            authenticated: true,
            timestamp: Date.now()
          };

          // Encrypt and save to MongoDB
          const encrypted = this.encryptData(sessionData);
          
          await Session.findOneAndUpdate(
            { sessionId },
            {
              sessionData: encrypted,
              phoneNumber,
              status: 'active',
              qrCode: null
            }
          );

          io.emit(`ready-${sessionId}`, { 
            sessionId, 
            phoneNumber,
            message: 'Session created successfully!' 
          });

          // Store client reference
          this.activeClients.set(sessionId, client);
          
          resolve({ sessionId, phoneNumber });
        });

        // Error handling
        client.on('auth_failure', async (msg) => {
          console.error(`Auth failure for ${sessionId}:`, msg);
          await Session.findOneAndUpdate(
            { sessionId },
            { status: 'expired' }
          );
          io.emit(`error-${sessionId}`, { error: 'Authentication failed' });
          reject(new Error('Authentication failed'));
        });

        client.on('disconnected', async (reason) => {
          console.log(`Client disconnected: ${sessionId}`, reason);
          this.activeClients.delete(sessionId);
        });

        // Initialize the client
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

    // Start WhatsApp client initialization (don't wait for it)
    this.initializeClient(sessionId, io).catch(err => {
      console.error(`Failed to initialize session ${sessionId}:`, err);
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
      await client.destroy();
      this.activeClients.delete(sessionId);
    }

    // Delete from database
    await Session.findOneAndDelete({ sessionId });
    
    return { success: true, message: 'Session deleted' };
  }
}

module.exports = new SessionManager();
