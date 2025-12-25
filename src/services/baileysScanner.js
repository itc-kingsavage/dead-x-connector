const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const Session = require('../models/Session');
const fs = require('fs').promises;
const path = require('path');
const pino = require('pino');

class BaileysScanner {
  constructor(io) {
    this.io = io;
    this.activeSessions = new Map();
    this.logger = pino({ level: 'silent' });
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
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`📱 Using WhatsApp version: ${version.join('.')}`);

      // Load auth state
      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      // IMPROVED: Create socket with better connection settings
      const sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu('Chrome'), // Use Ubuntu Chrome instead of custom
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: undefined,
        keepAliveIntervalMs: 30000, // Increased from 10s to 30s
        emitOwnEvents: true,
        markOnlineOnConnect: false, // Don't mark online during scan
        syncFullHistory: false, // Don't sync history during scan
        getMessage: async () => undefined,
        // CRITICAL: Better connection options
        shouldIgnoreJid: () => false,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        // CRITICAL: Add mobile flag
        mobile: false
      });

      // Store socket reference
      this.activeSessions.set(sessionId, sock);

      let qrGenerated = false;
      let authenticated = false;
      let qrRetries = 0;
      const MAX_QR_RETRIES = 3;

      // QR Code Event
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR Code generation
        if (qr) {
          try {
            qrRetries++;
            
            if (!qrGenerated) {
              console.log(`✅ QR code generated for ${sessionId}`);
              console.timeEnd(`baileys-scan-${sessionId}`);
              qrGenerated = true;
            } else {
              console.log(`🔄 QR code refreshed (${qrRetries}/${MAX_QR_RETRIES}) for ${sessionId}`);
            }

            const qrImage = await qrcode.toDataURL(qr);
            
            this.io.to(socketId).emit('qr', {
              sessionId,
              qr: qrImage,
              timestamp: Date.now(),
              retry: qrRetries
            });

            console.log(`📤 QR code sent to client (attempt ${qrRetries})`);

            // Notify if max retries reached
            if (qrRetries >= MAX_QR_RETRIES) {
              this.io.to(socketId).emit('qr_timeout', {
                message: 'QR code expired. Please refresh and try again.'
              });
            }

          } catch (error) {
            console.error('Error generating QR:', error);
            this.io.to(socketId).emit('error', {
              message: 'Failed to generate QR code'
            });
          }
        }

        // Connection opening (connecting)
        if (connection === 'connecting') {
          console.log(`🔄 ${sessionId} is connecting...`);
          this.io.to(socketId).emit('connecting', {
            message: 'Connecting to WhatsApp...'
          });
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
              userName: user.name,
              expiresAt
            });

            // Wait a bit before sending message
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Send Session ID via WhatsApp
            try {
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
            } catch (msgError) {
              console.error('Error sending WhatsApp message:', msgError);
              // Don't fail if message sending fails
            }

            // Disconnect after a delay
            setTimeout(async () => {
              try {
                await sock.logout();
                this.activeSessions.delete(sessionId);
                console.log(`🗑️  Socket disconnected: ${sessionId}`);
                
                // Clean up auth files
                await fs.rm(authPath, { recursive: true, force: true });
              } catch (err) {
                console.error('Error during cleanup:', err);
              }
            }, 5000);

          } catch (error) {
            console.error('Error saving session:', error);
            this.io.to(socketId).emit('error', {
              message: 'Failed to save session: ' + error.message
            });
          }
        }

        // Connection closed
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const reason = lastDisconnect?.error?.output?.payload?.message || 'Unknown reason';
          
          console.log(`🔌 ${sessionId} disconnected:`, reason);

          // Handle different disconnection reasons
          if (statusCode === DisconnectReason.loggedOut) {
            console.log('❌ User logged out');
            this.io.to(socketId).emit('error', {
              message: 'Session logged out. Please scan again.'
            });
          } else if (statusCode === DisconnectReason.restartRequired) {
            console.log('⚠️  Restart required - attempting reconnection...');
            // Don't emit error, Baileys will auto-reconnect
          } else if (statusCode === DisconnectReason.connectionClosed) {
            console.log('⚠️  Connection closed unexpectedly');
            this.io.to(socketId).emit('error', {
              message: 'Connection lost. Please try scanning again.'
            });
          } else if (statusCode === DisconnectReason.timedOut) {
            console.log('⏱️  Connection timed out');
            this.io.to(socketId).emit('error', {
              message: 'Connection timed out. Please try again.'
            });
          } else if (reason.includes('QR refs attempts ended')) {
            console.log('❌ QR code expired');
            this.io.to(socketId).emit('error', {
              message: 'QR code expired. Please refresh and scan again.'
            });
          } else {
            console.log('❌ Connection failed:', reason);
            this.io.to(socketId).emit('error', {
              message: 'Connection failed. Please try again.'
            });
          }

          this.activeSessions.delete(sessionId);
          
          // Clean up auth files on failure
          try {
            await fs.rm(authPath, { recursive: true, force: true });
          } catch (cleanupError) {
            console.error('Error cleaning up auth files:', cleanupError);
          }
        }
      });

      // Credentials update (auto-save)
      sock.ev.on('creds.update', saveCreds);

      // Messages update (for confirming connection is alive)
      sock.ev.on('messages.upsert', async ({ messages }) => {
        if (messages[0] && !authenticated) {
          console.log(`📨 Message detected in ${sessionId} - connection is alive`);
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

      // Clean up auth files
      const authPath = path.join(process.cwd(), '.auth', sessionId);
      try {
        await fs.rm(authPath, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
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
        
        // Clean up auth files
        const authPath = path.join(process.cwd(), '.auth', sessionId);
        await fs.rm(authPath, { recursive: true, force: true });
        
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
          .then(() => {
            console.log(`✅ Cleaned up ${sessionId}`);
            // Clean up auth files
            const authPath = path.join(process.cwd(), '.auth', sessionId);
            return fs.rm(authPath, { recursive: true, force: true });
          })
          .catch((err) => console.error(`❌ Error cleaning ${sessionId}:`, err))
      );
    }

    await Promise.allSettled(promises);
    this.activeSessions.clear();
    console.log('✅ Baileys cleanup complete');
  }
}

module.exports = BaileysScanner;
