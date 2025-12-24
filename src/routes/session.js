const express = require('express');
const router = express.Router();
const Session = require('../models/Session');

// GET session by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const session = await Session.findOne({ sessionId: id });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    res.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        phoneNumber: session.phoneNumber,
        status: session.status,
        data: session.data,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated
      }
    });

  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// UPDATE session (for bot to update session data)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = req.body;

    const session = await Session.findOne({ sessionId: id });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    session.data = data;
    session.lastUpdated = new Date();
    await session.save();

    res.json({
      success: true,
      message: 'Session updated successfully'
    });

  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update session'
    });
  }
});

// VALIDATE session
router.get('/validate/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const session = await Session.findOne({ sessionId: id });
    
    if (!session) {
      return res.json({ valid: false, message: 'Session not found' });
    }

    const now = new Date();
    const isExpired = session.expiresAt < now;
    const isActive = session.status === 'active';

    res.json({
      valid: !isExpired && isActive,
      status: session.status,
      expiresAt: session.expiresAt,
      isExpired
    });

  } catch (error) {
    console.error('Error validating session:', error);
    res.status(500).json({ valid: false, message: 'Error validating session' });
  }
});

// DELETE session
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await Session.deleteOne({ sessionId: id });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    res.json({
      success: true,
      message: 'Session deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete session'
    });
  }
});

// LIST all sessions
router.get('/list/all', async (req, res) => {
  try {
    const sessions = await Session.find({})
      .select('sessionId phoneNumber status expiresAt createdAt')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: sessions.length,
      sessions
    });

  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list sessions'
    });
  }
});

module.exports = router;
