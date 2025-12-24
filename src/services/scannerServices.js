const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const Session = require('../models/Session');

class ScannerService {
  constructor(io) {
    this.io = io;
    this.clients = new Map();
  }

  async startScan(sessionId, socketId) {
    try {
      console.log(`🔄 Starting scan for session: ${sessionId}`);
      console.time(`scan-${sessionId}`);

      const existingSession = await Session.findOne({ sessionId });
      if (existingSession && existingSession.status === 'active') {
        console.log(`⚠️  Session ${sessionId} already active`);
        return { success: false, message: 'Session already active' };
      }

      console.log('⏳ Creating WhatsApp client...');
      const client = new Client({
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
          ],
          timeout: 0
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
        }
      });

      console.log('✅ Client created, waiting for QR...');
      this.clients.set(sessionId, client);

      let qrGenerated = false;

      client.on('qr', async (qr) => {
        try {
          if (!qrGenerated) {
            console.log(`✅ QR code generated for ${sessionId}`);
            console.timeEnd(`scan-${sessionId}`);
            qrGenerated = true;
          }

          const qrImage = await qrcode.toDataURL(qr);
          this.io.to(socketId).emit('qr', {
            sessionId,
            qr: qrImage,
            timestamp: Date.now()
          });

          console.log(`📤 QR code sent to client ${sessionId}`);
        } catch (error) {
          console.error('Error generating QR image:', error);
          this.io.to(socketId).emit('error', {
            message: 'Failed to generate QR code image'
          });
        }
      });

      client.on('loading_screen', (percent, message) => {
        console.log(`⏳ ${sessionId} - Loading: ${percent}% - ${message}`);
        this.io.to(socketId).emit('loading', { percent, message });
      });

      client.on('authenticated', async (session) => {
        try {
          console.log(`✅ ${sessionId} authenticated!`);

          const phoneNumber = session.me?.user || 'unknown';
          console.log(`📱 Phone: ${phoneNumber}`);

          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 7);

          await Session.findOneAndUpdate(
            { sessionId },
            {
              sessionId,
              phoneNumber,
              data: session,
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
            expiresAt
          });

          setTimeout(async () => {
            try {
              await client.destroy();
              this.clients.delete(sessionId);
              console.log(`🗑️  Client destroyed: ${sessionId}`);
            } catch (err) {
              console.error('Error destroying client:', err);
            }
          }, 5000);

        } catch (error) {
          console.error('Error in authenticated event:', error);
          this.io.to(socketId).emit('error', {
            message: 'Failed to save session'
          });
        }
      });

      client.on('ready', async () => {
        try {
          console.log(`✅ ${sessionId} is ready!`);
          
          // Send session ID via WhatsApp DM
          const chatId = client.info.wid._serialized;
          const message = `✅ *Session Connected Successfully!*\n\n` +
                         `🆔 Your Session ID:\n\`\`\`${sessionId}\`\`\`\n\n` +
                         `📱 Phone: ${client.info.wid.user}\n` +
                         `⏰ Expires: 7 days from now\n\n` +
                         `💾 Use this Session ID to deploy your bot!\n\n` +
                         `🔥 Developed by D3AD_XMILE`;

          await client.sendMessage(chatId, message);
          console.log(`✅ Session ID sent to WhatsApp: ${sessionId}`);

        } catch (error) {
          console.error('Error sending WhatsApp message:', error);
        }
      });

      client.on('auth_failure', (msg) => {
        console.error(`❌ Auth failure for ${sessionId}:`, msg);
        this.io.to(socketId).emit('auth_failure', { message: msg });
        this.clients.delete(sessionId);
      });

      client.on('disconnected', (reason) => {
        console.log(`🔌 ${sessionId} disconnected:`, reason);
        this.clients.delete(sessionId);
      });

      console.log('🚀 Initializing client...');
      
      const initTimeout = setTimeout(() => {
        if (!qrGenerated) {
          console.error(`❌ Timeout: QR not generated after 30s for ${sessionId}`);
          this.io.to(socketId).emit('error', {
            message: 'QR generation timeout. Please try again.'
          });
          client.destroy().catch(() => {});
          this.clients.delete(sessionId);
        }
      }, 30000);

      await client.initialize();
      clearTimeout(initTimeout);

      return { success: true, sessionId, message: 'Scan started successfully' };

    } catch (error) {
      console.error(`❌ Error starting scan for ${sessionId}:`, error);
      
      const client = this.clients.get(sessionId);
      if (client) {
        try {
          await client.destroy();
        } catch (e) {}
        this.clients.delete(sessionId);
      }

      throw error;
    }
  }

  async stopScan(sessionId) {
    try {
      const client = this.clients.get(sessionId);
      if (client) {
        await client.destroy();
        this.clients.delete(sessionId);
        console.log(`🛑 Scan stopped for ${sessionId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error stopping scan for ${sessionId}:`, error);
      return false;
    }
  }

  getActiveScans() {
    return this.clients.size;
  }

  async cleanup() {
    console.log(`🧹 Cleaning up ${this.clients.size} active clients...`);
    const promises = [];
    
    for (const [sessionId, client] of this.clients.entries()) {
      promises.push(
        client.destroy()
          .then(() => console.log(`✅ Cleaned up ${sessionId}`))
          .catch((err) => console.error(`❌ Error cleaning ${sessionId}:`, err))
      );
    }

    await Promise.allSettled(promises);
    this.clients.clear();
    console.log('✅ Cleanup complete');
  }
}

module.exports = ScannerService;
