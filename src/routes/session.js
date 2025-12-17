const express = require('express');
const router = express.Router();
const sessionManager = require('../services/sessionManager');

// Get session data (for DEAD-X-BOT to use)
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionData = await sessionManager.validateSession(sessionId);

    res.json({
      success: true,
      session: sessionData
    });

  } catch (error) {
    res.status(404).json({
      success: false,
      error: 'Session not found or invalid',
      message: error.message
    });
  }
});

// Validate session (check if still active)
router.get('/validate/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await sessionManager.getSession(sessionId);

    const isValid = !session.isExpired() && session.status === 'active';

    res.json({
      success: true,
      valid: isValid,
      sessionId: session.sessionId,
      status: session.status,
      expiresAt: session.expiresAt
    });

  } catch (error) {
    res.status(404).json({
      success: false,
      valid: false,
      error: 'Session not found',
      message: error.message
    });
  }
});

// Delete/revoke session
router.delete('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await sessionManager.deleteSession(sessionId);

    res.json({
      success: true,
      message: result.message
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to delete session',
      message: error.message
    });
  }
});

// List all active sessions (optional - for admin panel)
router.get('/list/all', async (req, res) => {
  try {
    const Session = require('../models/Session');
    const sessions = await Session.find({ status: 'active' })
      .select('sessionId phoneNumber status createdAt expiresAt')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      count: sessions.length,
      sessions
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions',
      message: error.message
    });
  }
});

module.exports = router;
