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
// Use 127.0.0.1 (IPv4) instead of localhost to avoid IPv6 issues
const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:3000';

if (!OPENAI_API_KEY) {
  console.error('Please set OPENAI_API_KEY in your .env file');
  process.exit(1);
}

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Set up an axios instance with longer timeout for uploads
const apiClient = axios.create({
  baseURL: SERVER_URL,
  timeout: 30000, // 30 seconds timeout
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Upload a paper file and metadata to the MCP server
 */
async function uploadPaper() {
  try {
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

    console.log(`Uploading paper "${answers.title}"...`);
    console.log(`File: ${answers.filePath}`);
    
    // Create form data with proper headers
    const form = new FormData();
    const fileStream = fs.createReadStream(path.resolve(answers.filePath));
    
    // Add the file with explicit filename
    form.append('file', fileStream, {
      filename: path.basename(answers.filePath),
      contentType: getContentType(answers.filePath)
    });
    
    // Add metadata fields
    form.append('paperId', answers.paperId);
    form.append('title', answers.title);
    
    // Handle arrays properly
    const authors = answers.authors.split(',').map(author => author.trim());
    authors.forEach(author => form.append('authors[]', author));
    
    form.append('abstract', answers.abstract);
    
    const keywords = answers.keywords.split(',').map(keyword => keyword.trim());
    keywords.forEach(keyword => form.append('keywords[]', keyword));
    
    form.append('publisherId', answers.publisherId);
    form.append('fee', answers.fee);

    console.log(`Sending request to ${SERVER_URL}/api/papers/upload`);
    
    // Send with appropriate headers and longer timeout
    const response = await axios.post(
      `${SERVER_URL}/api/papers/upload`,
      form,
      { 
        headers: {
          ...form.getHeaders(),
          'Connection': 'keep-alive'
        },
        timeout: 60000, // 60 seconds for large files
        maxContentLength: 50 * 1024 * 1024, // Allow up to 50MB
        maxBodyLength: 50 * 1024 * 1024
      }
    );
    
    console.log('Upload successful:', response.data);
  } catch (err) {
    console.error('Upload failed:', err.message);
    
    // More detailed error logging
    if (err.response) {
      // Server responded with non-2xx status
      console.error('Server response:', err.response.data);
      console.error('Status code:', err.response.status);
    } else if (err.request) {
      // Request was made but no response received
      console.error('No response received. The server might be down or the connection timed out.');
    } else {
      // Error in setting up the request
      console.error('Error setting up request:', err.message);
    }
  }
}

/**
 * Get content type based on file extension
 */
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip'
  };
  
  return contentTypes[ext] || 'application/octet-stream';
}

/**
 * Chat with the MCP server via the chat endpoint
 */
async function chatWithServer() {
  try {
    // Test connection before starting chat
    await apiClient.get('/health');
    console.log('Connected to server. Starting chat session...');
    
    while (true) {
      const { message } = await inquirer.prompt([
        { type: 'input', name: 'message', message: 'You:' }
      ]);
      
      if (message.toLowerCase() === 'exit') {
        console.log('Goodbye!');
        break;
      }
      
      try {
        const res = await apiClient.post('/api/chat', { message });
        console.log('Server:', res.data.reply || res.data);
      } catch (err) {
        console.error('Chat error:', err.message);
        
        if (err.response) {
          console.error('Server response:', err.response.data);
        } else if (err.request) {
          console.error('No response received from server.');
        }
        
        const { retry } = await inquirer.prompt([
          { type: 'confirm', name: 'retry', message: 'Would you like to try again?', default: true }
        ]);
        
        if (!retry) break;
      }
    }
  } catch (err) {
    console.error('Error connecting to server:', err.message);
    console.log('Please make sure the server is running at:', SERVER_URL);
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
  console.log(`DeSci Platform Agent - connecting to ${SERVER_URL}`);
  console.log('----------------------------------------');
  
  // Check if server is available
  try {
    await axios.get(`${SERVER_URL}/health`, { timeout: 5000 });
    console.log('Connected to server successfully.');
  } catch (err) {
    console.warn(`Warning: Could not connect to server at ${SERVER_URL}`);
    console.warn('Make sure the server is running before using upload or chat features.');
    console.warn('Error details:', err.message);
  }
  
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