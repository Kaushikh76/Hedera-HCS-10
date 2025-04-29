const mongoose = require('mongoose');

// Document schema for papers
const PaperDocumentSchema = new mongoose.Schema({
  // Original MCP fields
  filename: String,
  fileId: mongoose.Schema.Types.ObjectId,
  originalname: String,
  mimetype: String,
  size: Number,
  uploadDate: Date,
  topicId: String,
  
  // DeSci specific fields
  paperId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  authors: [{
    type: String,
    required: true
  }],
  abstract: {
    type: String,
    required: true
  },
  keywords: [{
    type: String
  }],
  contentTopicId: {
    type: String,
    required: true
  },
  publisherId: {
    type: String,
    required: true
  },
  fee: {
    type: Number,
    required: true,
    default: 10
  },
  publishDate: {
    type: Date,
    default: Date.now
  },
  accessCount: {
    type: Number,
    default: 0
  },
  lastAccessedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Create a text index for search functionality
PaperDocumentSchema.index({
  title: 'text',
  abstract: 'text',
  keywords: 'text'
});

// Increments the access count and updates last accessed time
PaperDocumentSchema.methods.recordAccess = async function() {
  this.accessCount++;
  this.lastAccessedAt = new Date();
  return this.save();
};

// Static method to find papers by search query
PaperDocumentSchema.statics.searchPapers = async function(query) {
  if (!query || query.trim() === '') {
    return this.find({}, { content: 0 }); // Exclude content for listing
  }
  
  return this.find(
    { $text: { $search: query } },
    { score: { $meta: "textScore" } } // Include text match score
  ).sort({ score: { $meta: "textScore" } });
};

// Register the model
const PaperDocument = mongoose.model('PaperDocument', PaperDocumentSchema);

module.exports = PaperDocument;