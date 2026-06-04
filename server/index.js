// Express API Server for Mamallma
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { db } from './db.js';
import { sendNotification, sendTestNotification } from './notifier.js';
import { summarizeText, summarizeReel } from './gemini.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Log incoming API requests for debugging
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});

// API - Status Endpoint
app.get('/api/status', (req, res) => {
  res.json({
    ...db.getStatus(),
    stats: db.getStats()
  });
});

app.post('/api/status', (req, res) => {
  const { status, details } = req.body;
  const updated = db.updateStatus(status, details);
  res.json(updated);
});

// API - Messages Endpoint
app.get('/api/messages', (req, res) => {
  res.json(db.getMessages());
});

// API - Settings Endpoints
app.get('/api/settings', (req, res) => {
  const settings = db.getSettings();
  // Return key with simple masking for safety, but allow saving
  res.json({
    ...settings,
    hasApiKey: !!settings.geminiApiKey,
    // Provide masked key for UI display
    maskedApiKey: settings.geminiApiKey 
      ? `${settings.geminiApiKey.substring(0, 6)}...${settings.geminiApiKey.substring(settings.geminiApiKey.length - 4)}`
      : ''
  });
});

app.post('/api/settings', (req, res) => {
  const newSettings = req.body;
  // If the key is updated, save it; if it is the masked placeholder, ignore it
  if (newSettings.geminiApiKey && newSettings.geminiApiKey.includes('...')) {
    delete newSettings.geminiApiKey;
  }
  const updated = db.saveSettings(newSettings);
  res.json({ success: true, settings: updated });
});

// API - Test Notification Endpoint
app.post('/api/test-notify', async (req, res) => {
  const { target } = req.body;
  try {
    console.log(`[API] Triggering test notification to: ${target || 'default settings'}`);
    await sendTestNotification(target);
    res.json({ success: true, message: 'Test message triggered successfully!' });
  } catch (err) {
    console.error('[API] Test notification failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API - Intercept Payload Endpoint (Invoked by Chrome Extension)
app.post('/api/intercept', async (req, res) => {
  const payload = req.body;
  
  if (!payload || !payload.itemId) {
    return res.status(400).json({ error: 'Invalid payload.' });
  }
  
  try {
    console.log(`[API] Processing intercepted message ID: ${payload.itemId} from @${payload.senderUsername}`);
    
    if (payload.rawItem) {
      try {
        const debugFilename = `raw_${payload.type}.json`;
        fs.writeFileSync(path.join(process.cwd(), debugFilename), JSON.stringify(payload.rawItem, null, 2), 'utf-8');
        console.log(`[API] Wrote raw item to ${debugFilename} for debugging.`);
      } catch (e) {
        console.error('[API] Failed to write debug file:', e.message);
      }
    }

    // Check if we have already saved this message to avoid duplicate processing
    const currentMessages = db.getMessages();
    if (currentMessages.some(m => m.itemId === payload.itemId)) {
      console.log(`[API] Message ${payload.itemId} already exists. Skipping.`);
      return res.json({ success: true, status: 'duplicate' });
    }

    let summaryText = '';
    
    // Generate AI Summary
    if (payload.type === 'text') {
      summaryText = await summarizeText(payload.senderUsername, payload.content);
    } else if (payload.type === 'reel') {
      summaryText = await summarizeReel(payload.senderUsername, payload);
    } else {
      summaryText = `📎 @${payload.senderUsername} sent an attachment (Unsupported type: ${payload.type})`;
    }

    // Send Outbound Notification
    console.log(`[API] Summary generated: "${summaryText.replace(/\n/g, ' ')}"`);
    console.log('[API] Dispatching text message notification...');
    let notifySuccess = false;
    try {
      notifySuccess = await sendNotification(summaryText);
    } catch (err) {
      console.error('[API] Outbound notification failed:', err.message);
    }

    // Save to Database
    const messageLogEntry = {
      itemId: payload.itemId,
      threadId: payload.threadId,
      senderUsername: payload.senderUsername,
      senderFullName: payload.senderFullName,
      timestamp: payload.timestamp,
      type: payload.type,
      content: payload.content,
      summary: summaryText,
      reelUrl: payload.reelUrl || null,
      reelCreator: payload.reelCreator || null,
      interceptedAt: Date.now(),
      notifiedAt: notifySuccess ? Date.now() : null
    };
    
    db.addMessage(messageLogEntry);
    
    res.json({ 
      success: true, 
      status: 'processed', 
      summary: summaryText, 
      notified: notifySuccess 
    });

  } catch (err) {
    console.error('[API] Error processing intercepted message:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve Dashboard static client files
const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  console.log(`[Server] Serving production dashboard from ${distPath}`);
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.log('[Server] Production dashboard build not found. Running in API-only server mode (Vite development dev-server should be used for UI).');
}

// Start Server
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 MAMALLMA SERVER IS RUNNING ON PORT ${PORT}`);
  console.log(`🤖 Send API requests to: http://localhost:${PORT}`);
  console.log(`=================================================`);
});
