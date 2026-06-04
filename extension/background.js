// Mamallma Background Service Worker
const BACKEND_URL = 'http://localhost:3000';
const ALARM_NAME = 'mamallma-poll';
const POLL_INTERVAL_MINUTES = 5;

// On installation, set up alarms and initial state
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Mamallma Extension Installed.');
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.5,
    periodInMinutes: POLL_INTERVAL_MINUTES
  });
  
  // Set initial processed message set if not exists
  const { processedIds } = await chrome.storage.local.get('processedIds');
  if (!processedIds) {
    await chrome.storage.local.set({ processedIds: [] });
  }

  // Also initialize installation timestamp to ignore prior historical messages
  await chrome.storage.local.set({ installTime: Date.now() });
  
  // Initial check
  await pollInstagram();
});

// Alarm Listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await pollInstagram();
  }
});

// Listen for message from dashboard/popup to trigger manual sync
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sync_now') {
    (async () => {
      try {
        const result = await pollInstagram();
        sendResponse({ success: true, count: result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }
});

// Notify backend of connection status
async function notifyServerStatus(status, details = '') {
  try {
    await fetch(`${BACKEND_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, details, timestamp: Date.now() })
    });
  } catch (err) {
    console.error('Failed to notify backend server status:', err);
  }
}

// Core Polling Logic
async function pollInstagram() {
  console.log('Mamallma: Starting Instagram poll...');
  
  try {
    // 1. Get cookies to check authentication
    const cookies = await chrome.cookies.getAll({ domain: 'instagram.com' });
    const sessionCookie = cookies.find(c => c.name === 'sessionid');
    const csrfCookie = cookies.find(c => c.name === 'csrftoken');
    
    if (!sessionCookie) {
      console.warn('Mamallma: sessionid cookie not found. User is logged out.');
      await notifyServerStatus('logged_out', 'Please log into Instagram in your Chrome browser.');
      return 0;
    }
    
    const csrfToken = csrfCookie ? csrfCookie.value : '';
    await notifyServerStatus('connected', 'Successfully connected to Instagram session.');

    // 2. Fetch Direct Message Inbox
    const inboxUrl = 'https://www.instagram.com/api/v1/direct_v2/inbox/?persistentBadging=true&folder=default';
    const response = await fetch(inboxUrl, {
      method: 'GET',
      headers: {
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': csrfToken
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`Instagram API responded with status ${response.status}`);
    }

    const data = await response.json();
    const threads = data.inbox?.threads || [];
    console.log(`Mamallma: Fetched ${threads.length} direct message threads.`);

    // 3. Process new messages
    const { processedIds = [] } = await chrome.storage.local.get('processedIds');
    const { installTime = Date.now() } = await chrome.storage.local.get('installTime');
    
    let newMessagesIntercepted = 0;
    const newProcessedIds = [...processedIds];

    for (const thread of threads) {
      // Get thread users to map sender IDs to names
      const userMap = {};
      if (thread.users) {
        thread.users.forEach(u => {
          userMap[u.pk] = {
            username: u.username,
            fullName: u.full_name,
            profilePicUrl: u.profile_pic_url
          };
        });
      }
      
      const items = thread.items || [];
      // Process items chronologically (oldest first in this loop, so we process in order)
      const sortedItems = [...items].sort((a, b) => a.timestamp - b.timestamp);

      for (const item of sortedItems) {
        const itemId = item.item_id;
        
        // Skip if already processed
        if (newProcessedIds.includes(itemId)) {
          continue;
        }

        // Convert item timestamp (microseconds) to milliseconds
        const messageTime = Math.floor(item.timestamp / 1000);
        
        // Skip historical messages from before extension was installed
        // Allow a grace period of 1 hour for testing
        if (messageTime < installTime - 3600000) {
          // Mark as processed so we don't scan it again
          newProcessedIds.push(itemId);
          continue;
        }

        // Identify sender details
        const sender = userMap[item.user_id] || { username: 'unknown', fullName: 'Unknown Sender' };

        // Parse different item types
        let payload = null;
        
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
          // Instagram Reel Share
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
          // Standard post share (which could be a video or photo)
          const media = item.media_share?.media || item.media_share || {};
          const isVideo = media.media_type === 2; // 2 is video in Instagram API
          payload = {
            itemId,
            threadId: thread.thread_id,
            senderId: item.user_id,
            senderUsername: sender.username,
            senderFullName: sender.fullName,
            timestamp: messageTime,
            type: isVideo ? 'reel' : 'media', // Treat videos as reels for summarization
            content: media.caption?.text || '',
            reelUrl: `https://www.instagram.com/p/${media.code}/`,
            reelId: media.code,
            reelCreator: media.user?.username || 'unknown',
            videoUrl: isVideo ? (media.video_versions?.[0]?.url || '') : ''
          };
        }

        // If it's a type we want to intercept
        if (payload) {
          payload.rawItem = item; // Attach raw item for debugging
          console.log(`Mamallma: Intercepted ${payload.type} from @${payload.senderUsername}`);
          
          // Forward to local server
          const success = await sendToBackend(payload);
          if (success) {
            newProcessedIds.push(itemId);
            newMessagesIntercepted++;
          }
        } else {
          // Mark other non-actionable message types (e.g. likes, reactions) as processed to avoid re-evaluating
          newProcessedIds.push(itemId);
        }
      }
    }

    // Keep storage clean: only store the last 500 processed IDs
    if (newProcessedIds.length > 500) {
      newProcessedIds.splice(0, newProcessedIds.length - 500);
    }
    
    await chrome.storage.local.set({ processedIds: newProcessedIds });
    console.log(`Mamallma: Polled successfully. Intercepted ${newMessagesIntercepted} new messages.`);
    return newMessagesIntercepted;

  } catch (err) {
    console.error('Mamallma Error during poll:', err);
    await notifyServerStatus('error', err.message);
    return 0;
  }
}

// Send payload to Express server
async function sendToBackend(payload) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/intercept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      return true;
    } else {
      console.error(`Backend returned status ${response.status}`);
      return false;
    }
  } catch (err) {
    console.error('Failed to send payload to backend server. Is the server running?', err);
    return false;
  }
}
