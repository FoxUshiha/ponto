// database.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// Diretório e caminho do banco
const USERS_DIR = path.resolve(__dirname, 'users');
const DB_PATH   = path.join(USERS_DIR, 'database.db');
let db;

// Decompõe milissegundos em dias, horas, minutos e segundos
function decomposeDuration(ms) {
  const days    = Math.floor(ms / 86400000);
  ms %= 86400000;
  const hours   = Math.floor(ms / 3600000);
  ms %= 3600000;
  const minutes = Math.floor(ms / 60000);
  ms %= 60000;
  const seconds = Math.floor(ms / 1000);
  return { days, hours, minutes, seconds };
}

// Formata duração em string legível
function formatDuration(ms) {
  const { days, hours, minutes, seconds } = decomposeDuration(ms);
  return `${days}d ${String(hours).padStart(2,'0')}h ${String(minutes).padStart(2,'0')}m ${String(seconds).padStart(2,'0')}s`;
}

// Converte string como "30m" ou "1h30m" em milissegundos
function parseDuration(str) {
  const unitMap = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  const parts = str.match(/(\d+)([dhms])/g);
  let ms = 0;
  if (parts) {
    for (const p of parts) {
      const [, v, u] = p.match(/(\d+)([dhms])/);
      ms += parseInt(v, 10) * (unitMap[u] || 0);
    }
  }
  return ms;
}

// Inicializa o banco, tabelas e migrações
async function initDatabase() {
  if (!fs.existsSync(USERS_DIR)) {
    fs.mkdirSync(USERS_DIR, { recursive: true });
  }
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // Configurações importantes
  await db.exec('PRAGMA journal_mode = WAL;');
  await db.exec('PRAGMA foreign_keys = ON;');

  // Cria tabelas se não existirem
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_time (
      guild_id    TEXT,
      user_id     TEXT,
      total_time  INTEGER DEFAULT 0,
      open_start  INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS server_config (
      server_id          TEXT PRIMARY KEY,
      panel_channel      TEXT,
      notify_channel     TEXT,
      admin_role         TEXT,
      active             INTEGER DEFAULT 1,
      server_time_start  INTEGER,
      auth_duration_ms   INTEGER
    );
  `);

  // Migrações: adiciona colunas novas se o DB for antigo
  try {
    await db.exec('ALTER TABLE server_config ADD COLUMN api_channel TEXT');
  } catch (e) {}
  try {
    await db.exec('ALTER TABLE server_config ADD COLUMN owner_id TEXT');
  } catch (e) {}
}

// Controle de pontos de usuários
async function startPoint(guildId, userId) {
  const now = Date.now();
  await db.run(
    `INSERT INTO user_time (guild_id, user_id, total_time, open_start)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE
       SET open_start = excluded.open_start`,
    guildId, userId, now
  );
}

async function getOpenPoint(guildId, userId) {
  const row = await db.get(
    'SELECT open_start FROM user_time WHERE guild_id = ? AND user_id = ?',
    guildId, userId
  );
  return row ? row.open_start : null;
}

async function endPoint(guildId, userId) {
  const now = Date.now();
  const row = await db.get(
    'SELECT total_time, open_start FROM user_time WHERE guild_id = ? AND user_id = ?',
    guildId, userId
  );
  if (!row || !row.open_start) return null;

  const elapsed  = now - row.open_start;
  const duration = Math.min(elapsed, 86400000);
  const totalNew = row.total_time + duration;

  await db.run(
    'UPDATE user_time SET total_time = ?, open_start = NULL WHERE guild_id = ? AND user_id = ?',
    totalNew, guildId, userId
  );

  return formatDuration(duration);
}

async function closeExpiredPoints() {
  const now  = Date.now();
  const rows = await db.all(
    'SELECT guild_id, user_id, total_time, open_start FROM user_time WHERE open_start IS NOT NULL'
  );
  const expired = [];

  for (const r of rows) {
    const elapsed = now - r.open_start;
    if (elapsed >= 86400000) {
      const duration = 86400000;
      const totalNew = r.total_time + duration;
      await db.run(
        'UPDATE user_time SET total_time = ?, open_start = NULL WHERE guild_id = ? AND user_id = ?',
        totalNew, r.guild_id, r.user_id
      );
      expired.push({ guildId: r.guild_id, userId: r.user_id, duration: formatDuration(duration) });
    }
  }
  return expired;
}

async function isUserPointedElsewhere(userId, currentGuild) {
  const row = await db.get(
    `SELECT guild_id FROM user_time
     WHERE user_id = ? AND open_start IS NOT NULL AND guild_id != ? LIMIT 1`,
    userId, currentGuild
  );
  return !!row;
}

async function getUserTime(guildId, userId) {
  const now = Date.now();
  const row = await db.get(
    'SELECT total_time, open_start FROM user_time WHERE guild_id = ? AND user_id = ?',
    guildId, userId
  );
  let total = row ? row.total_time : 0;
  if (row && row.open_start) total += (now - row.open_start);
  return decomposeDuration(total);
}

// Configurações de servidor
async function getServerConfig(serverId) {
  let cfg = await db.get('SELECT * FROM server_config WHERE server_id = ?', serverId);
  const now = Date.now();

  if (!cfg) {
    await db.run(
      `INSERT INTO server_config (server_id, active, server_time_start)
       VALUES (?, 1, ?)`,
      serverId, now
    );
    cfg = { server_id: serverId, panel_channel: null, notify_channel: null, admin_role: null, api_channel: null, owner_id: null, active: 1, server_time_start: now, auth_duration_ms: null };
  }

  return {
    panelChannel:    cfg.panel_channel,
    notifyChannel:   cfg.notify_channel,
    adminRole:       cfg.admin_role,
    apiChannel:      cfg.api_channel,
    ownerId:         cfg.owner_id,
    active:          cfg.active === 1,
    serverTimeStart: cfg.server_time_start,
    authDurationMs:  cfg.auth_duration_ms != null ? cfg.auth_duration_ms : Infinity
  };
}

async function setPanelChannel(serverId, channelId) {
  await db.run(
    `INSERT INTO server_config (server_id, panel_channel)
     VALUES (?, ?)
     ON CONFLICT(server_id) DO UPDATE
       SET panel_channel = excluded.panel_channel`,
    serverId, channelId
  );
}

async function setNotifyChannel(serverId, channelId) {
  await db.run(
    `INSERT INTO server_config (server_id, notify_channel)
     VALUES (?, ?)
     ON CONFLICT(server_id) DO UPDATE
       SET notify_channel = excluded.notify_channel`,
    serverId, channelId
  );
}

async function setAdminRole(serverId, roleId) {
  await db.run(
    `INSERT INTO server_config (server_id, admin_role)
     VALUES (?, ?)
     ON CONFLICT(server_id) DO UPDATE
       SET admin_role = excluded.admin_role`,
    serverId, roleId
  );
}

// Define canal de API de pagamento
async function setApiChannel(serverId, channelId) {
  await db.run(
    `INSERT INTO server_config (server_id, api_channel)
     VALUES (?, ?)
     ON CONFLICT(server_id) DO UPDATE
       SET api_channel = excluded.api_channel`,
    serverId, channelId
  );
}

// Define ID do owner para envio de hash
async function setOwnerId(serverId, ownerId) {
  await db.run(
    `INSERT INTO server_config (server_id, owner_id)
     VALUES (?, ?)
     ON CONFLICT(server_id) DO UPDATE
       SET owner_id = excluded.owner_id`,
    serverId, ownerId
  );
}

async function setServerAuth(serverId, durationStr) {
  const now = Date.now();

  // Busca config atual
  const cfg = await getServerConfig(serverId);

  let newDurationMs;
  if (/^[+-]/.test(durationStr)) {
    // Ajuste relativo: "+30d" ou "-00:00:05:00"
    const sign = durationStr[0];
    const deltaRaw = durationStr.slice(1);
    // Se vier no formato "dd:hh:mm:ss", use parseHMS; senão parseDuration
    const deltaMs = deltaRaw.includes(':')
      ? (()=>{
          const [d,h,m,s] = deltaRaw.split(':').map(x=>parseInt(x)||0);
          return ((d*24 + h)*3600 + m*60 + s)*1000;
        })()
      : parseDuration(deltaRaw);

    // Tempo restante atual
    const elapsed = now - cfg.serverTimeStart;
    const oldRemaining = (cfg.authDurationMs === Infinity ? 0 : cfg.authDurationMs) - elapsed;

    // Calcula novo restante e clampa ≥0
    const rawNew = sign === '+' ? oldRemaining + deltaMs : oldRemaining - deltaMs;
    newDurationMs = Math.max(0, rawNew);

  } else {
    // Definição absoluta: "30d", ou "1d2h", etc.
    newDurationMs = parseDuration(durationStr);
  }

  // Grava novo prazo (contagem a partir de agora)
  await db.run(
    `INSERT INTO server_config (server_id, active, server_time_start, auth_duration_ms)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(server_id) DO UPDATE
       SET active            = excluded.active,
           server_time_start = excluded.server_time_start,
           auth_duration_ms  = excluded.auth_duration_ms`,
    serverId, now, newDurationMs
  );
}

async function checkServerAuths() {
  const rows = await db.all('SELECT server_id, server_time_start, auth_duration_ms, active FROM server_config');
  const now = Date.now();
  for (const r of rows) {
    if (r.active === 1 && r.auth_duration_ms != null && (now - r.server_time_start) > r.auth_duration_ms) {
      await db.run('UPDATE server_config SET active = 0 WHERE server_id = ?', r.server_id);
    }
  }
}

// Ajuste manual de tempo via admin
async function adjustUserTime(guildId, userId, deltaStr) {
  const m = deltaStr.match(/^([+-]?)(\d+):(\d+):(\d+):(\d+)$/);
  if (!m) return 'Formato inválido. Use ±dd:hh:mm:ss';
  const sign = m[1] === '-' ? -1 : 1;
  const [, , dd, hh, mm, ss] = m;
  const msDelta = sign * ((+dd*86400 + +hh*3600 + +mm*60 + +ss) * 1000);
  const row = await db.get('SELECT total_time FROM user_time WHERE guild_id = ? AND user_id = ?', guildId, userId);
  let total = row ? row.total_time : 0;
  let newTotal = total + msDelta;
  if (newTotal < 0) newTotal = 0;
  await db.run(
    `INSERT INTO user_time (guild_id, user_id, total_time)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE
       SET total_time = excluded.total_time`,
    guildId, userId, newTotal
  );
  const action = sign > 0 ? 'adicionou' : 'removeu';
  return `${action} \`${formatDuration(Math.abs(msDelta))}\` para <@${userId}> (${userId})`;
}

async function deactivateServer(serverId) {
  await db.run('UPDATE server_config SET active = 0 WHERE server_id = ?', serverId);
}

module.exports = {
  initDatabase,
  startPoint,
  getOpenPoint,
  endPoint,
  closeExpiredPoints,
  isUserPointedElsewhere,
  getUserTime,
  getServerConfig,
  setPanelChannel,
  setNotifyChannel,
  setAdminRole,
  setApiChannel,
  setOwnerId,
  setServerAuth,
  checkServerAuths,
  adjustUserTime,
  deactivateServer,
  parseDuration,
  formatDuration
};
