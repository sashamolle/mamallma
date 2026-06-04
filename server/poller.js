// Standalone Cloud Poller Daemon for Mamallma
// Replaces the Chrome extension on cloud VPS environments by loading cookies.json
import fs from 'fs';
import path from 'path';

const BACKEND_URL = 'http://localhost:3000';
const COOKIES_FILE = path.join(process.cwd(), 'cookies.json');
const STATE_FILE = path.join(process.cwd(), 'poller_state.json');
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Logger utility
const log = (msg, level = 'INFO') => {
  console.log(`[POLLER] [${level}] [${new Date().toLocaleTimeString()}] ${msg}`);
};

// Check for cookies file
if (!fs.existsSync(COOKIES_FILE)) {
  log(`CRITICAL ERROR: cookies.json is missing.`, 'ERROR');
  log(`Please export your Instagram cookies from your logged-in Chrome browser using an extension (like EditThisCookie) and save it to:`, 'ERROR');
  log(COOKIES_FILE, 'ERROR');
  process.exit(1);
}

// Load processed IDs history to avoid spam on restarts
let processedIds = [];
try {
  if (fs.existsSync(STATE_FILE)) {
    processedIds = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    log(`Loaded ${processedIds.length} processed message IDs from state cache.`);
  } else {
    fs.writeFileSync(STATE_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
} catch (err) {
  log(`Failed to read state cache: ${err.message}`, 'WARN');
}

// Parse cookies to retrieve session headers
function getAuthHeaders() {
  try {
    const rawCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
    
    const sessionCookie = rawCookies.find(c => c.name === 'sessionid');
    const csrfCookie = rawCookies.find(c => c.name === 'csrftoken');
    
    if (!sessionCookie) {
      throw new Error("Missing 'sessionid' cookie in cookies.json.");
    }
    
    const sessionid = sessionCookie.value;
    const csrftoken = csrfCookie ? csrfCookie.value : '';
    
    return {
      'Cookie': `sessionid=${sessionid}; csrftoken=${csrftoken};`,
      'X-CSRFToken': csrftoken,
      'X-IG-App-ID': '936619743392459',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    };
  } catch (err) {
    log(`Authentication config error: ${err.message}`, 'ERROR');
    throw err;
  }
}

// Update server connection status
async function notifyServerStatus(status, details = '') {
  try {
    const response = await fetch(`${BACKEND_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, details, timestamp: Date.now() })
    });
    return response.ok;
  } catch (err) {
    log(`Failed to update status on API server: ${err.message}`, 'WARN');
    return false;
  }
}

// Post intercepted message to backend
async function sendToBackend(payload) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/intercept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return response.ok;
  } catch (err) {
    log(`Failed to post message to backend: ${err.message}`, 'ERROR');
    return false;
  }
}

// Main Polling Loop
async function pollInstagram() {
  log('Starting poll cycle...');
  
  try {
    const headers = getAuthHeaders();
    
    const inboxUrl = 'https://www.instagram.com/api/v1/direct_v2/inbox/?persistentBadging=true&folder=default';
    const response = await fetch(inboxUrl, { method: 'GET', headers });
    
    if (response.status === 403 || response.status === 401) {
      log('Instagram session expired. Please export new cookies.', 'ERROR');
      await notifyServerStatus('logged_out', 'Cloud session expired. Please export fresh cookies.json.');
      return;
    }
    
    if (!response.ok) {
      throw new Error(`Instagram API responded with status ${response.status}`);
    }
    
    const data = await response.json();
    const threads = data.inbox?.threads || [];
    log(`Successfully fetched inbox. Processing ${threads.length} threads.`);
    
    await notifyServerStatus('connected', 'Cloud poller active and connected.');
    
    let newMessagesIntercepted = 0;
    const installTime = Date.now() - 3600000; // Ignore historical messages older than 1 hour

    for (const thread of threads) {
      // Map user details
      const userMap = {};
      if (thread.users) {
        thread.users.forEach(u => {
          userMap[u.pk] = {
            username: u.username,
            fullName: u.full_name
          };
        });
      }
      
      const items = thread.items || [];
      const sortedItems = [...items].sort((a, b) => a.timestamp - b.timestamp);
      
      for (const item of sortedItems) {
        const itemId = item.item_id;
        
        // Skip if already processed
        if (processedIds.includes(itemId)) {
          continue;
        }
        
        const messageTime = Math.floor(item.timestamp / 1000);
        
        // Skip historical messages
        if (messageTime < installTime) {
          processedIds.push(itemId);
          continue;
        }
        
        const sender = userMap[item.user_id] || { username: 'unknown', fullName: 'Unknown Sender' };
        let payload = null;
        
        // Parse message types
        if (item.item_type === 'text') {
          payload = {
            itemId,
            threadId: thread.thread_id,
            senderId: item.user_id,
            senderUsername: sender.username,
            senderFullName: sender.fullName,
            timestamp: messageTime,
            type: 'text',
            content: item.text
          };
        } else if (item.item_type === 'clip') {
          // Shared Reel
          const clip = item.clip?.clip || item.clip?.media || item.clip || {};
          payload = {
            itemId,
            threadId: thread.thread_id,
            senderId: item.user_id,
            senderUsername: sender.username,
            senderFullName: sender.fullName,
            timestamp: messageTime,
            type: 'reel',
            content: clip.caption?.text || '',
            reelUrl: `https://www.instagram.com/reels/${clip.code}/`,
            reelId: clip.code,
            reelCreator: clip.user?.username || 'unknown',
            videoUrl: clip.video_versions?.[0]?.url || ''
          };
        } else if (item.item_type === 'media_share') {
          // Standard post
          const media = item.media_share?.media || item.media_share || {};
          const isVideo = media.media_type === 2;
          payload = {
            itemId,
            threadId: thread.thread_id,
            senderId: item.user_id,
            senderUsername: sender.username,
            senderFullName: sender.fullName,
            timestamp: messageTime,
            type: isVideo ? 'reel' : 'media',
            content: media.caption?.text || '',
            reelUrl: `https://www.instagram.com/p/${media.code}/`,
            reelId: media.code,
            reelCreator: media.user?.username || 'unknown',
            videoUrl: isVideo ? (media.video_versions?.[0]?.url || '') : ''
          };
        }
        
        if (payload) {
          log(`Intercepted ${payload.type} from @${payload.senderUsername}`);
          
          // Send to backend
          const success = await sendToBackend(payload);
          if (success) {
            processedIds.push(itemId);
            newMessagesIntercepted++;
          }
        } else {
          // Mark other events as processed to skip scanning
          processedIds.push(itemId);
        }
      }
    }
    
    // Clean up history and write state
    if (processedIds.length > 500) {
      processedIds.splice(0, processedIds.length - 500);
    }
    
    fs.writeFileSync(STATE_FILE, JSON.stringify(processedIds, null, 2), 'utf-8');
    log(`Poll completed. Processed ${newMessagesIntercepted} new messages.`);
    
  } catch (err) {
    log(`Poll cycle error: ${err.message}`, 'ERROR');
    await notifyServerStatus('error', `Cloud poll error: ${err.message}`);
  }
}

// Start polling immediately and on interval
async function main() {
  log('Mamallma Cloud Poller Daemon started.');
  
  // Perform immediate check
  await pollInstagram();
  
  // Set recurring timer
  setInterval(pollInstagram, POLL_INTERVAL_MS);
}

main().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
