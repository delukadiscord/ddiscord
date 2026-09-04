import 'dotenv/config';
import WebSocket from 'ws';
import http from 'http';

// Configuration
const USER_TOKEN = process.env.USER_TOKEN?.trim().replace(/^["']|["']$/g, '');
const WEBHOOK_URL = process.env.WEBHOOK_URL?.trim().replace(/^["']|["']$/g, '');
const PORT = process.env.PORT || 3000;

if (!USER_TOKEN) {
  console.error('❌ ERROR: USER_TOKEN is missing in your .env file!');
  process.exit(1); // Exit immediately if token is missing to prevent hanging
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

// 2. Webhook Notification Helper
async function sendAlert(title, description, fields = [], color = 0x5865F2, thumbnailUrl = null, customContent = null) {
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

    if (thumbnailUrl) {
      embed.thumbnail = { url: thumbnailUrl };
    }

    if (Array.isArray(fields) && fields.length > 0) {
      embed.fields = fields;
    }

    const payload = {
      username: 'Activity Sentinel',
      content: customContent || `**${title}**\n${description}`,
      embeds: [embed]
    };

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

// 3. Discord Gateway & Server Cache Management
let heartbeatInterval = null;
let lastSequence = null;
let ws = null;
let reconnectAttempts = 0;
let isInitialLoadComplete = false;

// Cache exact server names and known members per guild
const guildsCache = new Map(); // String(guildId) -> String(guildName)
const knownGuildMembers = new Map(); // String(guildId) -> Set<userId>
const guildSubscriptionState = new Map(); // guildId -> { channels: Array, currentIndex: Number, syncReceived: Boolean, timeout: NodeJS.Timeout, lastTriedChannelId: String }

function getGuildMemberSet(guildId) {
  const gid = String(guildId);
  if (!knownGuildMembers.has(gid)) {
    knownGuildMembers.set(gid, new Set());
  }
  return knownGuildMembers.get(gid);
}

// Promise lock to prevent concurrent API calls causing rate limits
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
  
  // Fix: Improved default avatar logic for both legacy and new username systems
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

  // Skip if already recorded in this server
  if (memberSet.has(userId)) return;
  memberSet.add(userId);

  // If server name is not yet in cache, fetch immediately
  if (!guildsCache.has(gid)) {
    await fetchUserGuilds();
  }

  const serverName = guildsCache.get(gid) || 'Discord Server';
  console.log(`🚨 [New Member Alert] \`${username}\` joined "${serverName}" [via ${source}]`);

  // Direct Clickable Discord Links & Screenshot Tap-to-Copy format
  const userProfileLink = `https://discord.com/users/${userId}`;
  const serverLink = `https://discord.com/channels/${gid}`;
  const avatarUrl = getUserAvatarUrl(user);

  // Exact tap-to-copy line matching screenshot
  const tapToCopyLine = `\`${username}\` ← (tap to copy) joined: [**${serverName}**](${serverLink})!`;

  sendAlert(
    '🚨 New Member Joined Server',
    tapToCopyLine,
    [
      { name: '👤 User Profile', value: `[**${username}**](${userProfileLink})`, inline: true },
      { name: '📋 Tap to Copy', value: `\`${username}\``, inline: true },
      { name: '🌐 Server', value: `[**${serverName}**](${serverLink})`, inline: true }
    ],
    0xFEE75C, // Yellow / Gold
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

// Opcode 14: Subscribe to real-time member lists for the guild by scanning for a visible channel
function trySubscribeNextChannel(guildId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const gid = String(guildId);
  const state = guildSubscriptionState.get(gid);
  const serverName = guildsCache.get(gid) || gid;
  
  if (!state) return;
  
  if (state.channels.length === 0) {
    console.log(`⚠️ [Gateway] No valid text channels found for "${serverName}". Subscribing to guild without channel...`);
    ws.send(JSON.stringify({
      op: 14,
      d: {
        guild_id: gid,
        typing: true,
        threads: true,
        activities: true,
        member_updates: true, // Future-proofing for Opcode 37
        members: []
      }
    }));
    return;
  }
  
  if (state.currentIndex >= state.channels.length) {
    console.log(`⚠️ [Gateway] Exhausted all channels for server "${serverName}". Member join detection might fail if no welcome messages exist.`);
    return;
  }
  
  const channelId = state.channels[state.currentIndex];
  state.currentIndex++;
  state.lastTriedChannelId = channelId; // CRITICAL FIX: Track exactly which channel we just tried
  
  const channelsMap = {};
  channelsMap[channelId] = [[0, 99]];
  
  console.log(`📡 [Gateway] Attempting Opcode 14 subscription on "${serverName}" (Channel: ${channelId})`);
  ws.send(JSON.stringify({
    op: 14,
    d: {
      guild_id: gid,
      typing: true,
      threads: true,
      activities: true,
      member_updates: true,
      members: [],
      channels: channelsMap
    }
  }));
  
  // Wait 3.5 seconds to see if Discord accepts this channel (by sending a SYNC for this specific channel)
  clearTimeout(state.timeout);
  state.timeout = setTimeout(() => {
    const checkState = guildSubscriptionState.get(gid);
    if (checkState && !checkState.syncReceived) {
      console.log(`🔄 [Gateway] Channel ${channelId} rejected/ignored by Discord for guild "${serverName}". Trying next...`);
      trySubscribeNextChannel(gid);
    }
  }, 3500); // Slightly increased to 3.5s to account for Gateway latency
}

function connectGateway() {
  if (!USER_TOKEN) {
    console.warn('[Gateway] Cannot connect without USER_TOKEN.');
    return;
  }

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

      if (s !== null && s !== undefined) {
        lastSequence = s;
      }

      switch (op) {
        case 10: {
          const intervalMs = d.heartbeat_interval;
          console.log(`[Gateway] Received Hello. Heartbeat interval: ${intervalMs}ms`);

          clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 1, d: lastSequence }));
            }
          }, intervalMs);

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

        case 0: {
          // READY
          if (t === 'READY') {
            const user = d.user;
            const guilds = d.guilds || [];
            console.log(`🎉 [Ready] Logged in as: ${user.username}`);
            console.log(`📡 [Ready] Monitoring ${guilds.length} servers.`);

            // Pre-fetch actual server names via REST API
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

            // User accounts receive the full guild data inside the READY payload.
            guilds.forEach((guild) => {
              const gid = String(guild.id);
              if (guild.name) guildsCache.set(gid, guild.name);
              const serverName = guild.name || gid;

              console.log(`🛠️ [Gateway] Processing READY guild for "${serverName}"...`);
              
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
                .filter(c => c.type === 0 || c.type === 5 || c.type === 15) // Added Forum channels (15)
                .map(c => String(c.id))
                .filter(id => !prioritizedChannels.includes(id));
                
              const allChannelsToTry = [...new Set([...prioritizedChannels, ...otherChannels])];
              
              console.log(`📡 [Gateway] "${serverName}" has ${allChannelsToTry.length} text channels to try.`);

              guildSubscriptionState.set(gid, {
                  channels: allChannelsToTry,
                  currentIndex: 0,
                  syncReceived: false,
                  timeout: null,
                  lastTriedChannelId: null // Initialize tracking ID
              });
              
              trySubscribeNextChannel(gid);
            });

            // Mark initial server loading phase complete after 3 seconds
            setTimeout(() => {
              isInitialLoadComplete = true;
              console.log('⚡ [Real-Time Member Stream Active] Watching all server channels.');
            }, 3000);
          }

          // GUILD_CREATE (Streams all channels and members for each guild)
          else if (t === 'GUILD_CREATE') {
            const gid = String(d.id);
            const isNewJoin = isInitialLoadComplete && !guildsCache.has(gid);

            if (d.name) guildsCache.set(gid, d.name);

            const serverName = d.name || gid;
            console.log(`🛠️ [Gateway] Processing GUILD_CREATE for "${serverName}"...`);

            const memberSet = getGuildMemberSet(gid);
            if (Array.isArray(d.members)) {
              d.members.forEach((m) => {
                if (m.user?.id) memberSet.add(String(m.user.id));
              });
            }

            // Extract ALL text channels, prioritize likely visible ones
            const prioritizedChannels = [];
            if (d.system_channel_id) prioritizedChannels.push(String(d.system_channel_id));
            if (d.rules_channel_id) prioritizedChannels.push(String(d.rules_channel_id));
            if (d.public_updates_channel_id) prioritizedChannels.push(String(d.public_updates_channel_id));
            
            const otherChannels = (d.channels || [])
              .filter(c => c.type === 0 || c.type === 5 || c.type === 15)
              .map(c => String(c.id))
              .filter(id => !prioritizedChannels.includes(id));
              
            const allChannelsToTry = [...new Set([...prioritizedChannels, ...otherChannels])]; // Unique channels
            
            console.log(`📡 [Gateway] "${serverName}" has ${allChannelsToTry.length} text channels to try.`);

            guildSubscriptionState.set(gid, {
                channels: allChannelsToTry,
                currentIndex: 0,
                syncReceived: false,
                timeout: null,
                lastTriedChannelId: null
            });
            
            // Start the subscription scan to find a valid channel for Opcode 14
            trySubscribeNextChannel(gid);

            // If user joined a new server live
            if (isNewJoin) {
              const serverLink = `https://discord.com/channels/${gid}`;
              const serverIconUrl = d.icon
                ? `https://cdn.discordapp.com/icons/${gid}/${d.icon}.png?size=256`
                : null;

              console.log(`🚀 [New Server Added] You joined "${serverName}"`);

              sendAlert(
                '🚀 New Server Added to Monitoring',
                `Your account joined [**${serverName}**](${serverLink})!\nThe bot is now actively monitoring this server for new members.`,
                [
                  { name: '🌐 Server', value: `[**${serverName}**](${serverLink})`, inline: true },
                  { name: '👥 Total Members', value: `**${d.member_count || memberSet.size || 'N/A'}**`, inline: true }
                ],
                0x3498DB, // Blue
                serverIconUrl
              );
            }
          }

          // GUILD_MEMBER_ADD (Direct gateway join event - Fallback if Opcode 14 fails)
          else if (t === 'GUILD_MEMBER_ADD') {
            notifyMemberJoin(d.user, d.guild_id, 'Gateway Member Add');
          }

          // GUILD_MEMBER_REMOVE (Member left)
          else if (t === 'GUILD_MEMBER_REMOVE') {
            handleMemberLeave(d.user?.id, d.guild_id, 'Gateway Member Remove');
          }

          // GUILD_MEMBER_LIST_UPDATE (Member list updates & JOIN DETECTION)
          else if (t === 'GUILD_MEMBER_LIST_UPDATE') {
            const guildId = String(d.guild_id);
            const listId = String(d.id); // This represents the Channel ID or "everyone"
            const state = guildSubscriptionState.get(guildId);
            
            // CRITICAL FIX 1: Prevent False Positives
            // Only mark syncReceived IF the update is for the specific channel we just tried to subscribe to
            if (state && !state.syncReceived && listId === String(state.lastTriedChannelId)) {
              state.syncReceived = true;
              clearTimeout(state.timeout);
              const serverName = guildsCache.get(guildId) || guildId;
              console.log(`✅ [Gateway] Successfully subscribed to member stream for "${serverName}" (Channel: ${listId})!`);
            }

            // CRITICAL FIX 2: Parse "ops" Array to Detect New Members
            // User tokens rarely get GUILD_MEMBER_ADD directly. Instead, Discord sends "INSERT" ops.
            if (Array.isArray(d.ops)) {
              for (const op of d.ops) {
                // "INSERT" operations indicate a new member was added to the subscribed list
                if (op.op === 'INSERT' && op.item?.member?.user) {
                  notifyMemberJoin(op.item.member.user, guildId, 'List Update (Insert)');
                }
                // Note: "DELETE" ops only provide an index, not the user ID. 
                // We rely on GUILD_MEMBER_REMOVE or MESSAGE_CREATE fallbacks for leaves.
              }
            }
          }

          // MESSAGE_CREATE (System Join Messages as final fallback)
          else if (t === 'MESSAGE_CREATE') {
            // Ensure d.guild_id exists to prevent passing "undefined" as a guild ID (e.g. from DMs)
            if (d.guild_id && d.type === 7 && d.author) {
              notifyMemberJoin(d.author, String(d.guild_id), 'System Join Message');
            }
          }
          break;
        }

        case 1:
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: lastSequence }));
          }
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
    // Clear all pending timeouts
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

// Start
fetchUserGuilds().then(connectGateway);