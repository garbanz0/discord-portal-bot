import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';

const {
  DISCORD_TOKEN,
  STAFF_ROLE_ID,                         // optional but recommended
  CATEGORY_PREFIX = 'client-',           // category prefix per user
  CHANNEL_NAMES = 'ticket,support,files' // 3 channels by default
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers // required for guildMemberAdd
  ],
  partials: [Partials.GuildMember, Partials.User]
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

function categoryNameFor(member) {
  const short = member.id.slice(-4);
  const safe = member.user.username.replace(/[^a-z0-9-_]/gi, '').toLowerCase();
  return `${CATEGORY_PREFIX}${safe}-${short}`;
}

function overwritesFor(guild, member) {
  const ow = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, // hide from everyone
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];
  if (STAFF_ROLE_ID) {
    ow.push({
      id: STAFF_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }
  return ow;
}

async function ensurePortal(member) {
  const guild = member.guild;
  const catName = categoryNameFor(member);
  const channelNames = CHANNEL_NAMES.split(',').map(s => s.trim()).filter(Boolean);
  if (channelNames.length === 0) throw new Error('CHANNEL_NAMES is empty');

  // find or create category
  let category = guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildCategory && ch.name === catName
  );

  if (!category) {
    category = await guild.channels.create({
      name: catName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwritesFor(guild, member),
      reason: 'auto-create portal on join'
    });
  } else {
    // refresh perms in case role/user perms changed
    await category.permissionOverwrites.set(overwritesFor(guild, member));
  }

  // create 3 text channels if missing
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
      reason: 'auto-create portal on join'
    });
  }

  return category;
}

// MAIN: create on join
client.on('guildMemberAdd', async (member) => {
  try {
    console.log(`👤 ${member.user.tag} joined ${member.guild.name}`);
    const category = await ensurePortal(member);

    // optional: drop a welcome line in the first channel under the category
    const first = member.guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildText && ch.parentId === category.id
    );
    if (first) {
      await first.send(
        `Welcome <@${member.id}> — this private space is visible to you${STAFF_ROLE_ID ? ' and our staff' : ''}.`
      );
    }
  } catch (e) {
    console.error('Failed to create portal on join:', e);
  }
});

client.login(DISCORD_TOKEN);
