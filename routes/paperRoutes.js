const express = require('express');
const router = express.Router();

// Simple health check endpoint for testing
router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Paper routes are working' });
});

// Placeholder for paper endpoints
router.get('/', (req, res) => {
  res.json({ message: 'Get all papers endpoint' });
});

router.post('/', (req, res) => {
  res.json({ message: 'Upload paper endpoint' });
});

router.get('/:id', (req, res) => {
  res.json({ message: `Get paper with ID: ${req.params.id}` });
});

module.exports = router;
