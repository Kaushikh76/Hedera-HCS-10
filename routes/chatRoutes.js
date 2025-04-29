const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const mongoose = require('mongoose');

// Import PaperDocument model
const PaperDocument = require('../models/PaperDocument');

// Initialize OpenAI client if API key is available
let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

// Simple health check endpoint for testing
router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Chat routes are working' });
});

// Main chat endpoint - this is what your agent is trying to access
router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: true, message: 'No message provided' });
    }
    
    // Search for relevant papers based on the message
    let relevantPapers = [];
    try {
      relevantPapers = await PaperDocument.find(
        { $text: { $search: message } },
        { score: { $meta: "textScore" } }
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(3);
    } catch (err) {
      console.log('Paper search error (non-critical):', err.message);
    }
    
    // Generate a response
    let reply;
    if (openai) {
      // Use OpenAI for response if available
      const paperInfo = relevantPapers.map(paper => 
        `Paper: "${paper.title}" by ${paper.authors.join(', ')}. Abstract: ${paper.abstract.substring(0, 100)}...`
      ).join('\n\n');
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a helpful research assistant for the DeSci (Decentralized Science) platform. 
            ${relevantPapers.length > 0 ? 'Here are some relevant papers that might help answer the query:\n\n' + paperInfo : 'No specific papers were found on this topic.'}`
          },
          { role: "user", content: message }
        ]
      });
      
      reply = completion.choices[0].message.content;
    } else {
      // Simple fallback response if OpenAI is not available
      reply = `I received your message: "${message}". `;
      
      if (relevantPapers.length > 0) {
        reply += `I found ${relevantPapers.length} papers that might be relevant to your query:\n\n`;
        relevantPapers.forEach((paper, index) => {
          reply += `${index + 1}. "${paper.title}" by ${paper.authors.join(', ')}\n`;
          reply += `   Abstract: ${paper.abstract.substring(0, 150)}...\n\n`;
        });
        
        reply += `You can access these papers by paying the access fee with the /pay command.`;
      } else {
        reply += `I couldn't find any specific papers related to your query. Please try a different search term.`;
      }
    }
    
    res.json({
      reply,
      papers: relevantPapers.map(paper => ({
        paperId: paper.paperId,
        title: paper.title,
        authors: paper.authors,
        fee: paper.fee
      }))
    });
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    res.status(500).json({ error: true, message: error.message });
  }
});

// Create new chat session endpoint
router.post('/sessions', (req, res) => {
  res.json({ message: 'Create chat session endpoint' });
});

// Get user's chat sessions
router.get('/sessions/:userId', (req, res) => {
  res.json({ message: `Get sessions for user: ${req.params.userId}` });
});

// Send message to specific chat
router.post('/:chatId/message', (req, res) => {
  res.json({ message: `Send message to chat: ${req.params.chatId}` });
});

module.exports = router;