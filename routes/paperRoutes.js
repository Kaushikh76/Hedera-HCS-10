const express = require('express');
const { TopicCreateTransaction } = require('@hashgraph/sdk');
const router = express.Router();

// Import the PaperDocument model
const PaperDocument = require('../models/PaperDocument');

// Simple health check endpoint for testing
router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Paper routes are working' });
});

// Get all papers endpoint
router.get('/', async (req, res) => {
  try {
    const papers = await PaperDocument.find({}, { 
      paperId: 1, 
      title: 1,
      authors: 1,
      abstract: 1,
      keywords: 1,
      publisherId: 1,
      fee: 1,
      publishDate: 1,
      accessCount: 1
    });
    res.json(papers);
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// Get paper by ID endpoint
router.get('/:id', async (req, res) => {
  try {
    const paper = await PaperDocument.findOne({ paperId: req.params.id });
    if (!paper) {
      return res.status(404).json({ error: true, message: 'Paper not found' });
    }
    res.json(paper);
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// Upload paper endpoint
router.post('/upload', (req, res) => {
  // Access the upload middleware
  const upload = req.app.locals.upload;
  
  if (!upload) {
    return res.status(500).json({ 
      error: true, 
      message: 'File upload not available. Server may still be initializing.' 
    });
  }
  
  // Use the single file upload middleware
  upload.single('file')(req, res, async function(err) {
    if (err) {
      console.error('File upload error:', err);
      return res.status(400).json({ error: true, message: err.message });
    }
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: true, message: 'No file uploaded' });
      }
      
      // Get Hedera client and main topic ID from app locals
      const client = req.app.locals.hederaClient;
      const mainTopicId = req.app.locals.mainTopicId;
      
      if (!client || !mainTopicId) {
        return res.status(500).json({ 
          error: true, 
          message: 'Server not properly initialized with Hedera client' 
        });
      }
      
      // Process authors and keywords arrays
      let authors = [];
      let keywords = [];
      
      if (req.body.authors) {
        authors = Array.isArray(req.body.authors) 
          ? req.body.authors 
          : (req.body['authors[]'] ? (Array.isArray(req.body['authors[]']) ? req.body['authors[]'] : [req.body['authors[]']]) : []);
      }
      
      if (req.body.keywords) {
        keywords = Array.isArray(req.body.keywords) 
          ? req.body.keywords 
          : (req.body['keywords[]'] ? (Array.isArray(req.body['keywords[]']) ? req.body['keywords[]'] : [req.body['keywords[]']]) : []);
      }
      
      // Create a new content topic for the paper
      const topicTx = await new TopicCreateTransaction()
        .setAdminKey(client.operatorPublicKey)
        .setSubmitKey(client.operatorPublicKey)
        .setTopicMemo(`DeSci Paper Content: ${req.body.title}`)
        .execute(client);
      
      const receipt = await topicTx.getReceipt(client);
      const contentTopicId = receipt.topicId.toString();
      
      // Create a new paper document with file information
      const newPaper = new PaperDocument({
        paperId: req.body.paperId,
        title: req.body.title,
        authors: authors,
        abstract: req.body.abstract,
        keywords: keywords,
        publisherId: req.body.publisherId,
        fee: parseFloat(req.body.fee) || 10,
        contentTopicId: contentTopicId,
        fileId: req.file.id,
        filename: req.file.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        uploadDate: new Date()
      });
      
      await newPaper.save();
      
      // Return success response with paper details
      res.status(201).json({
        success: true,
        message: 'Paper uploaded successfully',
        paper: {
          paperId: newPaper.paperId,
          title: newPaper.title,
          contentTopicId: newPaper.contentTopicId
        }
      });
    } catch (error) {
      console.error('Error processing paper upload:', error);
      res.status(500).json({ error: true, message: error.message });
    }
  });
});

// Simple paper creation endpoint (without file upload)
router.post('/', async (req, res) => {
  try {
    const {
      paperId,
      title,
      authors,
      abstract,
      keywords,
      publisherId,
      fee
    } = req.body;
    
    if (!paperId || !title || !authors || !abstract || !publisherId) {
      return res.status(400).json({ 
        error: true, 
        message: 'Missing required fields' 
      });
    }
    
    // Create a new paper document without file
    const newPaper = new PaperDocument({
      paperId,
      title,
      authors: Array.isArray(authors) ? authors : [authors],
      abstract,
      keywords: Array.isArray(keywords) ? keywords : (keywords ? [keywords] : []),
      publisherId,
      fee: parseFloat(fee) || 10,
      contentTopicId: req.app.locals.mainTopicId // Use main topic for metadata-only papers
    });
    
    await newPaper.save();
    
    res.status(201).json({
      success: true,
      message: 'Paper metadata created successfully',
      paper: {
        paperId: newPaper.paperId,
        title: newPaper.title
      }
    });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

module.exports = router;