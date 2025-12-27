require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const connectDB = require('./src/config/database');
const BaileysScanner = require('./src/services/baileysScanner');
const sessionRoutes = require('./src/routes/session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('src/public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Health check
app.get('/health', (req, res) => {
  const scannerService = req.app.get('scannerService');
  res.json({
    status: 'ok',
    service: 'DEAD-X-SESSION-SCANNER',
    version: '2.0.0',
    library: 'Baileys v6.7.8',
    activeScans: scannerService ? scannerService.getActiveScans() : 0,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Routes
app.get('/', (req, res) => {
  res.render('index', { 
    title: 'DEAD-X Session Scanner - Home' 
  });
});

app.get('/scan', (req, res) => {
  res.render('scan', { 
    title: 'Scan QR Code - DEAD-X Scanner' 
  });
});

// Initialize Baileys scanner
const scannerService = new BaileysScanner(io);
app.set('scannerService', scannerService);

// API routes
app.use('/session', sessionRoutes);

// Socket.IO
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('start-scan', async (data) => {
    try {
      // GENERATE FRESH SESSION ID WITH TIMESTAMP
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8).toUpperCase();
      const sessionId = `DEADX-${timestamp}-${random}`;
      
      console.log(`📱 Starting Baileys scan for ${sessionId}`);
      
      await scannerService.startScan(sessionId, socket.id);
      
    } catch (error) {
      console.error('Error starting scan:', error);
      socket.emit('error', {
        message: 'Failed to start scan: ' + error.message
      });
    }
  });

  socket.on('stop-scan', async (data) => {
    try {
      const { sessionId } = data;
      await scannerService.stopScan(sessionId);
      socket.emit('scan-stopped', { sessionId });
    } catch (error) {
      console.error('Error stopping scan:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

async function start() {
  try {
    console.log('\n╔═══════════════════════════════════════╗');
    console.log('║  💀 DEAD-X SESSION SCANNER v2.0.0    ║');
    console.log('║       Powered by Baileys 🚀          ║');
    console.log('╚═══════════════════════════════════════╝\n');

    console.log('🔄 Connecting to MongoDB...');
    await connectDB();

    server.listen(PORT, () => {
      console.log(`✅ Baileys scanner running on port ${PORT}`);
      console.log(`✅ Health: http://localhost:${PORT}/health`);
      console.log(`✅ QR generation: ~2 seconds (instant!)`);
      console.log(`✅ No Chromium needed!`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Failed to start scanner:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await scannerService.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received...');
  await scannerService.cleanup();
  process.exit(0);
});

start();
