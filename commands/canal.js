
// commands/canal.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { setPanelChannel } = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('canal')
    .setDescription('Envia painel de ponto e configura o canal para interações')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Canal para enviar o painel de ponto')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Apenas o dono do servidor
    if (interaction.member.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: '❌ Acesso negado.', ephemeral: true });
    }

    const canal = interaction.options.getChannel('channel');

    // 1) Salva no banco como panelChannel
    await setPanelChannel(interaction.guildId, canal.id);

    // 2) Constrói o painel
    const embed = new EmbedBuilder()
      .setTitle('⏱️ Ponto')
      .setDescription('Clique abaixo para bater ponto, fechar, ver tempo ou configurar.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ponto')
        .setLabel('Bater Ponto')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('fechar')
        .setLabel('Fechar Ponto')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('ver')
        .setLabel('Ver Tempo')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('adm')
        .setLabel('ADM')
        .setEmoji('⚙️')
        .setStyle(ButtonStyle.Secondary)
    );

    // 3) Envia no canal e confirma
    await canal.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: `✅ Painel enviado em ${canal} e canal registrado.`, ephemeral: true });
  }
};
