require('dotenv').config();
const express = require('express');
const SessionLoader = require('./src/services/sessionLoader');
const connectDB = require('./src/config/database');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    sessionId: process.env.SESSION_ID
  });
});

// Start function
async function start() {
  try {
    console.log('\n╔═══════════════════════════════════════╗');
    console.log('║         💀 DEAD-X-BOT v2.0.0         ║');
    console.log('║       Powered by Baileys 🚀          ║');
    console.log('╚═══════════════════════════════════════╝\n');

    // Validate env vars
    if (!process.env.SCANNER_URL) {
      throw new Error('SCANNER_URL not set');
    }
    if (!process.env.SESSION_ID) {
      throw new Error('SESSION_ID not set');
    }

    console.log('✅ Environment validated\n');

    // Connect to MongoDB
    console.log('🔄 Connecting to MongoDB...');
    await connectDB();

    // Start HTTP server
    app.listen(PORT, () => {
      console.log(`✅ HTTP server running on port ${PORT}`);
      console.log('');
    });

    // Connect to WhatsApp
    const sessionLoader = new SessionLoader(
      process.env.SCANNER_URL,
      process.env.SESSION_ID
    );

    await sessionLoader.connect();

    console.log('\n✅ All systems operational!\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received...');
  process.exit(0);
});

start();
