// Pure-JS JSON file-based database for Mamallma
import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'data.json');

// Default initial database state
const DEFAULT_STATE = {
  settings: {
    geminiApiKey: '',
    targetPhoneOrEmail: '', // Your iMessage contact
    enableNotifications: true,
    reelSummaryStyle: 'concise', // 'concise' or 'detailed'
    savedTimePerReelMinutes: 15, // 15 minutes of doomscrolling saved per reel bypassed!
    notificationChannel: 'imessage', // 'imessage' or 'telegram'
    telegramBotToken: '',
    telegramChatId: ''
  },
  messages: [], // Array of intercepted DMs & summaries
  stats: {
    totalIntercepted: 0,
    reelsSummarized: 0,
    textsSummarized: 0,
    notificationsSent: 0,
    minutesSaved: 0
  },
  status: {
    connection: 'disconnected', // 'connected', 'disconnected', 'error', 'logged_out'
    details: 'Waiting for extension connection...',
    lastPoll: null
  }
};

// Check and initialize db file
function initDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf-8');
  } else {
    // Merge new keys from DEFAULT_STATE to allow schema evolution
    try {
      const current = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      let modified = false;
      
      // Ensure all top-level keys exist
      for (const key of Object.keys(DEFAULT_STATE)) {
        if (current[key] === undefined) {
          current[key] = DEFAULT_STATE[key];
          modified = true;
        }
      }
      
      // Ensure all settings keys exist
      for (const key of Object.keys(DEFAULT_STATE.settings)) {
        if (current.settings[key] === undefined) {
          current.settings[key] = DEFAULT_STATE.settings[key];
          modified = true;
        }
      }
      
      if (modified) {
        fs.writeFileSync(DB_FILE, JSON.stringify(current, null, 2), 'utf-8');
      }
    } catch (err) {
      console.error('Error parsing db file, resetting to default:', err);
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf-8');
    }
  }
}

// Read database contents
function readDb() {
  initDb();
  try {
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading db file, returning defaults:', err);
    return DEFAULT_STATE;
  }
}

// Write database contents
function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing db file:', err);
    return false;
  }
}

export const db = {
  // Settings Management
  getSettings() {
    return readDb().settings;
  },
  
  saveSettings(newSettings) {
    const data = readDb();
    data.settings = { ...data.settings, ...newSettings };
    writeDb(data);
    return data.settings;
  },
  
  // Message Management
  getMessages() {
    return readDb().messages;
  },
  
  addMessage(msg) {
    const data = readDb();
    
    // Check for duplicates
    if (data.messages.some(m => m.itemId === msg.itemId)) {
      return false;
    }
    
    data.messages.unshift(msg); // Add to the beginning of the array (most recent first)
    
    // Keep max 1000 messages in log
    if (data.messages.length > 1000) {
      data.messages.pop();
    }
    
    // Update stats
    data.stats.totalIntercepted++;
    if (msg.type === 'reel') {
      data.stats.reelsSummarized++;
      data.stats.minutesSaved += (data.settings.savedTimePerReelMinutes || 15);
    } else if (msg.type === 'text') {
      data.stats.textsSummarized++;
      // A small screen time savings for text DMs bypassed
      data.stats.minutesSaved += 2;
    }
    
    writeDb(data);
    return true;
  },

  // Stats Management
  getStats() {
    return readDb().stats;
  },
  
  incrementNotificationCount() {
    const data = readDb();
    data.stats.notificationsSent++;
    writeDb(data);
  },
  
  // Status Management
  getStatus() {
    const data = readDb();
    return data.status;
  },
  
  updateStatus(connection, details = '') {
    const data = readDb();
    data.status.connection = connection;
    data.status.details = details;
    data.status.lastPoll = Date.now();
    writeDb(data);
    return data.status;
  }
};
