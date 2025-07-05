
const { SlashCommandBuilder } = require('@discordjs/builders');
const { getServerConfig } = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Mostra o tempo restante de ativação do bot no servidor'),

  async execute(interaction) {
    // Só em servidor
    if (!interaction.guildId) {
      return interaction.reply({ content: '❌ Esse comando só pode ser usado em um servidor.', ephemeral: true });
    }

    const cfg = await getServerConfig(interaction.guildId);

    // Licença ilimitada
    if (cfg.authDurationMs === Infinity) {
      return interaction.reply({ content: '✅ Licença ilimitada.', ephemeral: true });
    }

    // Licença expirada
    if (!cfg.active) {
      return interaction.reply({ content: '⛔ Licença expirada.', ephemeral: true });
    }

    const now = Date.now();
    const elapsed = now - cfg.serverTimeStart;
    let remaining = cfg.authDurationMs - elapsed;
    if (remaining < 0) remaining = 0;

    // Formata tempo restante
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const formatted = `${days}d ${hours}h ${minutes}m ${seconds}s`;

    return interaction.reply({ content: `⏳ Tempo restante de ativação: ${formatted}`, ephemeral: true });
  }
};
