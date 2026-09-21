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
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const GROQ_KEY = process.env.GROQ_KEY;
const AGNES_KEY = process.env.AGNES_KEY;

if (!DISCORD_TOKEN || !CHANNEL_ID || !FIREBASE_KEY_JSON) {
  console.error('❌ Faltando variáveis de ambiente obrigatórias!');
  process.exit(1);
}

// ==== FIREBASE ====
let serviceAccount;
try {
  serviceAccount = JSON.parse(FIREBASE_KEY_JSON);
} catch (e) {
  console.error('❌ FIREBASE_KEY inválido');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://exiled-scripts-default-rtdb.firebaseio.com'
});
const db = admin.database();

// ==== LOGS DE CONFIG ====
if (RESEND_API_KEY) console.log('📧 Resend configurado'); else console.warn('⚠️ RESEND_API_KEY não configurada');
if (DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI) console.log('🔐 Discord OAuth2 configurado'); else console.warn('⚠️ Discord OAuth2 incompleto');
if (GROQ_KEY) console.log('🤖 Groq proxy ativo'); else console.warn('⚠️ GROQ_KEY não configurada');
if (AGNES_KEY) console.log('🎨 Agnes proxy ativo'); else console.warn('⚠️ AGNES_KEY não configurada');

// ==== EXPRESS ====
const app = express();
app.use(cors());

// Middleware especial pro /groq/stt (multipart)
app.use('/groq/stt', express.raw({ type: '*/*', limit: '25mb' }));

// JSON normal pras outras rotas
app.use(express.json({ limit: '20mb' }));

// ==== PROXY GROQ + AGNES ====
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const AGNES_IMG_URL = 'https://apihub.agnes-ai.com/v1/images/generations';

// Chat (texto + visão)
app.post('/groq/chat', async (req, res) => {
  try {
    if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_KEY não configurada' });
    const r = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_KEY
      },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    console.error('Erro /groq/chat:', err);
    res.status(500).json({ error: err.message });
  }
});

// Transcrição de áudio (Whisper)
app.post('/groq/stt', async (req, res) => {
  try {
    if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_KEY não configurada' });
    const r = await fetch(GROQ_STT_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GROQ_KEY,
        'Content-Type': req.headers['content-type'] || 'multipart/form-data'
      },
      body: req.body
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    console.error('Erro /groq/stt:', err);
    res.status(500).json({ error: err.message });
  }
});

// Geração de imagem (Agnes)
app.post('/agnes/image', async (req, res) => {
  try {
    if (!AGNES_KEY) return res.status(500).json({ error: 'AGNES_KEY não configurada' });
    const r = await fetch(AGNES_IMG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + AGNES_KEY
      },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    console.error('Erro /agnes/image:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==== DISCORD BOT CLIENT ====
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let discordReady = false;

client.once('ready', () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  discordReady = true;
});

client.on('error', (e) => console.error('Discord bot error:', e));

client.login(DISCORD_TOKEN);

// ==== HEALTH CHECK ====
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    bot: discordReady,
    botTag: client.user ? client.user.tag : null,
    mailer: !!RESEND_API_KEY,
    discordOAuth: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI),
    groq: !!GROQ_KEY,
    agnes: !!AGNES_KEY
  });
});

// ==== ROTA: ENVIAR E-MAIL DE BOAS-VINDAS ====
app.post('/welcome', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'email e name são obrigatórios' });
    if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY não configurada' });

    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="margin:0;padding:0;background:#000;font-family:'Segoe UI',system-ui,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0a0a0a;border:1px solid #222;border-radius:20px;overflow:hidden;">
                <tr>
                  <td align="center" style="padding:40px 30px 20px;">
                    <div style="width:72px;height:72px;margin:0 auto 20px;background:linear-gradient(135deg,#fff,#888);border-radius:18px;line-height:72px;text-align:center;font-size:36px;">⬛</div>
                    <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.8px;">
                      EXILED <span style="background:linear-gradient(135deg,#fff,#888);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">AI</span>
                    </h1>
                    <p style="margin:0;color:#888;font-size:14px;">Sua jornada começou 🚀</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 40px 30px;">
                    <h2 style="margin:0 0 16px;color:#fff;font-size:20px;font-weight:700;">Olá, ${name}!</h2>
                    <p style="margin:0 0 16px;color:#ccc;font-size:15px;line-height:1.6;">
                      Seja bem-vindo à <strong style="color:#fff;">EXILED AI</strong>. Sua conta foi criada com sucesso.
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;border-radius:12px;margin-bottom:24px;">
                      <tr><td style="padding:14px 18px;border-bottom:1px solid #222;color:#e0e0e0;font-size:14px;">💬 <strong style="color:#fff;">Chat inteligente</strong> em português</td></tr>
                      <tr><td style="padding:14px 18px;border-bottom:1px solid #222;color:#e0e0e0;font-size:14px;">🎨 <strong style="color:#fff;">Geração de imagens</strong> com IA</td></tr>
                      <tr><td style="padding:14px 18px;border-bottom:1px solid #222;color:#e0e0e0;font-size:14px;">💻 <strong style="color:#fff;">Modo código</strong> pra programar</td></tr>
                      <tr><td style="padding:14px 18px;color:#e0e0e0;font-size:14px;">🎁 <strong style="color:#fff;">Convide amigos</strong> e ganhe Premium grátis</td></tr>
                    </table>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center">
                          <a href="https://exdowner.github.io/EXILED-AI/" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#fff,#888);color:#000;text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;">Começar a usar</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 30px;background:#050505;border-top:1px solid #222;text-align:center;">
                    <p style="margin:0;color:#444;font-size:11px;">© ${new Date().getFullYear()} EXILED AI. Todos os direitos reservados.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'EXILED AI <onboarding@resend.dev>',
        to: email,
        subject: `Bem-vindo à EXILED AI, ${name}! 🚀`,
        html: htmlBody
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Resend HTTP ' + response.status + ': ' + errText);
    }

    const data = await response.json();
    console.log(`📧 E-mail enviado para ${email} (id: ${data.id})`);
    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Erro /welcome:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==== ROTA: DISCORD OAUTH2 CALLBACK ====
app.post('/discord/callback', async (req, res) => {
  try {
    const { code, redirect_uri } = req.body;
    if (!code) return res.status(400).json({ error: 'Código faltando' });

    const redirectUri = redirect_uri || DISCORD_REDIRECT_URI;
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !redirectUri) {
      return res.status(500).json({ error: 'Discord OAuth2 não configurado' });
    }

    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', DISCORD_CLIENT_ID);
    tokenParams.append('client_secret', DISCORD_CLIENT_SECRET);
    tokenParams.append('grant_type', 'authorization_code');
    tokenParams.append('code', code);
    tokenParams.append('redirect_uri', redirectUri);

    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error('Discord token exchange falhou: ' + tokenRes.status + ' ' + err);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });

    if (!userRes.ok) {
      const err = await userRes.text();
      throw new Error('Discord user fetch falhou: ' + userRes.status + ' ' + err);
    }

    const discordUser = await userRes.json();

    const customToken = await admin.auth().createCustomToken('discord_' + discordUser.id, {
      discordId: discordUser.id,
      discordUsername: discordUser.username
    });

    console.log(`🔐 Login Discord: ${discordUser.username} (${discordUser.id})`);

    res.json({
      ok: true,
      customToken: customToken,
      user: {
        id: discordUser.id,
        username: discordUser.username,
        global_name: discordUser.global_name || '',
        email: discordUser.email || '',
        avatar: discordUser.avatar || ''
      }
    });
  } catch (err) {
    console.error('Erro /discord/callback:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==== RECEBER COMPROVANTE ====
app.post('/comprovante', async (req, res) => {
  try {
    const { uid, nome, email, imagemBase64 } = req.body;

    if (!uid || !nome || !email || !imagemBase64) {
      return res.status(400).json({ error: 'Dados faltando' });
    }

    if (!discordReady) {
      return res.status(503).json({ error: 'Bot inicializando. Aguarde 1 min.' });
    }

    const matches = imagemBase64.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Imagem inválida' });

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const attachment = new AttachmentBuilder(buffer, { name: `comprovante_${uid}.${ext}` });

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
