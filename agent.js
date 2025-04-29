#!/usr/bin/env node
// agent.js
// CommonJS AI Agent for interacting with an MCP server and OpenAI LLM

require('dotenv').config();

// CommonJS-compatible OpenAI import
const OpenAI = require('openai').default;
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const inquirer = require('inquirer');

// Load environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

if (!OPENAI_API_KEY) {
  console.error('Please set OPENAI_API_KEY in your .env file');
  process.exit(1);
}

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/**
 * Upload a paper file and metadata to the MCP server
 */
async function uploadPaper() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'filePath',
      message: 'Path to the paper file (pdf, docx, txt, etc.):',
      validate: input => fs.existsSync(input) || 'File not found',
    },
    { type: 'input', name: 'paperId', message: 'Paper ID:' },
    { type: 'input', name: 'title', message: 'Title of the paper:' },
    { type: 'input', name: 'authors', message: 'Authors (comma-separated):' },
    { type: 'input', name: 'abstract', message: 'Abstract:' },
    { type: 'input', name: 'keywords', message: 'Keywords (comma-separated):' },
    { type: 'input', name: 'publisherId', message: 'Publisher ID:' },
    { type: 'number', name: 'fee', message: 'Access fee (numeric):', default: 10 },
  ]);

  const form = new FormData();
  form.append('file', fs.createReadStream(path.resolve(answers.filePath)));
  form.append('paperId', answers.paperId);
  form.append('title', answers.title);
  answers.authors.split(',').forEach(author => form.append('authors[]', author.trim()));
  form.append('abstract', answers.abstract);
  answers.keywords.split(',').forEach(keyword => form.append('keywords[]', keyword.trim()));
  form.append('publisherId', answers.publisherId);
  form.append('fee', answers.fee);

  try {
    const response = await axios.post(
      `${SERVER_URL}/api/papers/upload`,
      form,
      { headers: form.getHeaders() }
    );
    console.log('Upload successful:', response.data);
  } catch (err) {
    console.error('Upload failed:', err.response?.data || err.message);
  }
}

/**
 * Chat with the MCP server via the chat endpoint
 */
async function chatWithServer() {
  while (true) {
    const { message } = await inquirer.prompt([
      { type: 'input', name: 'message', message: 'You:' }
    ]);
    if (message.toLowerCase() === 'exit') {
      console.log('Goodbye!');
      break;
    }
    try {
      const res = await axios.post(
        `${SERVER_URL}/api/chat`,
        { message },
        { headers: { 'Content-Type': 'application/json' } }
      );
      console.log('Server:', res.data.reply || res.data);
    } catch (err) {
      console.error('Chat error:', err.response?.data || err.message);
      break;
    }
  }
}

/**
 * Use OpenAI to plan next actions or metadata for uploads
 */
async function planWithLLM(prompt) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are an assistant for interacting with the MCP server.' },
      { role: 'user', content: prompt }
    ],
  });
  return response.choices[0].message.content;
}

async function main() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: ['Upload a Paper', 'Chat with Server', 'Exit'],
    }
  ]);

  if (action === 'Upload a Paper') {
    await uploadPaper();
  } else if (action === 'Chat with Server') {
    await chatWithServer();
  } else {
    console.log('Exiting agent.');
    process.exit(0);
  }

  // Loop back
  await main();
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});