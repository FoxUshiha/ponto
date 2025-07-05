
const { readdirSync } = require('fs');
const path = require('path');

function loadCommands(client) {
  const commandsPath  = path.join(__dirname, 'commands');
  const commandFiles  = readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    const cmd = require(path.join(commandsPath, file));
    if (!cmd.data || !cmd.execute) continue;
    client.commands.set(cmd.data.name, cmd);
  }
}

module.exports = { loadCommands };
