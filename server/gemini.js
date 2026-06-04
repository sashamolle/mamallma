// Gemini AI Summarization Service
import { GoogleGenAI } from '@google/genai';
import { db } from './db.js';

// Helper to decode HTML entities in metadata scraping
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/\\u0026/g, '&');
}

/**
 * Scrapes public HTML metadata for an Instagram post or Reel
 * to get the description/caption without requiring authentication.
 */
async function scrapeInstagramMetadata(url) {
  if (!url) return '';
  
  try {
    console.log(`Gemini: Scraping public metadata for URL: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!response.ok) {
      console.warn(`Gemini: Metadata scrape failed with status ${response.status}`);
      return '';
    }

    const html = await response.text();
    
    // Try to find og:description meta tag
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
    
    if (ogDescMatch && ogDescMatch[1]) {
      const desc = decodeHtmlEntities(ogDescMatch[1]);
      console.log('Gemini: Extracted og:description:', desc.substring(0, 100) + '...');
      return desc;
    }
    
    // Fallback: name="description"
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (descMatch && descMatch[1]) {
      const desc = decodeHtmlEntities(descMatch[1]);
      console.log('Gemini: Extracted description:', desc.substring(0, 100) + '...');
      return desc;
    }
    
    return '';
  } catch (err) {
    console.error('Gemini: Scrape error:', err.message);
    return '';
  }
}

/**
 * Returns an active Gemini Client instance if API key is set
 */
function getGeminiClient() {
  const settings = db.getSettings();
  if (!settings.geminiApiKey) {
    console.warn('Gemini: API Key is missing in settings.');
    return null;
  }
  return new GoogleGenAI({ apiKey: settings.geminiApiKey });
}

/**
 * Summarizes a text message (now bypassed to return the exact original text in quotes)
 */
export async function summarizeText(sender, text) {
  return `💬 @${sender}: "${text}"`;
}

/**
 * Summarizes an Instagram Reel or Media share
 */
export async function summarizeReel(sender, payload) {
  const ai = getGeminiClient();
  const { reelUrl, reelCreator, content: extensionCaption } = payload;
  
  // Scrape public page for richer metadata description (in case caption is emoji or empty)
  let scrapedDescription = '';
  if (reelUrl) {
    scrapedDescription = await scrapeInstagramMetadata(reelUrl);
  }
  
  // Combine all sources of text descriptions
  const metadataText = `Scraped Description: ${scrapedDescription || 'None'}\nExtension Caption: ${extensionCaption || 'None'}`;
  
  if (!ai) {
    const creatorInfo = reelCreator ? ` by @${reelCreator}` : '';
    return `🎥 @${sender} sent a Reel${creatorInfo}.\nSummary: Visual content summary unavailable (Add your Gemini API Key in Settings to get real summaries!).\nLink: ${reelUrl}`;
  }
  
  try {
    const prompt = `You are Mamallma, an AI designed to help the user avoid Instagram addiction.
The user's friend (@${sender}) sent them an Instagram Reel.
We have gathered the following metadata, creator name, and captions for the video:
Reel Creator: @${reelCreator || 'unknown'}
Metadata details:
${metadataText}

Your task is to write a highly concise, punchy summary of the visual/audio topic of this Reel.
Rules:
1. Start the summary EXACTLY with: "🎥 @${reelCreator || 'creator'} shared a Reel about..."
2. Follow that with one short, clear sentence describing the main topic or theme (e.g., comedy skit about corporate meetings, recipe tutorial for sourdough bread, travel montage of Iceland).
3. Do NOT mention likes, views, comments, or count metrics.
4. Keep the total summary under 30 words so it fits in a single text message notification.
5. If the metadata is empty or useless, describe it generally based on the creator's username if possible, or summarize it as a shared video from @${reelCreator}.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });
    
    const summary = response.text.trim();
    return `📬 @${sender} sent you a Reel by @${reelCreator || 'creator'}:\n\n${summary}`;
  } catch (err) {
    console.error('Gemini Reel summarization error:', err);
    return `🎥 @${sender} sent a Reel by @${reelCreator || 'creator'}.\n(Summarization failed: ${err.message})`;
  }
}
