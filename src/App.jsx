import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  MessageSquare, 
  Video, 
  Settings, 
  Send, 
  Clock, 
  Flame, 
  RefreshCw, 
  Check, 
  AlertCircle,
  ExternalLink
} from 'lucide-react';

function App() {
  // Application state
  const [status, setStatus] = useState({ connection: 'disconnected', details: 'Loading...', lastPoll: null });
  const [messages, setMessages] = useState([]);
  const [stats, setStats] = useState({ totalIntercepted: 0, reelsSummarized: 0, textsSummarized: 0, notificationsSent: 0, minutesSaved: 0 });
  const [settings, setSettings] = useState({ geminiApiKey: '', targetPhoneOrEmail: '', enableNotifications: true, reelSummaryStyle: 'concise', savedTimePerReelMinutes: 15 });
  const [apiKeyInput, setApiKeyInput] = useState('');
  
  // UI helper states
  const [activeTab, setActiveTab] = useState('logs');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState({ show: false, success: true, message: '' });
  const [testStatus, setTestStatus] = useState({ loading: false, show: false, success: true, message: '' });
  const [syncing, setSyncing] = useState(false);

  // Fetch status, stats, and messages from server
  const fetchData = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      // 1. Get Status & Stats
      const statusRes = await fetch('/api/status');
      if (statusRes.ok) {
        const data = await statusRes.json();
        setStatus({
          connection: data.connection,
          details: data.details,
          lastPoll: data.lastPoll
        });
        setStats(data.stats);
      }

      // 2. Get Messages
      const msgRes = await fetch('/api/messages');
      if (msgRes.ok) {
        const data = await msgRes.json();
        setMessages(data);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Fetch Settings on startup
  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings({
          targetPhoneOrEmail: data.targetPhoneOrEmail,
          enableNotifications: data.enableNotifications,
          reelSummaryStyle: data.reelSummaryStyle,
          savedTimePerReelMinutes: data.savedTimePerReelMinutes
        });
        // Set the display API key (placeholder if exists)
        if (data.hasApiKey) {
          setApiKeyInput(data.maskedApiKey || '••••••••••••••••••••••••');
        } else {
          setApiKeyInput('');
        }
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  };

  // Run on load and poll every 4 seconds
  useEffect(() => {
    fetchSettings();
    fetchData(true);

    const interval = setInterval(() => {
      fetchData(false);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  // Handle settings form submit
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaveStatus({ show: false, success: true, message: '' });
    
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          geminiApiKey: apiKeyInput
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSaveStatus({
          show: true,
          success: true,
          message: 'Settings saved successfully!'
        });
        fetchSettings(); // Refresh settings to get masked key
        fetchData(false); // Refresh metrics
        
        // Hide success message after 3 seconds
        setTimeout(() => setSaveStatus({ show: false, success: true, message: '' }), 3000);
      } else {
        throw new Error('Server returned error response');
      }
    } catch (err) {
      setSaveStatus({
        show: true,
        success: false,
        message: `Failed to save: ${err.message}`
      });
    }
  };

  // Trigger test notification
  const handleTriggerTest = async () => {
    setTestStatus({ loading: true, show: false, success: true, message: '' });
    
    try {
      const res = await fetch('/api/test-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: settings.targetPhoneOrEmail })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestStatus({
          loading: false,
          show: true,
          success: true,
          message: `Test notification sent successfully to ${settings.targetPhoneOrEmail || 'target'}!`
        });
      } else {
        throw new Error(data.error || 'Failed to dispatch notification');
      }
    } catch (err) {
      setTestStatus({
        loading: false,
        show: true,
        success: false,
        message: err.message
      });
    }
  };

  // Format milliseconds to relative time or date
  const formatTime = (ts) => {
    if (!ts) return 'Never';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // Screen time calculated in hours
  const hoursSaved = (stats.minutesSaved / 60).toFixed(1);

  // Status mapping to color/text
  const getStatusColor = (conn) => {
    switch (conn) {
      case 'connected': return 'green';
      case 'logged_out': return 'orange';
      case 'error': return 'red';
      default: return 'orange';
    }
  };

  const getStatusText = (conn) => {
    switch (conn) {
      case 'connected': return 'Active Connection';
      case 'logged_out': return 'Logged Out';
      case 'error': return 'Session Error';
      default: return 'Awaiting Link';
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Glass Header */}
      <header className="sticky top-0 z-40 w-full glass-panel rounded-none border-t-0 border-x-0 border-b py-4 px-6 md:px-12 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-indigo-600 flex items-center justify-center font-heading text-white text-xl font-bold shadow-lg" style={{ background: 'var(--grad-primary)' }}>
            M
          </div>
          <div>
            <h1 className="text-xl font-bold text-white leading-tight">Mamallma</h1>
            <p className="text-xs text-[var(--text-muted)]">Instagram Addiction Breaker</p>
          </div>
        </div>

        {/* Extension Connection Widget */}
        <div className="flex items-center gap-4 bg-slate-900/60 border border-white/5 rounded-full py-1.5 pl-4 pr-2">
          <div className="flex items-center gap-2">
            <span className={`pulse-dot ${getStatusColor(status.connection)}`}></span>
            <span className="text-xs font-medium text-white">{getStatusText(status.connection)}</span>
          </div>
          <button 
            onClick={() => { setSyncing(true); fetchData(false); setTimeout(() => setSyncing(false), 800); }} 
            className="p-1.5 hover:bg-white/5 rounded-full text-[var(--text-muted)] hover:text-white transition-colors"
            title="Refresh Logs"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
        
        {/* HUD Analytics Panel */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          
          <div className="glass-card primary">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Screen Time Saved</p>
                <h3 className="text-3xl font-extrabold text-white mt-1 tracking-tight">{hoursSaved} <span className="text-lg font-medium text-[var(--text-muted)]">hrs</span></h3>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--accent-magenta)]/10 text-[var(--accent-magenta)]">
                <Clock size={20} />
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-4">
              Estimated hours saved by bypassing distracting app loops
            </p>
          </div>

          <div className="glass-card safe">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Reels Summarized</p>
                <h3 className="text-3xl font-extrabold text-white mt-1 tracking-tight">{stats.reelsSummarized}</h3>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]">
                <Video size={20} />
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-4">
              Videos processed and forwarded as concise plain-text
            </p>
          </div>

          <div className="glass-card">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Plain Texts Filtered</p>
                <h3 className="text-3xl font-extrabold text-white mt-1 tracking-tight">{stats.textsSummarized}</h3>
              </div>
              <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                <MessageSquare size={20} />
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-4">
              Standard text DMs parsed and delivered without app opens
            </p>
          </div>

          <div className="glass-card">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Notifications Sent</p>
                <h3 className="text-3xl font-extrabold text-white mt-1 tracking-tight">{stats.notificationsSent}</h3>
              </div>
              <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
                <Flame size={20} />
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-4">
              Free native iMessage notifications successfully delivered
            </p>
          </div>

        </section>

        {/* Info Alerts banner for Extension Link */}
        {status.connection !== 'connected' && (
          <div className="glass-panel border-amber-500/20 bg-amber-500/5 p-4 flex gap-3 items-start">
            <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={18} />
            <div className="text-xs">
              <p className="font-semibold text-white">Instagram Connection Pending</p>
              <p className="text-[var(--text-muted)] mt-0.5">
                {status.connection === 'logged_out' 
                  ? 'The Chrome extension is connected, but you are not logged in to Instagram in Chrome. Please open Chrome, go to Instagram.com, log in, and then refresh this page.'
                  : 'To start intercepting messages, load the extension directory in Chrome (chrome://extensions -> Developer Mode -> Load Unpacked -> select the "extension" folder in the project folder).'}
              </p>
            </div>
          </div>
        )}

        {/* Content Tabs Navigation */}
        <div className="flex gap-4 border-b border-white/5 pb-2">
          <button 
            onClick={() => setActiveTab('logs')}
            className={`pb-2 px-1 text-sm font-semibold font-heading transition-colors border-b-2 -mb-[10px] ${
              activeTab === 'logs' ? 'text-white border-[var(--accent-magenta)]' : 'text-[var(--text-muted)] border-transparent hover:text-white'
            }`}
          >
            Intercepted Messages Log
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`pb-2 px-1 text-sm font-semibold font-heading transition-colors border-b-2 -mb-[10px] ${
              activeTab === 'settings' ? 'text-white border-[var(--accent-magenta)]' : 'text-[var(--text-muted)] border-transparent hover:text-white'
            }`}
          >
            Settings & Control Panel
          </button>
        </div>

        {/* Tab Content Panels */}
        {loading ? (
          <div className="glass-panel p-12 flex flex-col items-center justify-center gap-3">
            <RefreshCw size={24} className="animate-spin text-[var(--text-muted)]" />
            <p className="text-xs text-[var(--text-muted)]">Loading metrics and database logs...</p>
          </div>
        ) : activeTab === 'logs' ? (
          /* Logs Panel */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Message Feed (Left 2 Columns) */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              {messages.length === 0 ? (
                <div className="glass-panel p-12 text-center flex flex-col items-center justify-center gap-2">
                  <MessageSquare size={36} className="text-[var(--text-dark)]" />
                  <p className="font-heading text-sm font-semibold text-white">No intercepted messages yet</p>
                  <p className="text-xs text-[var(--text-muted)] max-w-sm">
                    Incoming Instagram messages will be intercepted in background by the extension, processed by Gemini, and logged here.
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.itemId} className="glass-panel p-5 hover:border-white/10 transition-colors flex flex-col gap-3">
                    <div className="flex justify-between items-center gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-heading text-sm font-bold text-white">@{msg.senderUsername}</span>
                        {msg.senderFullName && (
                          <span className="text-xs text-[var(--text-muted)] hidden sm:inline">({msg.senderFullName})</span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--text-muted)]">{formatTime(msg.interceptedAt)}</span>
                        {msg.notifiedAt ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 font-medium" title={`Sent to phone at ${new Date(msg.notifiedAt).toLocaleTimeString()}`}>
                            <Check size={10} /> Notified
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20 flex items-center gap-1 font-medium" title="Notification was disabled or failed to dispatch">
                            Not Sent
                          </span>
                        )}
                        {msg.type === 'reel' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] border border-[var(--accent-emerald)]/20 flex items-center gap-1 font-semibold">
                            <Video size={10} /> Reel
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center gap-1 font-semibold">
                            <MessageSquare size={10} /> Text
                          </span>
                        )}
                      </div>
                    </div>

                    {/* AI Generated Summary Display */}
                    <div className="bg-slate-950/40 border border-white/5 rounded-lg p-3 text-xs leading-relaxed text-slate-100">
                      <p className="font-semibold text-[var(--text-muted)] mb-1 text-[10px] uppercase tracking-wider">AI Generated Notification Summary</p>
                      {msg.summary}
                    </div>

                    {/* Meta Info / Original details */}
                    <div className="flex flex-wrap justify-between items-center gap-2 mt-1 text-[11px] text-[var(--text-muted)]">
                      {msg.type === 'reel' && (
                        <div className="flex items-center gap-1.5">
                          <span>Reel by <strong>@{msg.reelCreator || 'unknown'}</strong></span>
                          {msg.content && (
                            <span className="truncate max-w-[200px] sm:max-w-[300px] italic"> - &ldquo;{msg.content}&rdquo;</span>
                          )}
                        </div>
                      )}
                      {msg.type === 'text' && (
                        <span className="truncate max-w-[300px] italic">Original: &ldquo;{msg.content}&rdquo;</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Sidebar Details (Right Column) */}
            <div className="flex flex-col gap-6">
              <div className="glass-panel p-5">
                <h4 className="font-heading text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <ShieldCheck size={16} className="text-[var(--accent-emerald)]" /> Active Monitoring Status
                </h4>
                
                <div className="flex flex-col gap-4 text-xs">
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-[var(--text-muted)]">Connection Status</span>
                    <span className="font-medium text-white flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full bg-${getStatusColor(status.connection)}`}></span>
                      {getStatusText(status.connection)}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-[var(--text-muted)]">Last Scraping Sync</span>
                    <span className="font-medium text-white">{formatTime(status.lastPoll)}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-[var(--text-muted)]">Active Notification Target</span>
                    <span className="font-medium text-white truncate max-w-[150px]">{settings.targetPhoneOrEmail || 'None Set'}</span>
                  </div>
                  <div className="flex justify-between pb-1">
                    <span className="text-[var(--text-muted)]">Local Server Endpoint</span>
                    <span className="font-mono text-white">http://localhost:3000</span>
                  </div>
                  
                  <div className="mt-2 text-[10px] text-[var(--text-muted)] bg-slate-900/40 p-3 rounded border border-white/5 leading-normal">
                    <strong>Stealth Details:</strong> The extension accesses the API locally on your device every 5 minutes. No Instagram login details are ever captured or exposed to the AI, preserving complete safety.
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Settings Panel */
          <div className="max-w-2xl mx-auto w-full glass-panel p-6 sm:p-8">
            <h3 className="font-heading text-lg font-bold text-white mb-6 flex items-center gap-2">
              <Settings size={18} className="text-[var(--accent-magenta)]" /> System Configurations
            </h3>

            {/* Save Toast Alerts */}
            {saveStatus.show && (
              <div className={`p-4 rounded-lg mb-6 flex gap-3 items-center text-xs ${
                saveStatus.success ? 'bg-[var(--accent-emerald)]/10 border border-[var(--accent-emerald)]/20 text-[var(--accent-emerald)]' : 'bg-red-500/10 border border-red-500/20 text-red-400'
              }`}>
                {saveStatus.success ? <Check size={16} /> : <AlertCircle size={16} />}
                <span>{saveStatus.message}</span>
              </div>
            )}

            <form onSubmit={handleSaveSettings} className="flex flex-col gap-6">
              
              {/* Gemini Key */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Gemini API Key</label>
                <input 
                  type="password"
                  placeholder="Enter your Gemini API Key..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
                <p className="text-[10px] text-[var(--text-muted)] leading-normal">
                  Required to summarize messages and reels. Generate a free key on <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-magenta)] hover:underline">Google AI Studio <ExternalLink size={8} className="inline" /></a>.
                </p>
              </div>

              {/* Notification Target (iMessage phone or email) */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">macOS Messages Target (iMessage / SMS)</label>
                <input 
                  type="text"
                  placeholder="e.g. +1234567890 or email@domain.com"
                  value={settings.targetPhoneOrEmail}
                  onChange={(e) => setSettings({ ...settings, targetPhoneOrEmail: e.target.value })}
                />
                <p className="text-[10px] text-[var(--text-muted)] leading-normal">
                  Your primary phone number or Apple ID email. Summaries will be delivered via the macOS Messages app.
                </p>
              </div>

              {/* Grid configs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Reel Style */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Reel Summary Style</label>
                  <select 
                    value={settings.reelSummaryStyle}
                    onChange={(e) => setSettings({ ...settings, reelSummaryStyle: e.target.value })}
                  >
                    <option value="concise">Concise Topic (Recommended)</option>
                    <option value="detailed">Detailed Breakdown</option>
                  </select>
                </div>
                
                {/* Weight factor */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Screen Time Weight (mins)</label>
                  <input 
                    type="number"
                    min="1"
                    max="120"
                    value={settings.savedTimePerReelMinutes}
                    onChange={(e) => setSettings({ ...settings, savedTimePerReelMinutes: parseInt(e.target.value) || 15 })}
                  />
                  <p className="text-[9px] text-[var(--text-muted)]">
                    Minutes of doomscrolling saved each time you bypass a Reel.
                  </p>
                </div>
              </div>

              {/* Switch */}
              <div className="flex items-center justify-between border-t border-white/5 pt-4">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-white">Enable Notifications</span>
                  <span className="text-[10px] text-[var(--text-muted)]">Deliver text messages immediately in background.</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer"
                    checked={settings.enableNotifications}
                    onChange={(e) => setSettings({ ...settings, enableNotifications: e.target.checked })}
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:height after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--accent-magenta)] peer-checked:after:bg-white peer-checked:after:border-white"></div>
                </label>
              </div>

              {/* Submits */}
              <div className="flex flex-col sm:flex-row gap-4 border-t border-white/5 pt-6 justify-end">
                <button 
                  type="button"
                  onClick={handleTriggerTest}
                  disabled={testStatus.loading || !settings.targetPhoneOrEmail}
                  className="btn btn-secondary text-xs"
                >
                  {testStatus.loading ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" /> Dispatching Test...
                    </>
                  ) : (
                    <>
                      <Send size={12} /> Test iMessage Connection
                    </>
                  )}
                </button>
                <button type="submit" className="btn btn-primary text-xs">
                  Save Settings
                </button>
              </div>
            </form>

            {/* Test notifications toast alerts */}
            {testStatus.show && (
              <div className={`p-4 rounded-lg mt-6 flex gap-3 items-start text-xs leading-normal ${
                testStatus.success ? 'bg-[var(--accent-emerald)]/10 border border-[var(--accent-emerald)]/20 text-[var(--accent-emerald)]' : 'bg-red-500/10 border border-red-500/20 text-red-400'
              }`}>
                {testStatus.success ? <Check className="shrink-0 mt-0.5" size={16} /> : <AlertCircle className="shrink-0 mt-0.5" size={16} />}
                <div>
                  <p className="font-bold">{testStatus.success ? 'iMessage Success' : 'iMessage Error'}</p>
                  <p className="text-[var(--text-muted)] mt-0.5">{testStatus.message}</p>
                  {testStatus.success && (
                    <p className="text-[9px] text-[var(--text-muted)] mt-1">
                      Check the Messages app on your Mac or your phone to verify receipt!
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      
      {/* Footer */}
      <footer className="w-full text-center py-6 text-[10px] text-[var(--text-dark)] border-t border-white/5 mt-12 bg-slate-950/20">
        Mamallma is a local application. All settings and message filters reside privately on your Mac.
      </footer>
    </div>
  );
}

export default App;
