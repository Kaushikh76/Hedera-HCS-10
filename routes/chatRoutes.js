const express = require('express');
const router = express.Router();

// Simple health check endpoint for testing
router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Chat routes are working' });
});

// Placeholder for chat endpoints
router.post('/sessions', (req, res) => {
  res.json({ message: 'Create chat session endpoint' });
});

router.get('/sessions/:userId', (req, res) => {
  res.json({ message: `Get sessions for user: ${req.params.userId}` });
});

router.post('/:chatId/message', (req, res) => {
  res.json({ message: `Send message to chat: ${req.params.chatId}` });
});

module.exports = router;
