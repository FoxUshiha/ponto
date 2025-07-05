
const { SlashCommandBuilder } = require('@discordjs/builders');
const { setApiChannel } = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('api')
    .setDescription('Configura canal de API de pagamento')
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Canal onde o bot ouvirá respostas de pagamento')
        .setRequired(true)
    ),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    await setApiChannel(interaction.guildId, channel.id);
    await interaction.reply({
      content: `✅ Canal de API definido: ${channel}`,
      ephemeral: true
    });
  }
};
