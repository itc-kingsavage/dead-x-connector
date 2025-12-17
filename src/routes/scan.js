const express = require('express');
const router = express.Router();
const sessionManager = require('../services/sessionManager');

// Display QR scanning page
router.get('/', (req, res) => {
  res.render('scan', { 
    title: 'Scan QR Code - DEAD-X-BOT',
    sessionId: null 
  });
});

// Start new scan session
router.post('/start', async (req, res) => {
  try {
    const io = req.app.get('io');
    const metadata = {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.connection.remoteAddress
    };

    const { sessionId } = await sessionManager.createSession(io, metadata);

    res.json({
      success: true,
      sessionId,
      message: 'Scan session started. Please scan the QR code.',
      socketRoom: `qr-${sessionId}`
    });

  } catch (error) {
    console.error('Error starting scan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start scan session',
      message: error.message
    });
  }
});

// Get scan status
router.get('/status/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await sessionManager.getSession(sessionId);

    res.json({
      success: true,
      sessionId: session.sessionId,
      status: session.status,
      phoneNumber: session.phoneNumber,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    });

  } catch (error) {
    res.status(404).json({
      success: false,
      error: 'Session not found',
      message: error.message
    });
  }
});

// Success page after scanning
router.get('/success/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await sessionManager.getSession(sessionId);

    res.render('success', {
      title: 'Session Created Successfully',
      sessionId: session.sessionId,
      phoneNumber: session.phoneNumber,
      expiresAt: session.expiresAt
    });

  } catch (error) {
    res.render('error', {
      message: 'Session not found',
      error: { status: 404 }
    });
  }
});

module.exports = router;
