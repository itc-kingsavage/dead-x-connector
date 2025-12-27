const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const pino = require('pino');

class SessionLoader {
  constructor(scannerUrl, sessionId) {
    this.scannerUrl = scannerUrl;
    this.sessionId = sessionId;
    this.authPath = path.join(process.cwd(), '.auth', sessionId);
    this.logger = pino({ level: 'silent' });
    this.sock = null;
  }

  /**
   * Fetch session from scanner API
   */
  async fetchSession() {
    try {
      console.log(`🔄 Fetching session from scanner: ${this.sessionId}`);
      
      const response = await axios.get(
        `${this.scannerUrl}/session/${this.sessionId}`,
        { timeout: 10000 }
      );

      if (!response.data || !response.data.session) {
        throw new Error('No session data returned');
      }

      const { session } = response.data;
      
      if (session.status !== 'active') {
        throw new Error(`Session status is ${session.status}, not active`);
      }

      console.log(`✅ Session found!`);
      console.log(`   Phone: ${session.phoneNumber}`);
      console.log(`   Expires: ${session.expiresAt}`);

      return session;
      
    } catch (error) {
      console.error('❌ Failed to fetch session:', error.message);
      throw error;
    }
  }

  /**
   * Restore session to filesystem
   */
  async restoreSession(sessionData) {
    try {
      console.log('💾 Restoring session to filesystem...');
      
      await fs.mkdir(this.authPath, { recursive: true });

      // Write each auth file
      for (const [filename, content] of Object.entries(sessionData)) {
        const filePath = path.join(this.authPath, filename);
        await fs.writeFile(filePath, JSON.stringify(content, null, 2));
      }

      console.log(`✅ Session restored to: ${this.authPath}`);
      return true;
      
    } catch (error) {
      console.error('❌ Failed to restore session:', error.message);
      throw error;
    }
  }

  /**
   * Connect to WhatsApp using the session
   */
  async connect() {
    try {
      console.log('\n🔄 Connecting to WhatsApp...\n');

      // Fetch session from scanner
      const session = await this.fetchSession();
      
      // Restore to filesystem
      await this.restoreSession(session.data);

      // Get latest version
      const { version } = await fetchLatestBaileysVersion();
      console.log(`📱 Using WhatsApp version: ${version.join('.')}`);

      // Load auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath);

      // Create socket
      this.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        browser: ['DEAD-X-BOT', 'Chrome', '110.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: true,
        markOnlineOnConnect: true,
        syncFullHistory: true,
        getMessage: async (key) => {
          return { conversation: '' };
        },
        generateHighQualityLinkPreview: true,
      });

      // Connection update handler
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('⚠️  QR code generated - session may have expired!');
          console.log('🔄 Please generate a new session from scanner');
        }

        if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        }

        if (connection === 'open') {
          console.log('\n✅ Bot Connected Successfully!\n');
          console.log('📱 Phone:', this.sock.user.id.split(':')[0]);
          console.log('👤 Name:', this.sock.user.name);
          console.log('📦 Platform:', this.sock.user.platform);
          console.log('\n🎉 Bot is now online and ready!\n');
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const reason = lastDisconnect?.error?.output?.payload?.message || 'Unknown';
          
          console.log('🔌 Disconnected:', reason);

          // Handle reconnection
          if (statusCode === DisconnectReason.loggedOut) {
            console.log('❌ Logged out - need new session from scanner');
            process.exit(1);
          } else if (statusCode === DisconnectReason.restartRequired) {
            console.log('♻️  Restart required, reconnecting...');
            setTimeout(() => this.connect(), 5000);
          } else if (statusCode === DisconnectReason.connectionClosed) {
            console.log('🔄 Connection closed, reconnecting in 10s...');
            setTimeout(() => this.connect(), 10000);
          } else if (statusCode === DisconnectReason.timedOut) {
            console.log('⏱️  Timed out, reconnecting in 5s...');
            setTimeout(() => this.connect(), 5000);
          } else {
            console.log('🔄 Reconnecting in 5s...');
            setTimeout(() => this.connect(), 5000);
          }
        }
      });

      // Credentials update
      this.sock.ev.on('creds.update', saveCreds);

      // Messages handler (your bot logic goes here)
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message) continue;
          if (msg.key.fromMe) continue;

          const from = msg.key.remoteJid;
          const text = msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || '';

          console.log(`📨 Message from ${from}: ${text}`);

          // Example: Respond to !ping
          if (text === '!ping') {
            await this.sock.sendMessage(from, {
              text: '🏓 Pong! Bot is online!'
            });
          }

          // Example: Respond to !status
          if (text === '!status') {
            const uptime = process.uptime();
            await this.sock.sendMessage(from, {
              text: `📊 *Bot Status*\n\n` +
                    `✅ Online\n` +
                    `⏱️ Uptime: ${Math.floor(uptime)}s\n` +
                    `📱 Phone: ${this.sock.user.id.split(':')[0]}\n` +
                    `🆔 Session: ${this.sessionId}`
            });
          }

          // Add more commands here...
        }
      });

      return this.sock;

    } catch (error) {
      console.error('\n❌ Failed to connect:', error.message);
      throw error;
    }
  }

  /**
   * Get the socket instance
   */
  getSocket() {
    return this.sock;
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect() {
    if (this.sock) {
      await this.sock.logout();
      console.log('👋 Bot disconnected');
    }
  }
}

module.exports = SessionLoader;
