
const { SlashCommandBuilder } = require('@discordjs/builders');
const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auth')
    .setDescription('Ajusta tempo de autorização do servidor')
    .addStringOption(opt =>
      opt
        .setName('serverid')
        .setDescription('ID do servidor (opcional; padrão: este servidor)')
        .setRequired(false)
    ),
  
  async execute(interaction) {
    // somente o owner pode usar
    if (interaction.user.id !== '1378457877085290628') {
      return interaction.reply({ content: '🚫 Acesso negado.', ephemeral: true });
    }

    // monta o modal
    const modal = new ModalBuilder()
      .setCustomId('auth_modal')
      .setTitle('⏱️ Configurar Autorização ⏱️');

    const inputServer = new TextInputBuilder()
      .setCustomId('serverId')
      .setLabel('Server ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const inputTime = new TextInputBuilder()
      .setCustomId('authTime')
      .setLabel('Tempo (±dd:hh:mm:ss)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const inputAction = new TextInputBuilder()
      .setCustomId('authAction')
      .setLabel('Ação (+, set, -, add, reduce, take)')
      .setStyle(TextInputStyle.Short)
      .setValue('+')   // pré-seleciona "+"
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(inputServer),
      new ActionRowBuilder().addComponents(inputTime),
      new ActionRowBuilder().addComponents(inputAction)
    );

    // exibe o modal
    await interaction.showModal(modal);
  }
};
