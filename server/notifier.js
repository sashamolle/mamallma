// macOS Native Notifier (iMessage / SMS via AppleScript)
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from './db.js';

const execAsync = promisify(exec);

/**
 * Sends a native iMessage/SMS on macOS to the target number or email.
 * Uses a double-script fallback logic for maximum compatibility.
 */
async function dispatchIMessage(target, text) {
  // Clean up message text (escape quotes and remove backslashes that break AppleScript strings)
  const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  
  // Attempt 1: Target specifically the iMessage service
  try {
    console.log(`Notifier: Attempting to send iMessage to ${target} via specific account...`);
    const script = `tell application "Messages" to send "${escapedText}" to participant "${target}" of (1st account whose service type = iMessage)`;
    const { stdout, stderr } = await execAsync(`osascript -e '${script}'`);
    if (stderr) console.error('Script 1 stderr:', stderr);
    console.log('Notifier: iMessage sent successfully via Account API.');
    return true;
  } catch (err) {
    console.warn('Notifier: Primary iMessage script failed. Trying buddy fallback...', err.message);
    
    // Attempt 2: Fallback to general buddy matching (works if number is in Contacts or previously messaged)
    try {
      const fallbackScript = `tell application "Messages" to send "${escapedText}" to buddy "${target}"`;
      const { stdout, stderr } = await execAsync(`osascript -e '${fallbackScript}'`);
      if (stderr) console.error('Fallback script stderr:', stderr);
      console.log('Notifier: Message sent successfully via Buddy API.');
      return true;
    } catch (fallbackErr) {
      console.error('Notifier: All iMessage script attempts failed.', fallbackErr.message);
      throw new Error(`macOS Messages failed to send. Ensure the Messages app is running and your Mac is signed in to iMessage. Error: ${fallbackErr.message}`);
    }
  }
}

/**
 * Sends a Telegram message using the Bot API.
 */
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text
      })
    });
    
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Telegram API responded with ${res.status}: ${errText}`);
    }
    console.log('Notifier: Telegram notification sent successfully.');
    return true;
  } catch (err) {
    console.error('Notifier: Telegram send failed:', err.message);
    throw err;
  }
}

/**
 * Public function to route and dispatch a notification.
 */
export async function sendNotification(text) {
  const settings = db.getSettings();
  
  if (!settings.enableNotifications) {
    console.log('Notifier: Notifications are disabled in settings.');
    return false;
  }
  
  // Auto-detect environment: if not running on macOS (darwin), route via Telegram
  const useTelegram = settings.notificationChannel === 'telegram' || process.platform !== 'darwin';
  
  try {
    if (useTelegram) {
      const token = settings.telegramBotToken;
      const chatId = settings.telegramChatId;
      if (!token || !chatId) {
        throw new Error('Telegram notification enabled, but telegramBotToken or telegramChatId is not set in settings.');
      }
      await sendTelegramMessage(token, chatId, text);
    } else {
      const target = settings.targetPhoneOrEmail;
      if (!target) {
        throw new Error('No target phone number or email set in settings for iMessage.');
      }
      await dispatchIMessage(target, text);
    }
    db.incrementNotificationCount();
    return true;
  } catch (err) {
    console.error('Notifier dispatch failed:', err);
    throw err;
  }
}

/**
 * Sends a test notification to verify AppleScript/Telegram permissions.
 */
export async function sendTestNotification(customTarget = null) {
  const settings = db.getSettings();
  const useTelegram = settings.notificationChannel === 'telegram' || process.platform !== 'darwin';
  
  const testMessage = `📬 Mamallma Notification Test\n\nYour Instagram DM filter bot is successfully configured! Messages and Reels will now be summarized and sent here. Keep up the good work beating the addiction! 💪`;
  
  if (useTelegram) {
    const token = settings.telegramBotToken;
    const chatId = customTarget || settings.telegramChatId;
    if (!token || !chatId) {
      throw new Error('Telegram bot token or chat ID is missing for test.');
    }
    return await sendTelegramMessage(token, chatId, testMessage);
  } else {
    const target = customTarget || settings.targetPhoneOrEmail;
    if (!target) {
      throw new Error('No target phone number or email provided for test.');
    }
    return await dispatchIMessage(target, testMessage);
  }
}
