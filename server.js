const express = require('express');
const cors = require('cors');
const {
  Client, GatewayIntentBits, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, EmbedBuilder, AttachmentBuilder
} = require('discord.js');
const admin = require('firebase-admin');

// ==== CONFIG ====
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const FIREBASE_KEY_JSON = process.env.FIREBASE_KEY;

if (!DISCORD_TOKEN || !CHANNEL_ID || !FIREBASE_KEY_JSON) {
  console.error('❌ Faltando variáveis de ambiente!');
  process.exit(1);
}

// ==== FIREBASE ====
let serviceAccount;
try {
  serviceAccount = JSON.parse(FIREBASE_KEY_JSON);
} catch (e) {
  console.error('❌ FIREBASE_KEY inválido (não é JSON válido)');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://exiled-scripts-default-rtdb.firebaseio.com'
});
const db = admin.database();

// ==== EXPRESS ====
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ==== DISCORD CLIENT ====
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let discordReady = false;

client.once('ready', () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  discordReady = true;
});

client.on('error', (e) => console.error('Discord error:', e));

client.login(DISCORD_TOKEN);

// ==== HEALTH CHECK ====
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: discordReady, botTag: client.user ? client.user.tag : null });
});

// ==== RECEBER COMPROVANTE ====
app.post('/comprovante', async (req, res) => {
  try {
    const { uid, nome, email, imagemBase64 } = req.body;

    if (!uid || !nome || !email || !imagemBase64) {
      return res.status(400).json({ error: 'Dados faltando' });
    }

    if (!discordReady) {
      return res.status(503).json({ error: 'Bot inicializando. Aguarde 1 min e tente de novo.' });
    }

    // Extrai base64
    const matches = imagemBase64.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Formato de imagem inválido' });

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const attachment = new AttachmentBuilder(buffer, { name: `comprovante_${uid}.${ext}` });

    // Embed
    const embed = new EmbedBuilder()
      .setTitle('💰 Novo Pedido de Upgrade')
      .setColor(0xFFD700)
      .addFields(
        { name: '👤 Nome', value: nome || '-', inline: true },
        { name: '📧 Email', value: email || '-', inline: true },
        { name: '🆔 UID', value: `\`${uid}\``, inline: false }
      )
      .setImage(`attachment://comprovante_${uid}.${ext}`)
      .setTimestamp();

    // Botões
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`liberar:${uid}`)
        .setLabel('LIBERAR')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`recusar:${uid}`)
        .setLabel('RECUSAR')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    );

    // Envia
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) throw new Error('Canal não encontrado');
    await channel.send({ embeds: [embed], components: [row], files: [attachment] });

    console.log(`📨 Comprovante de ${email} enviado pro Discord`);
    res.json({ ok: true, message: 'Comprovante enviado!' });
  } catch (err) {
    console.error('Erro /comprovante:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==== INTERAÇÃO BOTÕES ====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const [acao, uid] = interaction.customId.split(':');

  try {
    await interaction.deferUpdate();

    if (acao === 'liberar') {
      await db.ref(`users/${uid}/plano`).set('premium');
      await db.ref(`users/${uid}/planoDesde`).set(Date.now());

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x4ADE80)
        .setFooter({ text: `✅ LIBERADO por ${interaction.user.username}` });

      await interaction.editReply({ embeds: [embed], components: [] });
      console.log(`✅ Premium liberado pra UID ${uid}`);
    }

    if (acao === 'recusar') {
      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xFF4D4D)
        .setFooter({ text: `❌ RECUSADO por ${interaction.user.username}` });

      await interaction.editReply({ embeds: [embed], components: [] });
      console.log(`❌ Comprovante recusado pra UID ${uid}`);
    }
  } catch (err) {
    console.error('Erro interação:', err);
  }
});

// ==== START ====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
