import 'dotenv/config';
import WebSocket from 'ws';
import http from 'http';

// Configuration
const USER_TOKEN = process.env.USER_TOKEN?.trim().replace(/^["']|["']$/g, '');
const WEBHOOK_URL = process.env.WEBHOOK_URL?.trim().replace(/^["']|["']$/g, '');
const PORT = process.env.PORT || 3000;

if (!USER_TOKEN) {
  console.error('❌ ERROR: USER_TOKEN is missing in your .env file!');
  process.exit(1);
}

if (!WEBHOOK_URL) {
  console.error('❌ ERROR: WEBHOOK_URL is missing in your .env file!');
} else {
  console.log(`🔗 [Webhook Configured] URL prefix: ${WEBHOOK_URL.substring(0, 35)}...`);
}

// 1. Lightweight HTTP server for Cloud Hosting Health Checks
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
  sendAlert(
    '🚀 Monitor Service Started',
    `The monitoring process has started successfully.\nConnecting to Discord Gateway...`,
    [],
    0x3498DB
  );
});

// 2. Webhook Queue & Notification Helper (Prevents 429 Rate Limits)
const webhookQueue = [];
let isProcessingQueue = false;

async function processWebhookQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (webhookQueue.length > 0) {
    const { url, payload, title } = webhookQueue[0]; 
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const retryAfter = data.retry_after || 2;
        console.warn(`⏳ [Rate Limited] Webhook 429. Pausing queue for ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue; 
      }

      webhookQueue.shift();

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`❌ [Webhook Error] HTTP ${response.status}: ${errorBody}`);
      } else {
        console.log(`✅ [Webhook Success] "${title}" delivered.`);
      }

    } catch (err) {
      console.error('❌ [Webhook Network Error]', err.message);
      webhookQueue.shift(); 
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  isProcessingQueue = false;
}

async function sendAlert(title, description, fields = [], color = 0x5865F2, thumbnailUrl = null, customContent = null) {
  if (!WEBHOOK_URL || WEBHOOK_URL.includes('YOUR_DISCORD_WEBHOOK_URL') || WEBHOOK_URL.includes('your/webhook/url')) {
    console.log(`⚠️ [Alert Skipped - No Webhook URL Configured] ${title}`);
    return;
  }

  const embed = {
    title: title,
    description: description,
    color: color,
    timestamp: new Date().toISOString(),
    footer: { text: 'Activity Sentinel • 24/7' }
  };

  if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
  if (Array.isArray(fields) && fields.length > 0) embed.fields = fields;

  const payload = {
    username: 'Activity Sentinel',
    content: customContent || `**${title}**\n${description}`,
    embeds: [embed]
  };

  webhookQueue.push({ url: WEBHOOK_URL, payload, title });
  processWebhookQueue();
}

// 3. Discord Gateway & Server Cache Management
let heartbeatInterval = null;
let lastSequence = null;
let ws = null;
let reconnectAttempts = 0;
let isInitialLoadComplete = false;

const guildsCache = new Map(); 
const knownGuildMembers = new Map(); 
const guildSubscriptionState = new Map(); 

function getGuildMemberSet(guildId) {
  const gid = String(guildId);
  if (!knownGuildMembers.has(gid)) {
    knownGuildMembers.set(gid, new Set());
  }
  return knownGuildMembers.get(gid);
}

let guildsFetchPromise = null;

async function fetchUserGuilds() {
  if (!USER_TOKEN) return;
  if (guildsFetchPromise) return guildsFetchPromise;

  guildsFetchPromise = (async () => {
    try {
      const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: { 'Authorization': USER_TOKEN }
      });
      if (response.ok) {
        const guilds = await response.json();
        guilds.forEach((g) => {
          if (g.id && g.name) {
            guildsCache.set(String(g.id), g.name);
          }
        });
        console.log(`📋 [Server Names Loaded] Successfully cached names for ${guilds.length} servers.`);
      }
    } catch (err) {
      console.error('[Error loading server names]', err.message);
    } finally {
      guildsFetchPromise = null;
    }
  })();

  return guildsFetchPromise;
}

function getUserAvatarUrl(user) {
  if (!user || !user.id) return null;
  if (user.avatar) {
    const isGif = user.avatar.startsWith('a_');
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${isGif ? 'gif' : 'png'}?size=256`;
  }
  
  let defaultIndex = 0;
  if (user.discriminator && user.discriminator !== '0') {
    defaultIndex = parseInt(user.discriminator) % 5;
  } else {
    defaultIndex = Number((BigInt(user.id) >> 22n) % 6n);
  }
  
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

async function notifyMemberJoin(user, guildId, source = 'Join Event') {
  if (!user || !user.id) return;
  const userId = String(user.id);
  const gid = String(guildId);
  const username = user.username || user.global_name || 'Unknown User';
  const memberSet = getGuildMemberSet(gid);

  if (memberSet.has(userId)) return;
  memberSet.add(userId);

  if (!guildsCache.has(gid)) {
    await fetchUserGuilds();
  }

  const serverName = guildsCache.get(gid) || 'Discord Server';
  console.log(`🚨 [New Member Alert] \`${username}\` joined "${serverName}" [via ${source}]`);

  const userProfileLink = `https://discord.com/users/${userId}`;
  const serverLink = `https://discord.com/channels/${gid}`;
  const avatarUrl = getUserAvatarUrl(user);

  const tapToCopyLine = `\`${username}\` ← (tap to copy) joined: [**${serverName}**](${serverLink})!`;

  sendAlert(
    '🚨 New Member Joined Server',
    tapToCopyLine,
    [
      { name: '👤 User Profile', value: `[**${username}**](${userProfileLink})`, inline: true },
      { name: '📋 Tap to Copy', value: `\`${username}\``, inline: true },
      { name: '🌐 Server', value: `[**${serverName}**](${serverLink})`, inline: true }
    ],
    0xFEE75C,
    avatarUrl,
    tapToCopyLine
  );
}

function handleMemberLeave(userId, guildId, source = 'Leave Event') {
  if (!userId || !guildId) return;
  const gid = String(guildId);
  const memberSet = getGuildMemberSet(gid);
  if (memberSet.has(String(userId))) {
    memberSet.delete(String(userId));
    const serverName = guildsCache.get(gid) || 'Discord Server';
    console.log(`👋 [Member Left] A user left "${serverName}" [via ${source}]`);
  }
}

function trySubscribeNextChannel(guildId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const gid = String(guildId);
  const state = guildSubscriptionState.get(gid);
  const serverName = guildsCache.get(gid) || gid;
  
  if (!state) return;
  
  if (state.channels.length === 0) {
    ws.send(JSON.stringify({
      op: 14,
      d: { guild_id: gid, typing: true, threads: true, activities: true, member_updates: true, members: [] }
    }));
    return;
  }
  
  if (state.currentIndex >= state.channels.length) {
    console.log(`⚠️ [Gateway] Exhausted all channels for server "${serverName}".`);
    return;
  }
  
  const channelId = state.channels[state.currentIndex];
  state.currentIndex++;
  state.lastTriedChannelId = channelId; 
  
  const channelsMap = {};
  channelsMap[channelId] = [[0, 99]];
  
  console.log(`📡 [Gateway] Attempting Opcode 14 subscription on "${serverName}" (Channel: ${channelId})`);
  ws.send(JSON.stringify({
    op: 14,
    d: {
      guild_id: gid, typing: true, threads: true, activities: true, member_updates: true,
      members: [], channels: channelsMap
    }
  }));
  
  clearTimeout(state.timeout);
  state.timeout = setTimeout(() => {
    const checkState = guildSubscriptionState.get(gid);
    if (checkState && !checkState.syncReceived) {
      console.log(`🔄 [Gateway] Channel ${channelId} rejected. Trying next...`);
      trySubscribeNextChannel(gid);
    }
  }, 3500);
}

function connectGateway() {
  if (!USER_TOKEN) return;

  console.log('[Gateway] Connecting to Discord Gateway (v10)...');
  ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');

  ws.on('open', () => {
    console.log('✅ [Gateway] WebSocket connected.');
    reconnectAttempts = 0;
  });

  ws.on('message', async (rawData) => {
    try {
      const payload = JSON.parse(rawData.toString());
      const { op, t, d, s } = payload;

      if (s !== null && s !== undefined) lastSequence = s;

      switch (op) {
        case 10: {
          const intervalMs = d.heartbeat_interval;
          clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 1, d: lastSequence }));
            }
          }, intervalMs);

          ws.send(JSON.stringify({
            op: 2,
            d: {
              token: USER_TOKEN,
              capabilities: 8189,
              properties: { os: 'Windows', browser: 'Discord Client', release_channel: 'stable', client_version: '1.0.9150', os_version: '10.0.19045' },
              presence: { status: 'online', since: 0, afk: false }
            }
          }));
          break;
        }

        case 0: {
          if (t === 'READY') {
            const user = d.user;
            const guilds = d.guilds || [];
            console.log(`🎉 [Ready] Logged in as: ${user.username}`);

            await fetchUserGuilds();
            const accountUrl = `https://discord.com/users/${user.id}`;
            
            sendAlert(
              '🟢 Bot Online & Monitoring Active!',
              `Your Discord monitor is now connected and actively scanning for new members.`,
              [
                { name: '👤 Account', value: `[**${user.username}**](${accountUrl})`, inline: true },
                { name: '🌐 Servers Watched', value: `**${guilds.length}** servers`, inline: true }
              ],
              0x57F287,
              getUserAvatarUrl(user)
            );

            guilds.forEach((guild) => {
              const gid = String(guild.id);
              if (guild.name) guildsCache.set(gid, guild.name);
              const serverName = guild.name || gid;
              const memberSet = getGuildMemberSet(gid);
              
              if (Array.isArray(guild.members)) {
                guild.members.forEach((m) => {
                  if (m.user?.id) memberSet.add(String(m.user.id));
                });
              }

              const prioritizedChannels = [];
              if (guild.system_channel_id) prioritizedChannels.push(String(guild.system_channel_id));
              if (guild.rules_channel_id) prioritizedChannels.push(String(guild.rules_channel_id));
              if (guild.public_updates_channel_id) prioritizedChannels.push(String(guild.public_updates_channel_id));
              
              const otherChannels = (guild.channels || [])
                .filter(c => c.type === 0 || c.type === 5 || c.type === 15)
                .map(c => String(c.id))
                .filter(id => !prioritizedChannels.includes(id));
                
              const allChannelsToTry = [...new Set([...prioritizedChannels, ...otherChannels])];
              
              guildSubscriptionState.set(gid, {
                  channels: allChannelsToTry, currentIndex: 0, syncReceived: false, timeout: null, lastTriedChannelId: null
              });
              
              trySubscribeNextChannel(gid);
            });

            setTimeout(() => {
              isInitialLoadComplete = true;
              console.log('⚡ [Real-Time Member Stream Active] Watching all server channels.');
            }, 3000);
          }

          else if (t === 'GUILD_CREATE') {
            const gid = String(d.id);
            
            // FIX 1: Check if we already knew about this server BEFORE processing this event
            const wasKnown = guildsCache.has(gid);
            
            if (d.name) guildsCache.set(gid, d.name);
            let serverName = d.name || guildsCache.get(gid);

            // FIX 2: REST API Fallback if Discord sends a "lazy loaded" payload without a name
            if (!serverName || serverName === gid) {
              try {
                console.log(`🔍 [Gateway] Missing name for ${gid}, fetching from REST API...`);
                const res = await fetch(`https://discord.com/api/v10/guilds/${gid}`, {
                  headers: { 'Authorization': USER_TOKEN }
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data.name) {
                    serverName = data.name;
                    guildsCache.set(gid, serverName);
                  }
                }
              } catch (err) {
                console.error(`[Gateway] Failed to fetch server name for ${gid}:`, err.message);
              }
            }
            
            if (!serverName) serverName = gid;

            console.log(`🛠️ [Gateway] Processing GUILD_CREATE for "${serverName}"...`);
            const memberSet = getGuildMemberSet(gid);
            
            if (Array.isArray(d.members)) {
              d.members.forEach((m) => { if (m.user?.id) memberSet.add(String(m.user.id)); });
            }

            const prioritizedChannels = [];
            if (d.system_channel_id) prioritizedChannels.push(String(d.system_channel_id));
            if (d.rules_channel_id) prioritizedChannels.push(String(d.rules_channel_id));
            if (d.public_updates_channel_id) prioritizedChannels.push(String(d.public_updates_channel_id));
            
            const otherChannels = (d.channels || [])
              .filter(c => c.type === 0 || c.type === 5 || c.type === 15)
              .map(c => String(c.id))
              .filter(id => !prioritizedChannels.includes(id));
              
            const allChannelsToTry = [...new Set([...prioritizedChannels, ...otherChannels])];
            
            guildSubscriptionState.set(gid, {
                channels: allChannelsToTry, currentIndex: 0, syncReceived: false, timeout: null, lastTriedChannelId: null
            });
            trySubscribeNextChannel(gid);

            // FIX 3: Only alert if this is genuinely NEW (not present in cache before this event, and bot is online)
            if (!wasKnown && isInitialLoadComplete) {
              sendAlert(
                '🚀 New Server Added to Monitoring',
                `Your account joined [**${serverName}**](https://discord.com/channels/${gid})!\nThe bot is now actively monitoring this server.`,
                [
                  { name: '🌐 Server', value: `[**${serverName}**](https://discord.com/channels/${gid})`, inline: true },
                  { name: '👥 Total Members', value: `**${d.member_count || memberSet.size || 'N/A'}**`, inline: true }
                ],
                0x3498DB,
                d.icon ? `https://cdn.discordapp.com/icons/${gid}/${d.icon}.png?size=256` : null
              );
            }
          }

          else if (t === 'GUILD_MEMBER_ADD') {
            notifyMemberJoin(d.user, d.guild_id, 'Gateway Member Add');
          }

          else if (t === 'GUILD_MEMBER_REMOVE') {
            handleMemberLeave(d.user?.id, d.guild_id, 'Gateway Member Remove');
          }

          else if (t === 'GUILD_MEMBER_LIST_UPDATE') {
            const guildId = String(d.guild_id);
            const listId = String(d.id);
            const state = guildSubscriptionState.get(guildId);
            
            if (state && !state.syncReceived && listId === String(state.lastTriedChannelId)) {
              state.syncReceived = true;
              clearTimeout(state.timeout);
              const serverName = guildsCache.get(guildId) || guildId;
              console.log(`✅ [Gateway] Subscribed to "${serverName}" (Channel: ${listId})!`);
            }

            if (Array.isArray(d.ops)) {
              for (const op of d.ops) {
                if (op.op === 'INSERT' && op.item?.member?.user) {
                  const user = op.item.member.user;
                  const joinedAtStr = op.item.member.joined_at;
                  
                  if (joinedAtStr) {
                    const joinedAt = new Date(joinedAtStr).getTime();
                    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
                    
                    if (joinedAt > fiveMinutesAgo) {
                      notifyMemberJoin(user, guildId, 'List Update (Insert)');
                    } else {
                      getGuildMemberSet(guildId).add(String(user.id));
                    }
                  } else {
                     getGuildMemberSet(guildId).add(String(user.id));
                  }
                }
              }
            }
          }

          else if (t === 'MESSAGE_CREATE') {
            if (d.guild_id && d.type === 7 && d.author) {
              notifyMemberJoin(d.author, String(d.guild_id), 'System Join Message');
            }
          }
          break;
        }

        case 1:
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 1, d: lastSequence }));
          break;

        case 7:
        case 9:
          console.warn(`⚠️ [Gateway] Opcode ${op} received. Reconnecting...`);
          if (ws) ws.close();
          break;
      }
    } catch (err) {
      console.error('❌ [Message Processing Error]', err);
    }
  });

  ws.on('close', (code, reason) => {
    clearInterval(heartbeatInterval);
    guildSubscriptionState.forEach(state => clearTimeout(state.timeout));
    
    reconnectAttempts++;
    const delay = Math.min(reconnectAttempts * 3000, 30000);
    console.warn(`🔌 [Gateway Disconnected] Code: ${code}. Reconnecting in ${delay / 1000}s...`);
    setTimeout(connectGateway, delay);
  });

  ws.on('error', (err) => {
    console.error('❌ [WebSocket Error]', err.message);
  });
}

fetchUserGuilds().then(connectGateway);
