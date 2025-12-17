require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const connectDB = require('./src/config/database');

// Import routes
const scanRoutes = require('./src/routes/scan');
const sessionRoutes = require('./src/routes/session');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS || '*',
    methods: ['GET', 'POST']
  }
});

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src/public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make io accessible to routes
app.set('io', io);

// Routes
app.get('/', (req, res) => {
  res.render('index', { title: 'DEAD-X-BOT Session Scanner' });
});

app.use('/scan', scanRoutes);
app.use('/session', sessionRoutes);

// Health check for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'DEAD-X-BOT Scanner is running',
    timestamp: new Date().toISOString()
  });
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { 
    message: 'Page not found',
    error: { status: 404 }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   DEAD-X-BOT SESSION SCANNER          ║
  ║   Server running on port ${PORT}        ║
  ║   Environment: ${process.env.NODE_ENV || 'development'}           ║
  ╚═══════════════════════════════════════╝
  `);
});
