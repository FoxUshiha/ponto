
const { SlashCommandBuilder } = require('@discordjs/builders');
const { setAdminRole } = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cargo')
    .setDescription('Define cargo que pode usar o botão ADM')
    .addRoleOption(opt =>
      opt
        .setName('role')
        .setDescription('Cargo com permissão ADM')
        .setRequired(true)
    ),
  async execute(interaction) {
    if (interaction.member.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: '❌ Acesso negado.', ephemeral: true });
    }
    const role = interaction.options.getRole('role');
    await setAdminRole(interaction.guildId, role.id);
    return interaction.reply({ content: `✅ Cargo definido: ${role}`, ephemeral: true });
  }
};
