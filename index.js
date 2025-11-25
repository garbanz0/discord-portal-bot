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
  CATEGORY_PREFIX = 'client-',
  CHANNEL_NAMES = 'Markups,General',        // <-- now 2 channels by default
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // required for join/leave events
  ],
  partials: [Partials.GuildMember, Partials.User],
});

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---------- helpers ----------

function isValidSnowflake(id) {
  return typeof id === 'string' && /^[0-9]{17,20}$/.test(id);
}

function categoryNameFor(member) {
  const short = member.id.slice(-4);
  const safe = member.user.username.replace(/[^a-z0-9-_]/gi, '').toLowerCase();
  return `${CATEGORY_PREFIX}${safe}-${short}`;
}

// Build safe permission overwrites
function overwritesFor(guild, member) {
  const everyoneId = guild.roles.everyone.id;

  const base = [
    { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
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
  if (isValidSnowflake(staffId) && guild.roles.cache.has(staffId)) {
    base.push({
      id: staffId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
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

  const perms = overwritesFor(guild, member);

  // Create or reuse category
  let category = guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildCategory && ch.name === catName
  );

  if (!category) {
    category = await guild.channels.create({
      name: catName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: perms,
      reason,
    });
  } else {
    // refresh perms (e.g., staff role changed)
    await category.permissionOverwrites.set(perms);
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
      permissionOverwrites: perms,
      reason,
    });
  }

  return category;
}

// Find all categories that belong to a member (robust even if username changes)
// Strategy: match CATEGORY_PREFIX and check permission overwrites include the member.
function findMemberCategories(guild, member) {
  const cats = guild.channels.cache.filter(
    ch =>
      ch.type === ChannelType.GuildCategory &&
      ch.name.startsWith(CATEGORY_PREFIX) &&
      ch.permissionOverwrites?.cache?.has(member.id)
  );
  return Array.from(cats.values());
}

// Delete a member's portal(s) on leave
async function deletePortal(member, reason = 'member left – clean up portal') {
  const guild = member.guild;
  const categories = findMemberCategories(guild, member);

  for (const category of categories) {
    try {
      // delete children first
      const children = guild.channels.cache.filter(ch => ch.parentId === category.id);
      for (const [, child] of children) {
        try {
          await child.delete(reason);
        } catch (e) {
          console.warn(`⚠️ Failed deleting child channel ${child.name}:`, e?.code || e?.message || e);
        }
      }

      // delete category
      await category.delete(reason);
      console.log(`🧹 Deleted portal category ${category.name} for ${member.user.tag}`);
    } catch (e) {
      console.warn(`⚠️ Failed deleting category ${category.name}:`, e?.code || e?.message || e);
    }
  }

  if (!categories.length) {
    // fallback: try name pattern match using snowflake suffix (last 4 digits)
    const suffix = `-${member.id.slice(-4)}`;
    const guess = guild.channels.cache.filter(
      ch => ch.type === ChannelType.GuildCategory && ch.name.endsWith(suffix) && ch.name.startsWith(CATEGORY_PREFIX)
    );
    for (const [, category] of guess) {
      try {
        const children = guild.channels.cache.filter(ch => ch.parentId === category.id);
        for (const [, child] of children) await child.delete(reason);
        await category.delete(reason);
        console.log(`🧹 Deleted guessed portal category ${category.name} for ${member.user.tag}`);
      } catch (e) {
        console.warn(`⚠️ Failed deleting guessed category ${category.name}:`, e?.code || e?.message || e);
      }
    }
  }
}

// ---------- events ----------

// Create 2 private channels for EVERY new member (staff can see all if STAFF_ROLE_ID set)
client.on('guildMemberAdd', async (member) => {
  try {
    console.log(`👤 ${member.user.tag} joined ${member.guild.name}`);
    const category = await ensurePortal(member, 'auto-on-join');

    const first = member.guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildText && ch.parentId === category.id
    );

    if (first) {
      const staffId = (STAFF_ROLE_ID || '').trim();
      const hasStaff = isValidSnowflake(staffId) && member.guild.roles.cache.has(staffId);
      await first.send(
        `Welcome <@${member.id}>! This private space is visible to you${hasStaff ? ' and our staff' : ''}.`
      );
    }
  } catch (err) {
    console.error('❌ Failed to create portal on join:', err);
  }
});

// Clean up when a member leaves
client.on('guildMemberRemove', async (member) => {
  try {
    console.log(`🚪 ${member.user.tag} left ${member.guild.name} — cleaning up portal`);
    await deletePortal(member);
  } catch (err) {
    console.error('❌ Failed to delete portal on leave:', err);
  }
});

client.login(DISCORD_TOKEN);
