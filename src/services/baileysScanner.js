const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
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

      const existingSession = await Session.findOne({ sessionId });
      if (existingSession && existingSession.status === 'active') {
        console.log(`⚠️  Session ${sessionId} already active`);
        this.io.to(socketId).emit('error', {
          message: 'Session already active'
        });
        return { success: false, message: 'Session already active' };
      }

      const authPath = path.join(process.cwd(), '.auth', sessionId);
      await fs.mkdir(authPath, { recursive: true });

      const { version } = await fetchLatestBaileysVersion();
      console.log(`📱 Using WhatsApp version: ${version.join('.')}`);

      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      let authenticated = false;
      let connectionAttempts = 0;
      const MAX_ATTEMPTS = 3;

      const createSocket = async () => {
        connectionAttempts++;
        console.log(`🔄 Connection attempt ${connectionAttempts}/${MAX_ATTEMPTS} for ${sessionId}`);

        const sock = makeWASocket({
          version,
          logger: this.logger,
          printQRInTerminal: false,
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, this.logger),
          },
          browser: ['Ubuntu', 'Chrome', '20.0.04'],
          connectTimeoutMs: 60000,
          defaultQueryTimeoutMs: 0,
          keepAliveIntervalMs: 10000,
          emitOwnEvents: true,
          markOnlineOnConnect: false,
          syncFullHistory: false,
          getMessage: async () => undefined,
          generateHighQualityLinkPreview: false,
          patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(
              message.buttonsMessage ||
              message.templateMessage ||
              message.listMessage
            );
            if (requiresPatch) {
              message = {
                viewOnceMessage: {
                  message: {
                    messageContextInfo: {
                      deviceListMetadataVersion: 2,
                      deviceListMetadata: {},
                    },
                    ...message,
                  },
                },
              };
            }
            return message;
          },
        });

        this.activeSessions.set(sessionId, sock);

        let qrGenerated = false;
        let shouldReconnect = true;

        sock.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, qr } = update;

          if (qr && !authenticated) {
            try {
              if (!qrGenerated) {
                console.log(`✅ QR code generated for ${sessionId}`);
                console.timeEnd(`baileys-scan-${sessionId}`);
                qrGenerated = true;
              }

              const qrImage = await qrcode.toDataURL(qr);
              
              this.io.to(socketId).emit('qr', {
                sessionId,
                qr: qrImage,
                timestamp: Date.now()
              });

              console.log(`📤 QR code sent to client`);
            } catch (error) {
              console.error('Error generating QR:', error);
            }
          }

          if (connection === 'connecting') {
            console.log(`🔄 ${sessionId} connecting...`);
            this.io.to(socketId).emit('status', {
              message: 'Connecting to WhatsApp...'
            });
          }

          if (connection === 'open' && !authenticated) {
            authenticated = true;
            shouldReconnect = false;
            console.log(`✅ ${sessionId} connected successfully!`);

            try {
              const user = sock.user;
              const phoneNumber = user.id.split(':')[0];

              console.log(`📱 Phone: ${phoneNumber}`);
              console.log(`👤 Name: ${user.name}`);

              const expiresAt = new Date();
              expiresAt.setDate(expiresAt.getDate() + 7);

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

              this.io.to(socketId).emit('authenticated', {
                sessionId,
                phoneNumber,
                userName: user.name,
                expiresAt
              });

              await new Promise(resolve => setTimeout(resolve, 3000));

              try {
                const message = 
                  `✅ *Session Connected Successfully!*\n\n` +
                  `🆔 Session ID:\n\`\`\`${sessionId}\`\`\`\n\n` +
                  `📱 Phone: ${phoneNumber}\n` +
                  `👤 Name: ${user.name}\n` +
                  `⏰ Valid for: 7 days\n\n` +
                  `💾 Use this Session ID to deploy your bot!\n\n` +
                  `🔥 Developed by D3AD_XMILE`;

                await sock.sendMessage(user.id, { text: message });
                console.log(`✅ Session ID sent via WhatsApp`);
              } catch (msgError) {
                console.error('Failed to send WhatsApp message:', msgError.message);
              }

              setTimeout(async () => {
                try {
                  await sock.logout();
                  this.activeSessions.delete(sessionId);
                  await fs.rm(authPath, { recursive: true, force: true });
                  console.log(`🗑️  Cleaned up ${sessionId}`);
                } catch (err) {
                  console.error('Cleanup error:', err.message);
                }
              }, 5000);

            } catch (error) {
              console.error('Error in authentication handler:', error);
              this.io.to(socketId).emit('error', {
                message: 'Authentication succeeded but failed to save session'
              });
            }
          }

          if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.output?.payload?.message || 'Unknown';
            
            console.log(`🔌 ${sessionId} disconnected: ${reason} (code: ${statusCode})`);

            this.activeSessions.delete(sessionId);

            // Handle reconnection logic
            if (!authenticated && shouldReconnect) {
              if (statusCode === DisconnectReason.restartRequired) {
                console.log(`♻️  Restart required, reconnecting...`);
                setTimeout(() => createSocket(), 2000);
                return;
              }

              if (statusCode === DisconnectReason.connectionClosed && connectionAttempts < MAX_ATTEMPTS) {
                console.log(`🔄 Connection closed, retrying (${connectionAttempts}/${MAX_ATTEMPTS})...`);
                setTimeout(() => createSocket(), 3000);
                return;
              }

              if (statusCode === DisconnectReason.timedOut && connectionAttempts < MAX_ATTEMPTS) {
                console.log(`⏱️  Timed out, retrying (${connectionAttempts}/${MAX_ATTEMPTS})...`);
                setTimeout(() => createSocket(), 3000);
                return;
              }
            }

            // Final failure
            if (!authenticated) {
              let errorMessage = 'Connection failed. Please try again.';
              
              if (statusCode === DisconnectReason.loggedOut) {
                errorMessage = 'Session logged out. Please scan QR again.';
              } else if (reason.includes('QR refs')) {
                errorMessage = 'QR code expired. Please refresh and scan again.';
              } else if (connectionAttempts >= MAX_ATTEMPTS) {
                errorMessage = 'Maximum retry attempts reached. Please refresh and try again.';
              }

              this.io.to(socketId).emit('error', { message: errorMessage });
              
              try {
                await fs.rm(authPath, { recursive: true, force: true });
              } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError.message);
              }
            }
          }
        });

        sock.ev.on('creds.update', saveCreds);
      };

      // Start the connection
      await createSocket();

      return {
        success: true,
        sessionId,
        message: 'Baileys scan started'
      };

    } catch (error) {
      console.error(`❌ Fatal error for ${sessionId}:`, error.message);
      
      const sock = this.activeSessions.get(sessionId);
      if (sock) {
        try {
          await sock.logout();
        } catch (e) {}
        this.activeSessions.delete(sessionId);
      }

      const authPath = path.join(process.cwd(), '.auth', sessionId);
      try {
        await fs.rm(authPath, { recursive: true, force: true });
      } catch (e) {}

      throw error;
    }
  }

  async stopScan(sessionId) {
    try {
      const sock = this.activeSessions.get(sessionId);
      if (sock) {
        await sock.logout();
        this.activeSessions.delete(sessionId);
        
        const authPath = path.join(process.cwd(), '.auth', sessionId);
        await fs.rm(authPath, { recursive: true, force: true });
        
        console.log(`🛑 Scan stopped: ${sessionId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Stop scan error:`, error.message);
      return false;
    }
  }

  getActiveScans() {
    return this.activeSessions.size;
  }

  async cleanup() {
    console.log(`🧹 Cleaning up ${this.activeSessions.size} sessions...`);
    const promises = [];

    for (const [sessionId, sock] of this.activeSessions.entries()) {
      promises.push(
        sock.logout()
          .then(() => {
            const authPath = path.join(process.cwd(), '.auth', sessionId);
            return fs.rm(authPath, { recursive: true, force: true });
          })
          .catch((err) => console.error(`Cleanup error:`, err.message))
      );
    }

    await Promise.allSettled(promises);
    this.activeSessions.clear();
    console.log('✅ Cleanup complete');
  }
}

module.exports = BaileysScanner;
