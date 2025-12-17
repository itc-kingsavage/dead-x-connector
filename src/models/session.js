const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  phoneNumber: {
    type: String,
    default: null
  },
  sessionData: {
    type: String, // Encrypted JSON string
    required: true
  },
  botName: {
    type: String,
    default: 'DEAD-X-BOT'
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'expired', 'revoked'],
    default: 'pending'
  },
  qrCode: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  },
  metadata: {
    userAgent: String,
    ipAddress: String,
    deviceInfo: Object
  }
}, {
  timestamps: true
});

// Index for auto-deletion of expired sessions
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Methods
sessionSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

sessionSchema.methods.updateLastUsed = function() {
  this.lastUsed = new Date();
  return this.save();
};

// Static methods
sessionSchema.statics.findBySessionId = function(sessionId) {
  return this.findOne({ sessionId, status: { $ne: 'expired' } });
};

sessionSchema.statics.cleanupExpired = async function() {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
  return result.deletedCount;
};

module.exports = mongoose.model('Session', sessionSchema);
