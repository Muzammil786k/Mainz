import { EmbedBuilder, PermissionFlagsBits, type Message, type TextChannel } from "discord.js";

async function deleteConfirm(message: Message, deleted: number, label: string): Promise<void> {
  const reply = await (message.channel as TextChannel).send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(`✅ Deleted **${deleted}** ${label} message${deleted !== 1 ? "s" : ""}.`),
    ],
  });
  setTimeout(() => reply.delete().catch(() => {}), 4000);
}

export async function handlePurge(message: Message): Promise<void> {
  if (!message.guild) return;

  const member = message.guild.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setDescription("❌ You need **Manage Messages** permission to use this command."),
      ],
    });
    return;
  }

  const args = message.content.trim().split(/\s+/).slice(1);
  const amount = parseInt(args[0]);

  if (isNaN(amount) || amount < 1 || amount > 100) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setDescription("❌ Please provide a number between **1** and **100**.\n**Usage:** `!purge <amount>`"),
      ],
    });
    return;
  }

  const channel = message.channel as TextChannel;

  // +1 to include the command message itself
  const messages = await channel.messages.fetch({ limit: amount + 1 });
  const deleted = await channel.bulkDelete(messages, true).catch(() => null);

  const count = deleted ? deleted.size : 0;
  await deleteConfirm(message, count, "");
}

export async function handlePurgeBot(message: Message): Promise<void> {
  if (!message.guild) return;

  const member = message.guild.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setDescription("❌ You need **Manage Messages** permission to use this command."),
      ],
    });
    return;
  }

  const args = message.content.trim().split(/\s+/).slice(1);
  const limit = parseInt(args[0] ?? "50");
  const fetchLimit = isNaN(limit) || limit < 1 || limit > 100 ? 50 : limit;

  const channel = message.channel as TextChannel;
  const messages = await channel.messages.fetch({ limit: 100 });

  // Filter only bot messages + the command message itself
  const toDelete = messages.filter(
    (m) => m.author.bot || m.id === message.id
  ).first(fetchLimit + 1);

  const deleted = await channel.bulkDelete(toDelete, true).catch(() => null);
  const count = deleted ? deleted.size : 0;
  await deleteConfirm(message, count, "bot");
}
