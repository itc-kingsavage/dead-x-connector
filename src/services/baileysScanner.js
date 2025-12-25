const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const Session = require('../models/Session');
const fs = require('fs').promises;
const path = require('path');
const pino = require('pino');

class BaileysScanner {
  constructor(io) {
    this.io = io;
    this.activeSessions = new Map();
    this.logger = pino({ level: 'silent' }); // Silent logger for production
  }

  async startScan(sessionId, socketId) {
    try {
      console.log(`🔄 Starting Baileys scan for: ${sessionId}`);
      console.time(`baileys-scan-${sessionId}`);

      // Check if session already exists
      const existingSession = await Session.findOne({ sessionId });
      if (existingSession && existingSession.status === 'active') {
        console.log(`⚠️  Session ${sessionId} already active`);
        this.io.to(socketId).emit('error', {
          message: 'Session already active'
        });
        return { success: false, message: 'Session already active' };
      }

      // Create auth directory
      const authPath = path.join(process.cwd(), '.auth', sessionId);
      await fs.mkdir(authPath, { recursive: true });

      // Get latest Baileys version
      const { version } = await fetchLatestBaileysVersion();
      console.log(`📱 Using WhatsApp version: ${version.join('.')}`);

      // Load auth state
      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      // Create socket connection
      const sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false,
        auth: state,
        browser: ['DEAD-X Scanner', 'Chrome', '110.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        getMessage: async () => undefined
      });

      // Store socket reference
      this.activeSessions.set(sessionId, sock);

      let qrGenerated = false;
      let authenticated = false;

      // QR Code Event (INSTANT!)
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR Code generation
        if (qr && !qrGenerated) {
          try {
            console.log(`✅ QR code generated for ${sessionId}`);
            console.timeEnd(`baileys-scan-${sessionId}`);
            qrGenerated = true;

            const qrImage = await qrcode.toDataURL(qr);
            
            this.io.to(socketId).emit('qr', {
              sessionId,
              qr: qrImage,
              timestamp: Date.now()
            });

            console.log(`📤 QR code sent to client (Baileys)`);
          } catch (error) {
            console.error('Error generating QR:', error);
            this.io.to(socketId).emit('error', {
              message: 'Failed to generate QR code'
            });
          }
        }

        // Connection opened (authenticated)
        if (connection === 'open' && !authenticated) {
          authenticated = true;
          console.log(`✅ ${sessionId} connected successfully!`);

          try {
            // Get user info
            const user = sock.user;
            const phoneNumber = user.id.split(':')[0];

            console.log(`📱 Phone: ${phoneNumber}`);
            console.log(`👤 Name: ${user.name}`);

            // Save session to database
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            // Read auth files for storage
            const authFiles = await fs.readdir(authPath);
            const authData = {};
            
            for (const file of authFiles) {
              if (file.endsWith('.json')) {
                const filePath = path.join(authPath, file);
                const content = await fs.readFile(filePath, 'utf8');
                authData[file] = JSON.parse(content);
              }
            }

            await Session.findOneAndUpdate(
              { sessionId },
              {
                sessionId,
                phoneNumber,
                data: authData,
                status: 'active',
                expiresAt,
                createdAt: new Date(),
                lastUpdated: new Date()
              },
              { upsert: true, new: true }
            );

            console.log(`💾 Session saved to database: ${sessionId}`);

            // Emit success to client
            this.io.to(socketId).emit('authenticated', {
              sessionId,
              phoneNumber,
              expiresAt
            });

            // Send Session ID via WhatsApp
            const message = 
              `✅ *Session Connected Successfully!*\n\n` +
              `🆔 Your Session ID:\n\`\`\`${sessionId}\`\`\`\n\n` +
              `📱 Phone: ${phoneNumber}\n` +
              `👤 Name: ${user.name}\n` +
              `⏰ Expires: 7 days from now\n\n` +
              `💾 Use this Session ID to deploy your bot!\n\n` +
              `🔥 Developed by D3AD_XMILE`;

            await sock.sendMessage(user.id, { text: message });
            console.log(`✅ Session ID sent via WhatsApp: ${sessionId}`);

            // Disconnect after sending message
            setTimeout(async () => {
              try {
                await sock.logout();
                this.activeSessions.delete(sessionId);
                console.log(`🗑️  Socket disconnected: ${sessionId}`);
              } catch (err) {
                console.error('Error during logout:', err);
              }
            }, 5000);

          } catch (error) {
            console.error('Error saving session:', error);
            this.io.to(socketId).emit('error', {
              message: 'Failed to save session'
            });
          }
        }

        // Connection closed
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const reason = lastDisconnect?.error?.output?.payload?.message;
          
          console.log(`🔌 ${sessionId} disconnected:`, reason || statusCode);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('User logged out');
            this.io.to(socketId).emit('logged_out', {
              message: 'Logged out from WhatsApp'
            });
          } else if (statusCode === DisconnectReason.restartRequired) {
            console.log('Restart required');
            this.io.to(socketId).emit('error', {
              message: 'Connection lost, please try again'
            });
          }

          this.activeSessions.delete(sessionId);
        }
      });

      // Credentials update (auto-save)
      sock.ev.on('creds.update', saveCreds);

      // Messages update (for logging)
      sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.key.fromMe && msg.message) {
          console.log(`📨 Message received in ${sessionId}`);
        }
      });

      return {
        success: true,
        sessionId,
        message: 'Baileys scan started successfully'
      };

    } catch (error) {
      console.error(`❌ Error starting Baileys scan for ${sessionId}:`, error);
      
      const sock = this.activeSessions.get(sessionId);
      if (sock) {
        try {
          await sock.logout();
        } catch (e) {
          // Ignore logout errors
        }
        this.activeSessions.delete(sessionId);
      }

      throw error;
    }
  }

  async stopScan(sessionId) {
    try {
      const sock = this.activeSessions.get(sessionId);
      if (sock) {
        await sock.logout();
        this.activeSessions.delete(sessionId);
        console.log(`🛑 Baileys scan stopped for ${sessionId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error stopping scan for ${sessionId}:`, error);
      return false;
    }
  }

  getActiveScans() {
    return this.activeSessions.size;
  }

  async cleanup() {
    console.log(`🧹 Cleaning up ${this.activeSessions.size} active Baileys sessions...`);
    const promises = [];

    for (const [sessionId, sock] of this.activeSessions.entries()) {
      promises.push(
        sock.logout()
          .then(() => console.log(`✅ Cleaned up ${sessionId}`))
          .catch((err) => console.error(`❌ Error cleaning ${sessionId}:`, err))
      );
    }

    await Promise.allSettled(promises);
    this.activeSessions.clear();
    console.log('✅ Baileys cleanup complete');
  }
}

module.exports = BaileysScanner;
