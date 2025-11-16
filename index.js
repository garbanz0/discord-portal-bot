import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';

const {
  DISCORD_TOKEN,
  STAFF_ROLE_ID,                           // optional but recommended
  CATEGORY_PREFIX = 'client-',             // category prefix per user
  CHANNEL_NAMES = 'Important contact information,Markups,General',  // default 3 text channels
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN in environment variables.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // required for guildMemberAdd
  ],
  partials: [Partials.GuildMember, Partials.User],
});

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ----- helpers -----

function categoryNameFor(member) {
  const short = member.id.slice(-4);
  const safe = member.user.username.replace(/[^a-z0-9-_]/gi, '').toLowerCase();
  return `${CATEGORY_PREFIX}${safe}-${short}`;
}

// Build permission overwrites safely.
// - Hides from @everyone
// - Grants the new member access
// - Grants Staff role access if STAFF_ROLE_ID is set *and exists* in the guild
function overwritesFor(guild, member) {
  const base = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, // @everyone hidden
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];

  const staffId = (STAFF_ROLE_ID || '').trim();
  if (staffId && guild.roles.cache.has(staffId)) {
    base.push({
      id: staffId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages, // optional but handy for staff
      ],
    });
  }

  return base;
}

// Create (or ensure) the category + channels for a member
async function ensurePortal(member, reason = 'auto-create portal on join') {
  const guild = member.guild;
  const catName = categoryNameFor(member);
  const channelNames = CHANNEL_NAMES.split(',').map(s => s.trim()).filter(Boolean);
  if (channelNames.length === 0) throw new Error('CHANNEL_NAMES is empty');

  // Create or reuse category
  let category = guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildCategory && ch.name === catName
  );

  if (!category) {
    category = await guild.channels.create({
      name: catName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwritesFor(guild, member),
      reason,
    });
  } else {
    // Refresh perms in case Staff role changed later
    await category.permissionOverwrites.set(overwritesFor(guild, member));
  }

  // Ensure each text channel exists
  for (const name of channelNames) {
    const exists = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildText && ch.parentId === category.id && ch.name === name
    );
    if (exists) continue;

    await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwritesFor(guild, member),
      reason,
    });
  }

  return category;
}

// ----- events -----

// For EVERY new member (including Staff), create their private portal.
// Staff role (if set) will be able to see *everyone's* portals.
client.on('guildMemberAdd', async (member) => {
  try {
    console.log(`👤 ${member.user.tag} joined ${member.guild.name}`);
    const category = await ensurePortal(member, 'auto-on-join');

    // Optional: send a welcome note in the first text channel under the category
    const first = member.guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildText && ch.parentId === category.id
    );
    if (first) {
      const staffId = (STAFF_ROLE_ID || '').trim();
      await first.send(
        `Welcome <@${member.id}>! This private space is visible to you${
          staffId && member.guild.roles.cache.has(staffId) ? ' and our staff' : ''
        }.`
      );
    }
  } catch (err) {
    console.error('❌ Failed to create portal on join:', err);
  }
});

client.login(DISCORD_TOKEN);
