// desci-agent.js
// AI Research Agent for DeSci Platform - Processes queries, quotes papers, and provides research insights

require('dotenv').config();
const OpenAI = require('openai');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const {
  Client,
  AccountId,
  PrivateKey,
  TopicMessageQuery,
  TopicMessageSubmitTransaction,
  TransferTransaction
} = require('@hashgraph/sdk');
const readline = require('readline');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize console interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Temporary cache for papers that have been paid for
const paidPapersCache = new Map();

// Paper document schema (should match the server's PaperDocument schema)
const PaperDocumentSchema = new mongoose.Schema({
  paperId: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  authors: [{ type: String, required: true }],
  abstract: { type: String, required: true },
  keywords: [{ type: String }],
  contentTopicId: { type: String, required: true },
  fileId: mongoose.Schema.Types.ObjectId,
  filename: String,
  originalname: String,
  mimetype: String,
  size: Number,
  publisherId: { type: String, required: true },
  fee: { type: Number, required: true, default: 10 },
  publishDate: { type: Date, default: Date.now },
  accessCount: { type: Number, default: 0 },
  lastAccessedAt: { type: Date }
});

// Create text index for search
PaperDocumentSchema.index({
  title: 'text',
  abstract: 'text',
  keywords: 'text'
});

// Static method to find papers by query
PaperDocumentSchema.statics.searchPapers = async function(query, limit = 5) {
  if (!query || query.trim() === '') {
    return this.find({}).limit(limit);
  }
  
  return this.find(
    { $text: { $search: query } },
    { score: { $meta: "textScore" } }
  )
  .sort({ score: { $meta: "textScore" } })
  .limit(limit);
};

const PaperDocument = mongoose.model('PaperDocument', PaperDocumentSchema);

// Chat session schema - Simple version for the agent
const ChatSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  messages: [{
    role: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  relatedPapers: [{
    paperId: String,
    title: String,
    fee: Number,
    contentTopicId: String
  }],
  paymentStatus: { type: String, default: 'pending' }, // pending, paid, failed
  quote: {
    papersCost: Number,
    platformFee: Number,
    totalCost: Number,
    papers: Array
  }
});

// Chat methods
ChatSchema.methods.addMessage = function(role, content) {
  this.messages.push({
    role,
    content,
    timestamp: new Date()
  });
  return this.save();
};

ChatSchema.methods.setRelatedPapers = function(papers) {
  this.relatedPapers = papers.map(paper => ({
    paperId: paper.paperId,
    title: paper.title,
    fee: paper.fee,
    contentTopicId: paper.contentTopicId
  }));
  return this.save();
};

ChatSchema.methods.calculateQuote = function(platformFeePercent = 5) {
  const papersCost = this.relatedPapers.reduce((total, paper) => total + paper.fee, 0);
  const platformFee = (papersCost * platformFeePercent) / 100;
  
  this.quote = {
    papersCost,
    platformFee,
    totalCost: papersCost + platformFee,
    papers: this.relatedPapers.map(paper => ({
      paperId: paper.paperId,
      title: paper.title,
      fee: paper.fee
    }))
  };
  
  return this.save();
};

ChatSchema.methods.setPaid = function() {
  this.paymentStatus = 'paid';
  return this.save();
};

const Chat = mongoose.model('Chat', ChatSchema);

/**
 * Initialize Hedera client
 */
const initializeClient = async () => {
  let client;

  // Use AccountId and PrivateKey if provided
  if (process.env.OPERATOR_ID && process.env.OPERATOR_KEY) {
    client = Client.forTestnet().setOperator(
      process.env.OPERATOR_ID,
      process.env.OPERATOR_KEY
    );
  } 
  // Use EVM address if Account ID not available
  else if (process.env.OPERATOR_ADDRESS && process.env.OPERATOR_KEY) {
    client = Client.forTestnet();
    const accountId = await AccountId.fromEvmAddress(0, 0, process.env.OPERATOR_ADDRESS)
      .populateAccountNum(client);
    const privateKey = PrivateKey.fromStringECDSA(process.env.OPERATOR_KEY);
    client.setOperator(accountId, privateKey);
  } else {
    throw new Error("Missing Hedera credentials in .env file");
  }

  return client;
};

/**
 * Connect to MongoDB
 */
const connectToMongoDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
};

/**
 * Search for relevant papers based on a query
 */
const searchRelevantPapers = async (query, limit = 5) => {
  return await PaperDocument.searchPapers(query, limit);
};

/**
 * Get paper content from GridFS
 */
const getPaperContent = async (fileId) => {
  return new Promise((resolve, reject) => {
    const gfs = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'papers'
    });
    
    const chunks = [];
    const downloadStream = gfs.openDownloadStream(fileId);
    
    downloadStream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    downloadStream.on('error', (error) => {
      reject(error);
    });
    
    downloadStream.on('end', () => {
      const content = Buffer.concat(chunks);
      resolve(content);
    });
  });
};

/**
 * Process payment for papers
 */
const processPayment = async (client, chatSession, tokenId) => {
  try {
    console.log("Processing payment...");
    
    // In a real implementation, you'd transfer tokens to all paper publishers
    // For this demo, we'll just simulate payment success
    
    // Update chat session to paid
    await chatSession.setPaid();
    
    // Add papers to paid cache
    chatSession.relatedPapers.forEach(paper => {
      paidPapersCache.set(paper.paperId, true);
    });
    
    return true;
  } catch (error) {
    console.error("Payment processing error:", error);
    return false;
  }
};

/**
 * Extract text from paper content
 */
const extractTextFromPaper = (content, mimeType) => {
  // In a production environment, you'd use proper libraries to parse PDFs, DOCXs, etc.
  // For this demo, we'll just convert to string
  return content.toString('utf8');
};

/**
 * Generate research response using AI
 */
const generateResearchResponse = async (query, papers, contents) => {
  try {
    // Prepare context from papers
    const context = papers.map((paper, index) => {
      const content = contents[index] || "Content not available";
      return `--- Paper: "${paper.title}" by ${paper.authors?.join(', ') || 'Unknown'} ---\n${content.slice(0, 2000)}...\n`;
    }).join('\n\n');
    
    // Generate response with OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Use appropriate model
      messages: [
        {
          role: "system",
          content: `You are a research assistant analyzing scientific papers. 
          Use information from the provided papers to answer the user's query. 
          When citing information, specify which paper it's from. 
          Here are excerpts from relevant papers:\n\n${context}`
        },
        {
          role: "user",
          content: query
        }
      ],
    });
    
    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error generating research response:", error);
    return "I'm sorry, I couldn't generate a research response due to an error.";
  }
};

/**
 * Main agent function
 */
const runAgent = async () => {
  try {
    // Connect to services
    await connectToMongoDB();
    const client = await initializeClient();
    
    console.log("DeSci Research Agent initialized");
    console.log("---------------------------------");
    console.log("Welcome to the DeSci Research Agent!");
    console.log("You can ask research questions, and I'll find relevant papers and provide insights.");
    console.log("Commands:");
    console.log("  /search [query] - Search for papers on a topic");
    console.log("  /quote - Get a quote for accessing the papers needed to answer your last query");
    console.log("  /pay - Pay for access to the papers");
    console.log("  /exit - Exit the agent");
    console.log("---------------------------------");
    
    // Create a new chat session
    const sessionId = `session-${Date.now()}`;
    let chatSession = new Chat({
      sessionId: sessionId,
      messages: []
    });
    await chatSession.save();
    
    // Main interaction loop
    const askQuestion = () => {
      rl.question("Ask a research question (or use a command): ", async (input) => {
        try {
          if (input.toLowerCase() === '/exit') {
            console.log("Thank you for using the DeSci Research Agent. Goodbye!");
            rl.close();
            setTimeout(() => process.exit(0), 500);
            return;
          }
          
          // Process commands
          if (input.toLowerCase().startsWith('/search')) {
            const query = input.replace('/search', '').trim();
            if (!query) {
              console.log("Please provide a search query.");
              return askQuestion();
            }
            
            console.log("Searching for papers...");
            const papers = await searchRelevantPapers(query);
            
            console.log("\nRelevant papers:");
            papers.forEach((paper, i) => {
              console.log(`${i+1}. "${paper.title}" by ${paper.authors?.join(', ') || 'Unknown'}`);
              console.log(`   Fee: ${paper.fee} tokens`);
              console.log(`   Abstract: ${paper.abstract?.substring(0, 100)}...`);
              console.log();
            });
            
            // Update chat session with papers
            await chatSession.setRelatedPapers(papers);
            await chatSession.addMessage('user', query);
            await chatSession.addMessage('system', `Found ${papers.length} relevant papers.`);
            
          } else if (input.toLowerCase() === '/quote') {
            if (!chatSession.relatedPapers || chatSession.relatedPapers.length === 0) {
              console.log("No papers selected yet. Please search for papers first.");
              return askQuestion();
            }
            
            // Generate quote
            await chatSession.calculateQuote();
            const quote = chatSession.quote;
            
            console.log("\nQuote for accessing research papers:");
            console.log(`Papers cost: ${quote.papersCost} tokens`);
            console.log(`Platform fee: ${quote.platformFee} tokens`);
            console.log(`Total cost: ${quote.totalCost} tokens`);
            console.log("\nPapers included:");
            
            quote.papers.forEach((paper, i) => {
              console.log(`${i+1}. "${paper.title}" - ${paper.fee} tokens`);
            });
            
            await chatSession.addMessage('system', `Quote generated: ${quote.totalCost} tokens total.`);
            
          } else if (input.toLowerCase() === '/pay') {
            if (!chatSession.quote) {
              console.log("No quote available. Please get a quote first.");
              return askQuestion();
            }
            
            if (chatSession.paymentStatus === 'paid') {
              console.log("You've already paid for these papers.");
            } else {
              // Process payment
              const success = await processPayment(client, chatSession, process.env.PLATFORM_TOKEN_ID);
              
              if (success) {
                console.log("Payment processed successfully!");
                console.log("Analyzing research papers...");
                
                // Get content for all papers
                const paperContents = await Promise.all(
                  chatSession.relatedPapers.map(async (paper) => {
                    try {
                      const paperDoc = await PaperDocument.findOne({ paperId: paper.paperId });
                      if (!paperDoc || !paperDoc.fileId) {
                        return "Content not available";
                      }
                      
                      const content = await getPaperContent(paperDoc.fileId);
                      return extractTextFromPaper(content, paperDoc.mimetype);
                    } catch (error) {
                      console.error(`Error retrieving content for paper ${paper.paperId}:`, error);
                      return "Error retrieving content";
                    }
                  })
                );
                
                // Find most recent question
                const recentQuestions = chatSession.messages
                  .filter(msg => msg.role === 'user')
                  .map(msg => msg.content);
                
                const lastQuestion = recentQuestions[recentQuestions.length - 1] || "Summarize the papers";
                
                // Generate research response
                const papers = await Promise.all(
                  chatSession.relatedPapers.map(paper => 
                    PaperDocument.findOne({ paperId: paper.paperId })
                  )
                );
                
                console.log("\nGenerating research response...");
                const researchResponse = await generateResearchResponse(lastQuestion, papers, paperContents);
                
                console.log("\n=== RESEARCH FINDINGS ===");
                console.log(researchResponse);
                console.log("=========================\n");
                
                await chatSession.addMessage('assistant', researchResponse);
              } else {
                console.log("Payment failed. Please try again.");
              }
            }
          } else {
            // Treat as a research question
            await chatSession.addMessage('user', input);
            
            console.log("Searching for relevant papers to answer your question...");
            const papers = await searchRelevantPapers(input);
            await chatSession.setRelatedPapers(papers);
            await chatSession.calculateQuote();
            
            console.log(`I found ${papers.length} papers that could help answer your question.`);
            console.log("Here are the most relevant papers:");
            
            papers.slice(0, 3).forEach((paper, i) => {
              console.log(`${i+1}. "${paper.title}" by ${paper.authors?.join(', ') || 'Unknown'}`);
            });
            
            console.log(`\nTo access these papers, you'll need to pay ${chatSession.quote.totalCost} tokens.`);
            console.log("Use /quote to see details or /pay to purchase access.");
          }
        } catch (error) {
          console.error("Error:", error);
        }
        
        // Continue the conversation
        askQuestion();
      });
    };
    
    askQuestion();
    
  } catch (error) {
    console.error("Agent initialization error:", error);
    process.exit(1);
  }
};

// Run the agent
runAgent().catch(console.error);