/**
 * Recall.ai Stub Server for Timtam Local Development
 *
 * This server mocks Recall.ai API endpoints and provides a web UI
 * for manually sending transcripts during local development.
 *
 * Reference: https://docs.recall.ai/reference/
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// In-memory storage (for stub purposes)
const bots = new Map(); // botId -> bot object
const chatMessages = new Map(); // botId -> messages array

const PORT = process.env.PORT || 8080;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://api-server:3000/recall/webhook';

/**
 * POST /api/v1/bot/
 * Create a bot (join meeting)
 *
 * Reference: https://docs.recall.ai/reference/create-bot
 */
app.post('/api/v1/bot/', (req, res) => {
  console.log('[STUB MODE] POST /api/v1/bot/ - Creating bot');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  const { meeting_url, bot_name, recording_mode, recording_mode_options } = req.body;

  // Validate meeting URL - only http://localhost is supported in stub mode
  if (!meeting_url || !meeting_url.includes('http://localhost')) {
    console.log('[STUB MODE] Rejected: Only http://localhost meetings are supported');
    return res.status(400).json({
      error: 'Only http://localhost meetings are supported in stub mode',
      detail: 'Please use "http://localhost" as the meeting URL when creating a meeting in local dev mode'
    });
  }

  const bot = {
    id: `bot_${uuidv4()}`,
    meeting_url,
    bot_name: bot_name || 'Timtam AI (Stub)',
    status: 'in_meeting',
    status_message: 'Stub bot is ready',
    created_at: new Date().toISOString(),
    recording_mode: recording_mode || 'speaker_view',
    recording_mode_options: recording_mode_options || {},
    join_at: new Date().toISOString(),
  };

  bots.set(bot.id, bot);
  chatMessages.set(bot.id, []);

  console.log(`[STUB MODE] Bot created: ${bot.id}`);

  // Notify UI via WebSocket
  io.emit('bot_created', bot);

  res.status(200).json(bot);
});

/**
 * GET /api/v1/bot/:bot_id/
 * Get bot information
 *
 * Reference: https://docs.recall.ai/reference/get-bot
 */
app.get('/api/v1/bot/:bot_id/', (req, res) => {
  const { bot_id } = req.params;
  console.log(`[STUB MODE] GET /api/v1/bot/${bot_id}/`);

  const bot = bots.get(bot_id);
  if (!bot) {
    console.log(`[STUB MODE] Bot not found: ${bot_id}`);
    return res.status(404).json({
      error: 'Bot not found',
      detail: `No bot found with id: ${bot_id}`
    });
  }

  res.status(200).json(bot);
});

/**
 * GET /api/v1/bot/
 * List all bots
 */
app.get('/api/v1/bot/', (req, res) => {
  console.log('[STUB MODE] GET /api/v1/bot/ - Listing all bots');

  const botsList = Array.from(bots.values());

  res.status(200).json({
    results: botsList,
    count: botsList.length
  });
});

/**
 * POST /api/v1/bot/:bot_id/send_chat_message/
 * Send a chat message to the meeting
 *
 * This is called by the Orchestrator to send AI-generated responses
 * back to the meeting via RecallAdapter.
 *
 * Reference: https://docs.recall.ai/reference/send-chat-message
 */
app.post('/api/v1/bot/:bot_id/send_chat_message/', (req, res) => {
  const { bot_id } = req.params;
  const { message } = req.body;

  console.log(`[STUB MODE] POST /api/v1/bot/${bot_id}/send_chat_message/`);
  console.log('Message:', message);

  const bot = bots.get(bot_id);
  if (!bot) {
    console.log(`[STUB MODE] Bot not found: ${bot_id}`);
    return res.status(404).json({
      error: 'Bot not found',
      detail: `No bot found with id: ${bot_id}`
    });
  }

  // Store message in chat log
  const chatMessage = {
    timestamp: new Date().toISOString(),
    message,
    sender: 'AI'
  };
  chatMessages.get(bot_id).push(chatMessage);

  console.log(`[STUB MODE] AI message stored for bot ${bot_id}`);

  // Notify UI via WebSocket (for real-time display)
  io.emit('chat_message', {
    bot_id,
    message: chatMessage
  });

  res.status(200).json({ ok: true });
});

/**
 * POST /api/v1/bot/:bot_id/leave_call/
 * Make the bot leave the meeting
 *
 * Reference: https://docs.recall.ai/reference/leave-call
 */
app.post('/api/v1/bot/:bot_id/leave_call/', (req, res) => {
  const { bot_id } = req.params;

  console.log(`[STUB MODE] POST /api/v1/bot/${bot_id}/leave_call/`);

  const bot = bots.get(bot_id);
  if (!bot) {
    console.log(`[STUB MODE] Bot not found: ${bot_id}`);
    return res.status(404).json({
      error: 'Bot not found',
      detail: `No bot found with id: ${bot_id}`
    });
  }

  bot.status = 'done';
  bot.status_message = 'Bot left the meeting';
  bot.ended_at = new Date().toISOString();

  console.log(`[STUB MODE] Bot ${bot_id} left the meeting`);

  // Notify UI
  io.emit('bot_updated', bot);

  res.status(200).json({ ok: true });
});

/**
 * GET /api/chat/:bot_id
 * Get chat messages for a bot (stub-specific endpoint for UI)
 */
app.get('/api/chat/:bot_id', (req, res) => {
  const { bot_id } = req.params;

  const messages = chatMessages.get(bot_id) || [];
  res.status(200).json(messages);
});

/**
 * POST /api/send-transcript
 * Send transcript webhook (stub-specific endpoint for UI)
 *
 * This endpoint is called by the Web UI to simulate Recall.ai sending
 * a transcript webhook to our system.
 */
app.post('/api/send-transcript', async (req, res) => {
  const { bot_id, speaker_name, text } = req.body;

  console.log(`[STUB MODE] Sending transcript webhook for bot ${bot_id}`);
  console.log(`Speaker: ${speaker_name}, Text: ${text}`);

  const bot = bots.get(bot_id);
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  // Build Recall.ai webhook payload format
  // Reference: https://docs.recall.ai/docs/webhooks#transcript-data
  const payload = {
    event: 'transcript.data',
    data: {
      bot: {
        id: bot_id,
        metadata: {}
      },
      data: {
        words: text.split('').map((char, i) => ({
          text: char,
          start_timestamp: {
            relative: i * 100,
            absolute: new Date(Date.now() + i * 100).toISOString()
          },
          end_timestamp: {
            relative: (i + 1) * 100,
            absolute: new Date(Date.now() + (i + 1) * 100).toISOString()
          }
        })),
        participant: {
          id: Math.floor(Math.random() * 1000),
          name: speaker_name,
          is_host: false,
          platform: 'stub'
        }
      },
      transcript: {
        id: `transcript_${uuidv4()}`,
        metadata: {}
      },
      realtime_endpoint: {
        id: 'endpoint_1',
        metadata: {}
      },
      recording: {
        id: 'recording_1',
        metadata: {}
      }
    }
  };

  // Store user message in chat log
  const userMessage = {
    timestamp: new Date().toISOString(),
    message: `${speaker_name}: ${text}`,
    sender: 'User'
  };
  chatMessages.get(bot_id).push(userMessage);

  // Send webhook to local API server
  try {
    const fetch = (await import('node-fetch')).default;
    const webhookRes = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (webhookRes.ok) {
      console.log(`[STUB MODE] Webhook sent successfully to ${WEBHOOK_URL}`);
      res.status(200).json({ ok: true, message: 'Transcript sent to webhook' });
    } else {
      const errorText = await webhookRes.text();
      console.error(`[STUB MODE] Webhook failed: ${WEBHOOK_URL} ${webhookRes.status} ${errorText}`);
      res.status(500).json({
        error: 'Webhook failed',
        detail: `Status: ${webhookRes.status}, ${errorText}`
      });
    }
  } catch (error) {
    console.error('[STUB MODE] Webhook error:', error);
    res.status(500).json({
      error: 'Failed to send webhook',
      detail: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    mode: 'STUB',
    bots: bots.size,
    message: 'Recall.ai Stub Server is running'
  });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('[STUB MODE] Client connected to WebSocket');

  socket.on('disconnect', () => {
    console.log('[STUB MODE] Client disconnected from WebSocket');
  });
});

// Start server
server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🤖 Recall.ai Stub Server - Timtam Local Development');
  console.log('='.repeat(60));
  console.log(`Server running at: http://localhost:${PORT}`);
  console.log(`Webhook endpoint: ${WEBHOOK_URL}`);
  console.log(`Mode: STUB (local development)`);
  console.log('='.repeat(60));
});
