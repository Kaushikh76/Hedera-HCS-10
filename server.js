// server.js
// Production-ready DeSci Platform with Model Context Protocol (MCP) for Hedera

require('dotenv').config(); // Load environment variables from .env

const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const { GridFsStorage } = require('multer-gridfs-storage');
const {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicInfoQuery,
  PrivateKey,
  AccountId
} = require('@hashgraph/sdk');
const { initializePlatformToken } = require('./utils/token');

// Import models - Make sure to create this file as described
require('./models/PaperDocument');

// Initialize the Express app
const app = express();

// Security and middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(morgan('dev')); // Logging
app.use(bodyParser.json({ limit: '50mb' })); // Parse JSON bodies with increased limit for document content
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' })); // Parse URL-encoded bodies

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Setup GridFS for large file storage
const conn = mongoose.connection;
let gfs;

// Important: Wait for MongoDB connection before initializing GridFS
conn.once('open', () => {
  gfs = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: 'papers' });
  app.locals.gfs = gfs; // Make GridFS available to routes
  console.log('GridFS initialized for paper storage');
  
  // Setup Multer GridFS storage - IMPORTANT: Initialize this AFTER MongoDB connection is established
  const storage = new GridFsStorage({
    url: process.env.MONGODB_URI,
    options: { 
      useNewUrlParser: true,
      useUnifiedTopology: true
    },
    file: (req, file) => {
      return {
        filename: `${Date.now()}-${file.originalname}`,
        bucketName: 'papers',
        metadata: { originalname: file.originalname }
      };
    }
  });
  
  // Create and attach the upload middleware AFTER storage is initialized
  const upload = multer({ 
    storage,
    limits: { fileSize: 30 * 1024 * 1024 }, // 30MB limit for 20-30 page documents
    fileFilter: (req, file, cb) => {
      // Accept pdf, docx, txt, md and research-oriented file types
      const filetypes = /pdf|docx|txt|md|tex|csv|xlsx|zip/;
      const mimetype = filetypes.test(file.mimetype);
      const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
      
      if (mimetype && extname) {
        return cb(null, true);
      } else {
        cb(new Error('Invalid file type. Allowed types: PDF, DOCX, TXT, MD, TEX, CSV, XLSX, ZIP'));
      }
    }
  });
  
  // Make upload middleware available to routes
  app.locals.upload = upload;
});

// Hedera client setup
const getClient = async () => {
  if (!process.env.OPERATOR_ADDRESS || !process.env.OPERATOR_KEY) {
    throw new Error("Set EVM Address and Private Key in .env");
  }
  
  const client = Client.forTestnet();
  
  if (process.env.OPERATOR_ID && process.env.OPERATOR_KEY) {
    // Use account ID if available
    client.setOperator(process.env.OPERATOR_ID, process.env.OPERATOR_KEY);
  } else {
    // Use EVM address if account ID not available
    const accountId = await AccountId.fromEvmAddress(0, 0, process.env.OPERATOR_ADDRESS)
      .populateAccountNum(client);
    const privateKey = PrivateKey.fromStringECDSA(process.env.OPERATOR_KEY);
    client.setOperator(accountId, privateKey);
  }
  
  console.log(`Initialized Hedera client with operator: ${client.operatorAccountId}`);
  return client;
};

// Initialize or get the main registry topic
const getOrCreateMainTopic = async (client) => {
  try {
    // Try to get existing topic if specified in env
    if (process.env.MAIN_TOPIC_ID) {
      try {
        const topicInfo = await new TopicInfoQuery()
          .setTopicId(process.env.MAIN_TOPIC_ID)
          .execute(client);
        
        console.log(`Using existing main registry topic: ${process.env.MAIN_TOPIC_ID}`);
        return process.env.MAIN_TOPIC_ID;
      } catch (error) {
        console.warn(`Could not find specified main topic: ${error.message}`);
      }
    }
    
    // Create new topic if not found
    console.log('Creating new main registry topic...');
    const tx = await new TopicCreateTransaction()
      .setAdminKey(client.operatorPublicKey)
      .setSubmitKey(client.operatorPublicKey)
      .setTopicMemo("DeSci Paper Registry")
      .execute(client);
    
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId.toString();
    
    console.log(`Created new main registry topic: ${topicId}`);
    return topicId;
  } catch (error) {
    console.error('Error getting/creating main topic:', error);
    throw error;
  }
};

// Import routes - After GridFS is initialized
const paperRoutes = require('./routes/paperRoutes');
const chatRoutes = require('./routes/chatRoutes');

// Set up routes
app.use('/api/papers', paperRoutes);
app.use('/api/chat', chatRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'DeSci Platform API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: true,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Server error occurred'
  });
});

// Initialize Hedera and start the server
const startServer = async () => {
  try {
    // Initialize Hedera client
    console.log('Initializing Hedera client...');
    const client = await getClient();
    
    // Get or create main registry topic
    const mainTopicId = await getOrCreateMainTopic(client);
    
    // Initialize platform token if specified in env
    if (process.env.PLATFORM_TOKEN_NAME && process.env.PLATFORM_TOKEN_SYMBOL) {
      console.log('Creating platform token...');
      const platformTokenId = await initializePlatformToken(
        client, 
        process.env.PLATFORM_TOKEN_NAME, 
        process.env.PLATFORM_TOKEN_SYMBOL,
        process.env.INITIAL_SUPPLY || 100000
      );
      console.log(`Platform token created with ID: ${platformTokenId}`);
      
      // Store token ID in global app context for later use
      app.locals.platformTokenId = platformTokenId;
    }
    
    // Store client and topic ID in app locals for use in routes
    app.locals.hederaClient = client;
    app.locals.mainTopicId = mainTopicId;
    
    // Define the port
    const PORT = process.env.PORT || 3000;
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`DeSci Platform server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
      console.log(`Main registry topic ID: ${mainTopicId}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app; // Export for testing