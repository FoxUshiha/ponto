
const { SlashCommandBuilder } = require('@discordjs/builders');
const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('Abre painel de pagamento seguro'),

  async execute(interaction) {
    // Abre o modal para o usuário inserir a chave
    const modal = new ModalBuilder()
      .setCustomId('subscribe_modal')
      .setTitle('🔒 Payment Secured 🔒');

    const inputKey = new TextInputBuilder()
      .setCustomId('paymentKey')
      .setLabel('Insira sua chave de pagamento')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(inputKey)
    );

    // Exibe o modal (único reconhecimento dessa interação)
    await interaction.showModal(modal);
  }
};
