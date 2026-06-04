// Stdio Model Context Protocol (MCP) Server for Mamallma
// Allows Nous Research Hermes Agent, Cursor, or Claude Desktop to interact with the bot.
import readline from 'readline';
import { db } from './db.js';
import { sendTestNotification } from './notifier.js';

// Setup readline interface for stdio JSON-RPC communication
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Write JSON-RPC response to stdout
function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id,
    result
  }) + '\n');
}

// Write JSON-RPC error to stdout
function sendError(id, code, message, data = null) {
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message, data }
  }) + '\n');
}

// Define the available MCP tools
const TOOLS = [
  {
    name: 'get_status_and_stats',
    description: 'Retrieve the active connection status of the Instagram interceptor and addiction stats (e.g. screen time saved).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_intercepted_messages',
    description: 'Get a list of all intercepted Instagram messages, original text, reels metadata, and generated summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return (default 20).',
          default: 20
        }
      }
    }
  },
  {
    name: 'trigger_test_notification',
    description: 'Sends a test iMessage notification to your configured phone number to verify connection.',
    inputSchema: {
      type: 'object',
      properties: {
        customMessage: {
          type: 'string',
          description: 'Optional custom text message to send.'
        }
      }
    }
  }
];

// Handle incoming JSON-RPC lines
rl.on('line', async (line) => {
  if (!line.trim()) return;
  
  try {
    const request = JSON.parse(line);
    const { jsonrpc, id, method, params } = request;
    
    // Check protocol version
    if (jsonrpc !== '2.0') {
      sendError(id, -32600, 'Invalid request: jsonrpc version must be 2.0');
      return;
    }
    
    // Route methods
    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'mamallma-mcp',
            version: '1.0.0'
          }
        });
        break;
        
      case 'tools/list':
        sendResponse(id, {
          tools: TOOLS
        });
        break;
        
      case 'tools/call':
        await handleToolCall(id, params);
        break;
        
      default:
        // Respond empty result for unsupported lifecycle notifications/methods to avoid blocking
        sendResponse(id, {});
        break;
    }
  } catch (err) {
    sendError(null, -32700, 'Parse error: invalid JSON received', err.message);
  }
});

// Tool call resolver
async function handleToolCall(id, params) {
  const { name, arguments: args = {} } = params;
  
  try {
    let resultText = '';
    
    switch (name) {
      case 'get_status_and_stats': {
        const status = db.getStatus();
        const stats = db.getStats();
        const settings = db.getSettings();
        
        const responseData = {
          connectionStatus: status.connection,
          statusDetails: status.details,
          lastPollTime: status.lastPoll ? new Date(status.lastPoll).toLocaleString() : 'Never',
          stats: {
            totalIntercepted: stats.totalIntercepted,
            reelsSummarized: stats.reelsSummarized,
            textsSummarized: stats.textsSummarized,
            notificationsSent: stats.notificationsSent,
            estimatedScreenTimeSavedMinutes: stats.minutesSaved,
            estimatedScreenTimeSavedHours: (stats.minutesSaved / 60).toFixed(1)
          },
          notificationTarget: settings.targetPhoneOrEmail || 'Not configured'
        };
        
        resultText = JSON.stringify(responseData, null, 2);
        break;
      }
      
      case 'list_intercepted_messages': {
        const limit = args.limit || 20;
        const messages = db.getMessages();
        const sliced = messages.slice(0, limit).map(m => ({
          sender: `@${m.senderUsername}`,
          type: m.type,
          timestamp: new Date(m.timestamp).toLocaleString(),
          summary: m.summary,
          originalContent: m.content || '(Shared link/Reel)',
          reelUrl: m.reelUrl
        }));
        
        resultText = sliced.length > 0 
          ? JSON.stringify(sliced, null, 2)
          : 'No messages have been intercepted yet. Make sure the extension is active and you receive a DM.';
        break;
      }
      
      case 'trigger_test_notification': {
        const customMessage = args.customMessage;
        const settings = db.getSettings();
        const target = settings.targetPhoneOrEmail;
        
        if (!target) {
          resultText = 'Error: No notification target set in settings. Configure the target phone number/email first.';
          break;
        }
        
        await sendTestNotification(target);
        resultText = `Success: Triggered a test notification to ${target}.`;
        break;
      }
      
      default:
        sendError(id, -32601, `Method not found: tool ${name} does not exist`);
        return;
    }
    
    // Standard MCP Tool Call Output Format
    sendResponse(id, {
      content: [
        {
          type: 'text',
          text: resultText
        }
      ]
    });
    
  } catch (err) {
    sendResponse(id, {
      content: [
        {
          type: 'text',
          text: `Error executing tool: ${err.message}`
        }
      ],
      isError: true
    });
  }
}
