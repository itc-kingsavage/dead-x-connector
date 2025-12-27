const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    console.log('🔄 Attempting MongoDB connection...');
    console.log('📍 URI:', process.env.MONGODB_URI ? 'Set (hidden)' : 'NOT SET!');
    
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set!');
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log(`✓ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    console.log(`🔌 Ready State: ${conn.connection.readyState}`);
    
    // Test write permission
    try {
      const testCollection = conn.connection.db.collection('test');
      await testCollection.insertOne({ test: 'write permission check', timestamp: new Date() });
      await testCollection.deleteOne({ test: 'write permission check' });
      console.log('✅ Write permissions verified');
    } catch (writeError) {
      console.error('❌ Write permission test failed:', writeError.message);
    }
    
    return conn;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
};

// Monitor connection events
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

module.exports = connectDB;
