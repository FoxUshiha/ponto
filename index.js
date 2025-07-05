
// index.js
require('dotenv').config();
const crypto = require('crypto');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const {
  initDatabase,
  startPoint,
  getOpenPoint,
  endPoint,
  getUserTime,
  adjustUserTime,
  closeExpiredPoints,
  checkServerAuths,
  getServerConfig,
  isUserPointedElsewhere,
  setServerAuth,
  setApiChannel,
  formatDuration
} = require('./database');
const { loadCommands } = require('./commands');

const DEFAULT_OWNER_ID = '1378457877085290628';
const EMOJI_ERROR = '⏱️';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel]
});
client.commands = new Collection();

client.once('ready', async () => {
  await initDatabase();
  console.log(`✅ Bot iniciado como ${client.user.tag}`);

  // Carrega e registra globalmente os slash commands
  loadCommands(client);
  const slashData = client.commands.map(cmd => cmd.data);
  await client.application.commands.set(slashData);
  // Registra imediatamente em cada guild para testes
  for (const guild of client.guilds.cache.values()) {
    guild.commands.set(slashData).catch(console.error);
  }
  console.log('Comandos registrados em todas as guilds.');

  // Fecha pontos abertos >24h
  setInterval(async () => {
    const expired = await closeExpiredPoints();
    for (const { guildId, duration } of expired) {
      const cfg = await getServerConfig(guildId);
      if (!cfg.active || !cfg.notifyChannel) continue;
      const ch = await client.channels.fetch(cfg.notifyChannel).catch(() => null);
      if (ch) ch.send(`⏰ Ponto fechado automaticamente. Duração: \`${duration}\``);
    }
  }, 60 * 1000);

  // Desativa servidores expirados
  setInterval(checkServerAuths, 5 * 60 * 1000);
});

client.on('interactionCreate', async interaction => {
  try {
    // ───── Slash Commands ─────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (cmd) return cmd.execute(interaction);
    }

    // ───── ModalSubmit: /subscribe ─────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'subscribe_modal') {
      await interaction.deferReply({ ephemeral: true });

      // 1) Hash da chave
      const key  = interaction.fields.getTextInputValue('paymentKey');
      const hash = crypto.createHash('sha256').update(key).digest('hex');
      // 2) Conf do servidor
      const cfg = await getServerConfig(interaction.guildId);
      if (!cfg.apiChannel) {
        return interaction.editReply('❌ Canal de API não configurado. Use /api.');
      }
      const apiCh = await client.channels.fetch(cfg.apiChannel).catch(() => null);
      if (!apiCh) {
        return interaction.editReply('❌ Não consegui acessar o canal de API.');
      }
      // 3) Envia comando !active
      await apiCh.send(`!active ${hash} ${DEFAULT_OWNER_ID} 10.0`);
      // 4) Aguarda resposta
      const filter = msg => msg.content.startsWith(interaction.user.id);
      try {
        const collected = await apiCh.awaitMessages({ filter, max: 1, time: 5000 });
        const [respId, status] = collected.first().content.split(':');
        if (/^0+$/.test(respId) && status === 'false') {
          return interaction.editReply('⏱️ Falha ao processar pagamento.');
        }
        if (status === 'false') {
          return interaction.editReply('❌ Pagamento recusado.');
        }
        if (status === 'true') {
          await setServerAuth(interaction.guildId, '30d');
          return interaction.editReply('✅ Pagamento aprovado! Licença estendida em 30 dias.');
        }
        return interaction.editReply('⚠️ Resposta inesperada da API.');
      } catch {
        return interaction.editReply('⏱️ Sem resposta da API.');
      }
    }

    // ───── Botões do painel de ponto ────────────────────────────────
    if (interaction.isButton()) {
      const cfg = await getServerConfig(interaction.guildId);
      const now = Date.now();
      // Bloqueia se licença expirada
      if (!cfg.active || (cfg.authDurationMs !== Infinity && now - cfg.serverTimeStart > cfg.authDurationMs)) {
        return interaction.reply({
          content: '⛔ Licença expirada, use /subscribe.',
          ephemeral: true
        });
      }
      // Somente no canal configurado
      if (interaction.channelId !== cfg.panelChannel) return;
      if (interaction.replied || interaction.deferred) return;

      const { customId, user, guildId } = interaction;

      switch (customId) {
        case 'ponto':
          await interaction.deferReply({ ephemeral: true });
          if (await isUserPointedElsewhere(user.id, guildId)) {
            return interaction.editReply('❗ Você já tem ponto aberto em outro servidor.');
          }
          await startPoint(guildId, user.id);
          return interaction.editReply(`⏱️ Ponto batido! (${new Date(now).toLocaleString()})`);

        case 'fechar':
          await interaction.deferReply({ ephemeral: true });
          const openTs = await getOpenPoint(guildId, user.id);
          if (!openTs) {
            return interaction.editReply('❌ Sem ponto aberto.');
          }
          const duration = await endPoint(guildId, user.id);
          return interaction.editReply(`⏱️ Ponto fechado! Duração: ${duration}`);

        case 'ver':
          await interaction.deferReply({ ephemeral: true });
          const rec   = await getUserTime(guildId, user.id);
          const full  = `${rec.days}d ${rec.hours}h ${rec.minutes}m ${rec.seconds}s`;
          const short = `${rec.days}d ${rec.hours}h e ${rec.minutes}m`;
          return interaction.editReply(`⏱️ Seu tempo: ${full}\n🕒 ${short}`);

        case 'adm': {
          const modal = new ModalBuilder()
            .setCustomId('adm_modal')
            .setTitle('⏱️ Banco de Tempo ⏱️');
          const iu = new TextInputBuilder()
            .setCustomId('userId')
            .setLabel('User ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
          const it = new TextInputBuilder()
            .setCustomId('timeDelta')
            .setLabel('Tempo (±dd:hh:mm:ss)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
          const ia = new TextInputBuilder()
            .setCustomId('actionType')
            .setLabel('Ação (+, set, -, add, reduce, take)')
            .setStyle(TextInputStyle.Short)
            .setValue('+')
            .setRequired(true);
          modal.addComponents(
            new ActionRowBuilder().addComponents(iu),
            new ActionRowBuilder().addComponents(it),
            new ActionRowBuilder().addComponents(ia)
          );
          await interaction.showModal(modal);
          return;
        }

        default:
          return;
      }
    }

    // ───── ModalSubmit de ADM ──────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'adm_modal') {
      await interaction.deferReply({ ephemeral: true });
      const target = interaction.fields.getTextInputValue('userId') || interaction.user.id;
      let delta    = interaction.fields.getTextInputValue('timeDelta') || '00:00:00:00';
      const raw    = interaction.fields.getTextInputValue('actionType').toLowerCase().trim();

      // Normaliza para dd:hh:mm:ss
      const parts = delta.split(':').reverse();
      while (parts.length < 4) parts.push('00');
      delta = parts.reverse().join(':');

      let action;
      if (['+', 'add', 'somar'].includes(raw))       action = 'somar';
      else if (['-', 'reduce', 'take', 'subtrair'].includes(raw)) action = 'subtrair';
      else if (['set', 'alterar'].includes(raw))      action = 'alterar';
      else return interaction.editReply('❌ Ação inválida.');

      let result;
      if (action === 'alterar') {
        await adjustUserTime(interaction.guildId, target, `-${delta}`);
        result = await adjustUserTime(interaction.guildId, target, `+${delta}`);
      } else {
        const prefix = action === 'subtrair' ? '-' : '+';
        result = await adjustUserTime(interaction.guildId, target, `${prefix}${delta}`);
      }
      return interaction.editReply(`⏱️ ${result}`);
    }

    // ───── ModalSubmit de /auth ────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'auth_modal') {
      await interaction.deferReply({ ephemeral: true });
      const srvInput = interaction.fields.getTextInputValue('serverId');
      const serverId = srvInput || interaction.guildId;

      let delta = interaction.fields.getTextInputValue('authTime') || '00:00:00:00';
      const raw  = interaction.fields.getTextInputValue('authAction').toLowerCase().trim();

      // Normaliza para dd:hh:mm:ss
      const arr = delta.split(':').reverse();
      while (arr.length < 4) arr.push('00');
      delta = arr.reverse().join(':');

      // Parser dd:hh:mm:ss → ms
      function parseHMS(str) {
        const [dd, hh, mm, ss] = str.split(':').map(x => parseInt(x) || 0);
        return ((dd * 24 + hh) * 3600 + mm * 60 + ss) * 1000;
      }
      const deltaMs = parseHMS(delta);

      // Calcula tempo antigo restante
      const cfg     = await getServerConfig(serverId);
      const now     = Date.now();
      const elapsed = now - cfg.serverTimeStart;
      const oldMs   = cfg.authDurationMs === Infinity ? 0 : cfg.authDurationMs - elapsed;

      // Calcula newMs e garante ≥ 0
      let newMs;
      if (['+', 'add', 'somar'].includes(raw))        newMs = oldMs + deltaMs;
      else if (['-', 'reduce', 'take', 'subtrair'].includes(raw)) newMs = oldMs - deltaMs;
      else if (['set', 'alterar'].includes(raw))       newMs = deltaMs;
      else return interaction.editReply('❌ Ação inválida.');
      newMs = Math.max(0, newMs);

      // Salva e responde
      await setServerAuth(serverId, formatDuration(newMs));
      return interaction.editReply(
        `⏱️ Autorização para servidor **${serverId}** agora é **${formatDuration(newMs)}**.`
      );
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '❌ Erro interno.', ephemeral: true }).catch(() => {});
    }
  }
});


client.login('TOKEN');
