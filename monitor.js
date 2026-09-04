import 'dotenv/config';
import WebSocket from 'ws';
import http from 'http';

// Configuration
const USER_TOKEN = process.env.USER_TOKEN?.trim().replace(/^["']|["']$/g, '');
const WEBHOOK_URL = process.env.WEBHOOK_URL?.trim().replace(/^["']|["']$/g, '');
const PORT = process.env.PORT || 3000;
const KEYWORDS = (process.env.ALERT_KEYWORDS || 'urgent,alert,important')
  .split(',')
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);

if (!USER_TOKEN) {
  console.error('❌ ERROR: USER_TOKEN is missing in your .env file!');
}

if (!WEBHOOK_URL) {
  console.error('❌ ERROR: WEBHOOK_URL is missing in your .env file!');
} else {
  console.log(`🔗 [Webhook Configured] URL prefix: ${WEBHOOK_URL.substring(0, 35)}...`);
}

// 1. Lightweight HTTP server for Cloud Hosting Health Checks (Koyeb / Render / Fly)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'online',
    service: 'Discord Activity Monitor',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  }));
});

server.listen(PORT, () => {
  console.log(`🚀 [Health-Check] HTTP Server listening on port ${PORT}`);
  // Initial Boot Alert to Webhook
  sendAlert(
    '🚀 Monitor Service Started',
    `The monitoring process has started successfully on port **${PORT}**.\nConnecting to Discord Gateway...`,
    [],
    0x3498DB // Blue
  );
});

// 2. Webhook Notification Helper
async function sendAlert(title, description, fields = [], color = 0x5865F2) {
  if (!WEBHOOK_URL || WEBHOOK_URL.includes('YOUR_DISCORD_WEBHOOK_URL') || WEBHOOK_URL.includes('your/webhook/url')) {
    console.log(`⚠️ [Alert Skipped - No Webhook URL Configured] ${title}`);
    return;
  }

  try {
    const embed = {
      title: title,
      description: description,
      color: color,
      timestamp: new Date().toISOString(),
      footer: { text: 'Activity Sentinel • 24/7' }
    };

    // Discord API returns 400 if fields is an empty array []
    if (Array.isArray(fields) && fields.length > 0) {
      embed.fields = fields;
    }

    const payload = {
      username: 'Activity Sentinel',
      content: `**${title}**\n${description}`, // Fallback text in case embeds are suppressed
      embeds: [embed]
    };

    console.log(`📡 [Webhook] Sending "${title}" to Discord...`);

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`❌ [Webhook Error] HTTP ${response.status}: ${errorBody}`);
    } else {
      console.log(`✅ [Webhook Success] "${title}" delivered (HTTP ${response.status})`);
    }
  } catch (err) {
    console.error('❌ [Webhook Network Error]', err.message);
  }
}

// 3. Discord Gateway Connection Management
let heartbeatInterval = null;
let lastSequence = null;
let ws = null;
let reconnectAttempts = 0;

function connectGateway() {
  if (!USER_TOKEN) {
    console.warn('[Gateway] Cannot connect without USER_TOKEN. Waiting for token configuration...');
    return;
  }

  console.log('[Gateway] Connecting to Discord Gateway (v10)...');
  ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');

  ws.on('open', () => {
    console.log('✅ [Gateway] WebSocket connected.');
    reconnectAttempts = 0;
  });

  ws.on('message', (rawData) => {
    try {
      const payload = JSON.parse(rawData.toString());
      const { op, t, d, s } = payload;

      if (s !== null && s !== undefined) {
        lastSequence = s;
      }

      switch (op) {
        // Opcode 10: Hello -> Setup Heartbeat & Identify
        case 10: {
          const intervalMs = d.heartbeat_interval;
          console.log(`[Gateway] Received Hello. Heartbeat interval: ${intervalMs}ms`);

          clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 1, d: lastSequence }));
            }
          }, intervalMs);

          // Identify as a Discord client
          const identifyPayload = {
            op: 2,
            d: {
              token: USER_TOKEN,
              capabilities: 8189,
              properties: {
                os: 'Windows',
                browser: 'Discord Client',
                release_channel: 'stable',
                client_version: '1.0.9150',
                os_version: '10.0.19045'
              },
              presence: {
                status: 'online',
                since: 0,
                afk: false
              }
            }
          };

          ws.send(JSON.stringify(identifyPayload));
          break;
        }

        // Opcode 0: Dispatch Events
        case 0: {
          // Event: READY (Logged in)
          if (t === 'READY') {
            const user = d.user;
            const guildCount = d.guilds?.length || 0;
            console.log(`🎉 [Ready] Logged in as: ${user.username} (ID: ${user.id})`);
            console.log(`📡 [Ready] Monitoring ${guildCount} servers.`);
            
            sendAlert(
              '🟢 Bot Online & Monitoring Active!',
              `Your Discord monitor is now connected and actively scanning.`,
              [
                { name: '👤 Account', value: `**${user.username}** (\`${user.id}\`)`, inline: true },
                { name: '🌐 Servers Watched', value: `**${guildCount}** servers`, inline: true },
                { name: '🔍 Monitored Keywords', value: KEYWORDS.length > 0 ? KEYWORDS.map(k => `\`${k}\``).join(', ') : 'None', inline: false }
              ],
              0x57F287 // Discord Green
            );
          }

          // Event: GUILD_MEMBER_ADD (New member joined)
          if (t === 'GUILD_MEMBER_ADD') {
            const memberName = d.user?.username || 'Unknown';
            const memberId = d.user?.id || 'Unknown';
            const guildId = d.guild_id;

            console.log(`🚨 [New Member] ${memberName} (${memberId}) joined server ${guildId}`);
            
            sendAlert(
              '🚨 New Member Joined Server',
              `A new user joined a server you are in.`,
              [
                { name: 'User', value: `**${memberName}** (\`${memberId}\`)`, inline: true },
                { name: 'Server / Guild ID', value: `\`${guildId}\``, inline: true }
              ],
              0xFEE75C // Yellow/Gold
            );
          }

          // Event: MESSAGE_CREATE (Watch for keywords or mentions)
          if (t === 'MESSAGE_CREATE') {
            const content = d.content || '';
            const author = d.author?.username || 'Unknown';
            const authorId = d.author?.id;
            const channelId = d.channel_id;
            const guildId = d.guild_id || 'Direct Message';

            // Check if message matches any of the alert keywords
            const matchedKeyword = KEYWORDS.find((k) => content.toLowerCase().includes(k));

            if (matchedKeyword && !d.author?.bot) {
              console.log(`💬 [Keyword Triggered] "${matchedKeyword}" by ${author} in channel ${channelId}`);
              
              sendAlert(
                `💬 Keyword Triggered: "${matchedKeyword}"`,
                `**Message:**\n${content.substring(0, 1000)}`,
                [
                  { name: 'Author', value: `${author} (\`${authorId}\`)`, inline: true },
                  { name: 'Channel ID', value: `\`${channelId}\``, inline: true },
                  { name: 'Server ID', value: `\`${guildId}\``, inline: true }
                ],
                0xEB459E // Magenta
              );
            }
          }
          break;
        }

        // Opcode 1: Heartbeat requested by Discord
        case 1:
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: lastSequence }));
          }
          break;

        // Opcode 7 (Reconnect) or Opcode 9 (Invalid session)
        case 7:
        case 9:
          console.warn(`⚠️ [Gateway] Opcode ${op} received (Session expired or reconnect requested). Closing to reconnect...`);
          if (ws) ws.close();
          break;
      }
    } catch (err) {
      console.error('❌ [Message Processing Error]', err);
    }
  });

  ws.on('close', (code, reason) => {
    clearInterval(heartbeatInterval);
    reconnectAttempts++;
    const delay = Math.min(reconnectAttempts * 3000, 30000);
    console.warn(`🔌 [Gateway Disconnected] Code: ${code}, Reason: ${reason || 'N/A'}. Reconnecting in ${delay / 1000}s...`);
    setTimeout(connectGateway, delay);
  });

  ws.on('error', (err) => {
    console.error('❌ [WebSocket Error]', err.message);
  });
}

// Start Gateway Connection
connectGateway();
