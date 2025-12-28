require('dotenv').config();
const express = require('express');
const SessionLoader = require('./src/services/sessionLoader');
const connectDB = require('./src/config/database');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let whatsappSocket = null;

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'DEAD-X-BOT',
    version: '2.0.0',
    library: 'Baileys',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    whatsappConnected: whatsappSocket?.user ? true : false,
    sessionId: process.env.SESSION_ID
  });
});

app.get('/status', (req, res) => {
  if (!whatsappSocket || !whatsappSocket.user) {
    return res.json({
      botStatus: 'disconnected',
      message: 'Bot is not connected to WhatsApp'
    });
  }

  res.json({
    botStatus: 'connected',
    phone: whatsappSocket.user.id.split(':')[0],
    pushName: whatsappSocket.user.name,
    platform: whatsappSocket.user.platform || 'unknown',
    sessionId: process.env.SESSION_ID,
    uptime: Math.floor(process.uptime()) + 's',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'DEAD-X-BOT',
    version: '2.0.0',
    library: 'Baileys',
    developer: 'D3AD_XMILE',
    status: 'running',
    endpoints: {
      health: '/health',
      status: '/status'
    }
  });
});

async function handleMessage(sock, msg) {
  try {
    if (!msg.message) return;
    if (msg.key.fromMe) return;
    if (msg.key.remoteJid === 'status@broadcast') return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || 
                msg.message.extendedTextMessage?.text || 
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption || '';

    console.log(`📨 Message from ${from}: ${text}`);

    if (text.toLowerCase() === '!ping') {
      const startTime = Date.now();
      await sock.sendMessage(from, { 
        text: '🏓 Pong! Bot is online and working!' 
      });
      const latency = Date.now() - startTime;
      console.log(`✅ Responded to !ping in ${latency}ms`);
    }

    if (text.toLowerCase() === '!status') {
      const uptime = Math.floor(process.uptime());
      const statusMsg = 
        `📊 *DEAD-X-BOT Status*\n\n` +
        `📱 Phone: ${sock.user.id.split(':')[0]}\n` +
        `👤 Name: ${sock.user.name}\n` +
        `📦 Platform: ${sock.user.platform || 'WhatsApp'}\n` +
        `⏱️ Uptime: ${uptime}s\n` +
        `🆔 Session: ${process.env.SESSION_ID}\n\n` +
        `✅ Bot is fully operational!\n\n` +
        `🔥 Powered by Baileys`;
      
      await sock.sendMessage(from, { text: statusMsg });
    }

    if (text.toLowerCase() === '!help') {
      const helpMsg = 
        `💀 *DEAD-X-BOT Commands*\n\n` +
        `!ping - Test bot response\n` +
        `!status - Show bot status\n` +
        `!help - Show this message\n\n` +
        `🔥 Developed by D3AD_XMILE`;
      
      await sock.sendMessage(from, { text: helpMsg });
    }

  } catch (error) {
    console.error('❌ Error handling message:', error.message);
  }
}

async function start() {
  try {
    console.log('\n╔═══════════════════════════════════════╗');
    console.log('║                                       ║');
    console.log('║         💀 DEAD-X-BOT v2.0.0         ║');
    console.log('║                                       ║');
    console.log('║    WhatsApp Automation System         ║');
    console.log('║       Powered by Baileys 🚀          ║');
    console.log('║    Developer: D3AD_XMILE              ║');
    console.log('║                                       ║');
    console.log('╚═══════════════════════════════════════╝\n');

    const requiredEnvVars = ['SCANNER_URL', 'SESSION_ID', 'MONGODB_URI'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:');
      missingVars.forEach(varName => console.error(`   - ${varName}`));
      process.exit(1);
    }

    console.log('✅ Environment variables validated\n');

    console.log('🔄 Connecting to MongoDB...');
    await connectDB();

    app.listen(PORT, () => {
      console.log(`✅ HTTP server running on port ${PORT}`);
      console.log(`✅ Health check: http://localhost:${PORT}/health`);
      console.log('');
    });

    console.log('🔄 Initializing WhatsApp connection...\n');
    
    const sessionLoader = new SessionLoader(
      process.env.SCANNER_URL,
      process.env.SESSION_ID
    );

    whatsappSocket = await sessionLoader.connect();

    whatsappSocket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        await handleMessage(whatsappSocket, msg);
      }
    });

    console.log('\n✅ All systems operational!\n');
    console.log('💬 Bot is ready to receive messages!\n');

  } catch (error) {
    console.error('\n❌ Fatal error during startup:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (whatsappSocket) {
    try {
      await whatsappSocket.logout();
    } catch (error) {
      console.error('Error during logout:', error.message);
    }
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received...');
  if (whatsappSocket) {
    try {
      await whatsappSocket.logout();
    } catch (error) {
      console.error('Error during logout:', error.message);
    }
  }
  process.exit(0);
});

start();
