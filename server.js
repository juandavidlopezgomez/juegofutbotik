const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Gift image proxy (avoids CORS on TikTok CDN) ─────────────────────────────
app.get('/proxy/img', async (req, res) => {
  const url = decodeURIComponent(req.query.url || '');
  if (!url.startsWith('https://') || !url.includes('tiktokcdn.com')) {
    return res.status(403).end();
  }
  try {
    const r = await fetch(url, {
      headers: { 'Referer': 'https://www.tiktok.com/', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.status(r.status).end();
    const buf = await r.arrayBuffer();
    res.set('Content-Type', r.headers.get('content-type') || 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(502).end();
  }
});

// ── Fetch TikTok 1-coin gift list on startup ──────────────────────────────────
let tiktokGiftMap = {}; // name.lower() → { id, name, img }

// Spanish name → English TikTok gift name aliases
const ES_ALIASES = {
  'rosa':                'rose',
  'mi primera rosa':     'my first rose',
  'rosa blanca':         'white rose',
  'quiéreme':            'love you',
  'te adoro':            'love you so much',
  'guiño, guiño':        'wink wink',
  'eres increíble':      "you're awesome",
  'alas de guardián':    'guardian wings',
  'rebanada de pastel':  'cake slice',
  'es maíz':             'it’s corn',
  'cono de helado':      'ice cream cone',
  'barra fluoresce':     'glow stick',
  'fragmento de e':      'a shard of hope',
  'estilo libre':        'freestyle',
  'clásicos':            'oldies',
  'finger heart':        'wink charm',
  'super gg':            'gg',
};

async function loadTikTokGifts() {
  const urls = [
    'https://webcast.tiktok.com/webcast/gift/list/?aid=1988',
    'https://webcast16-webapp.tiktok.com/webcast/gift/list/?aid=1988',
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.tiktok.com/',
        },
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      const gifts = data.data?.gifts || data.gifts || [];
      let count = 0;
      gifts.forEach(g => {
        if ((g.diamond_count ?? g.diamondCount ?? 99) <= 1) {
          const img = g.image?.url_list?.[0] || g.image?.url || '';
          if (img) {
            tiktokGiftMap[g.name.toLowerCase()] = { id: g.id, name: g.name, img };
            count++;
          }
        }
      });
      // Add Spanish aliases so the test panel works
      for (const [es, en] of Object.entries(ES_ALIASES)) {
        if (!tiktokGiftMap[es] && tiktokGiftMap[en]) {
          tiktokGiftMap[es] = tiktokGiftMap[en];
          count++;
        }
      }
      console.log(`TikTok gifts loaded: ${count} (including Spanish aliases)`);
      return;
    } catch (e) {
      console.warn(`Gift fetch failed (${url}): ${e.message}`);
    }
  }
  console.warn('Could not load TikTok gift images — will use emoji fallback');
}
loadTikTokGifts();

app.get('/api/gifts', (req, res) => res.json(tiktokGiftMap));

// ── Constants ────────────────────────────────────────────────────────────────
const GIFTS_TO_WIN   = 30;
const TIKTOK_USERNAME = 'juandavidyt16';

// ── Gift → Country mapping (the gift TYPE determines which country advances) ──
const GIFT_COUNTRY = {
  'rosa': 'MX',          'rose': 'MX',           'my first rose': 'MX',
  'gg': 'US',            'super gg': 'US',
  'tiktok': 'ES',
  'pop': 'CO',
  'maracas': 'CL',
  'rosa blanca': 'AR',   'white rose': 'AR',
  'guiño, guiño': 'EC',  'wink wink': 'EC',
  'alas de guardián': 'VE', 'guardian wings': 'VE',
  'rebanada de pastel': 'GT', 'cake slice': 'GT',
  'es maíz': 'BR',       "it’s corn": 'BR',  "it's corn": 'BR',
  'cono de helado': 'BO', 'ice cream cone': 'BO',
  'barra fluoresce': 'HN', 'glow stick': 'HN',
  'quiéreme': 'SV',      'love you': 'SV',
  'te adoro': 'CR',      'love you so much': 'CR',
  'eres increíble': 'NI', "you're awesome": 'NI',
  'fragmento de e': 'PA', 'a shard of hope': 'PA',
  'estilo libre': 'PE',  'freestyle': 'PE',
  'clásicos': 'PY',      'oldies': 'PY',
  'wink charm': 'GY',    'finger heart': 'GY',
  'heart': 'CU',
};

// ── Gift emoji map (TikTok gift name → emoji + coins) ────────────────────────
// Emoji fallbacks for gift names (used when TikTok CDN image not available)
const GIFT_EMOJI = {
  'rosa': '🌹', 'rosa blanca': '🤍', 'rose': '🌹',
  'gg': '🎮', 'super gg': '🎮',
  'tiktok': '🎵', 'pop': '🎵', 'estilo libre': '🎹', 'clásicos': '📻',
  'finger heart': '🤞', 'quiéreme': '❤️', 'guiño, guiño': '😉',
  'eres increíble': '🐱', 'alas de guardián': '🕊️',
  'rebanada de pastel': '🎂', 'maracas': '🪇', 'es maíz': '🌽',
  'cono de helado': '🍦', 'barra fluoresce': '🖊️', 'te adoro': '🥰',
  'fragmento de e': '🎖️', 'heart': '❤️', 'like': '👍',
};

function resolveGift(giftName, diamondCount) {
  const key = (giftName || '').toLowerCase();
  // Try exact match, then partial match
  const emoji = GIFT_EMOJI[key]
    || Object.entries(GIFT_EMOJI).find(([k]) => key.includes(k))?.[1]
    || (diamondCount <= 1 ? '🌹' : diamondCount <= 5 ? '🌸' : diamondCount <= 20 ? '⭐' : '💎');
  return { emoji, coins: diamondCount };
}

// ── Country data ─────────────────────────────────────────────────────────────
const COUNTRIES = {
  MX: { flag: '🇲🇽', name: 'Mexico' },
  US: { flag: '🇺🇸', name: 'USA' },
  AR: { flag: '🇦🇷', name: 'Argentina' },
  CO: { flag: '🇨🇴', name: 'Colombia' },
  PE: { flag: '🇵🇪', name: 'Peru' },
  CL: { flag: '🇨🇱', name: 'Chile' },
  ES: { flag: '🇪🇸', name: 'Spain' },
  GT: { flag: '🇬🇹', name: 'Guatemala' },
  BO: { flag: '🇧🇴', name: 'Bolivia' },
  PA: { flag: '🇵🇦', name: 'Panama' },
  HN: { flag: '🇭🇳', name: 'Honduras' },
  SV: { flag: '🇸🇻', name: 'El Salvador' },
  CR: { flag: '🇨🇷', name: 'Costa Rica' },
  NI: { flag: '🇳🇮', name: 'Nicaragua' },
  EC: { flag: '🇪🇨', name: 'Ecuador' },
  VE: { flag: '🇻🇪', name: 'Venezuela' },
  BR: { flag: '🇧🇷', name: 'Brasil' },
  PY: { flag: '🇵🇾', name: 'Paraguay' },
  UY: { flag: '🇺🇾', name: 'Uruguay' },
  CU: { flag: '🇨🇺', name: 'Cuba' },
  DO: { flag: '🇩🇴', name: 'Rep. Dom.' },
  PR: { flag: '🇵🇷', name: 'Puerto Rico' },
  GY: { flag: '🇬🇾', name: 'Guyana' },
  GB: { flag: '🇬🇧', name: 'UK' },
  FR: { flag: '🇫🇷', name: 'Francia' },
  DE: { flag: '🇩🇪', name: 'Alemania' },
  IT: { flag: '🇮🇹', name: 'Italia' },
  PT: { flag: '🇵🇹', name: 'Portugal' },
  CA: { flag: '🇨🇦', name: 'Canada' },
  AU: { flag: '🇦🇺', name: 'Australia' },
  JP: { flag: '🇯🇵', name: 'Japon' },
};

// ── Game state ────────────────────────────────────────────────────────────────
const gameState = {
  players: {}, // code -> { code, flag, name, gifts, wins, totalGifts, lastUser, lastGiftEmoji }
  recentGifts: [],
};

function getOrCreatePlayer(code, username) {
  code = (code || 'XX').toUpperCase().slice(0, 2);
  const info = COUNTRIES[code] || { flag: '🏳️', name: code };
  if (!gameState.players[code]) {
    gameState.players[code] = {
      code,
      flag: info.flag,
      name: info.name,
      gifts: 0,
      wins: 0,
      totalGifts: 0,
      lastUser: username,
      lastGiftEmoji: '🎁',
      lastGiftName: '',
      lastGiftImgUrl: '',
    };
  }
  return gameState.players[code];
}

// Pre-populate the 20 race countries so all lanes show from the start
const RACE_COUNTRIES = ['MX','US','ES','CO','CL','AR','EC','VE','GT','BR','BO','HN','SV','CR','NI','PA','PE','PY','GY','CU'];
RACE_COUNTRIES.forEach(code => getOrCreatePlayer(code, ''));

function handleGift(code, username, amount, giftName, giftPictureUrl) {
  const p = getOrCreatePlayer(code, username);
  const giftInfo = resolveGift(giftName, amount);

  p.lastUser       = username;
  p.lastGiftEmoji  = giftInfo.emoji;
  p.lastGiftName   = giftName || '';
  p.lastGiftImgUrl = giftPictureUrl || '';
  p.totalGifts    += amount;
  p.gifts         += amount;

  gameState.recentGifts.unshift({ code: p.code, username, amount, emoji: giftInfo.emoji });
  if (gameState.recentGifts.length > 12) gameState.recentGifts.pop();

  let wins = 0;
  while (p.gifts >= GIFTS_TO_WIN) {
    p.gifts -= GIFTS_TO_WIN;
    p.wins  += 1;
    wins    += 1;
  }

  broadcast({
    type: 'gift',
    code: p.code, flag: p.flag, name: p.name,
    gifts: p.gifts, wins: p.wins, totalGifts: p.totalGifts,
    lastGiftEmoji: p.lastGiftEmoji,
    lastGiftImgUrl: p.lastGiftImgUrl,
    lastGiftName: p.lastGiftName,
    username, amount, newWins: wins,
  });

  if (wins > 0) {
    broadcast({ type: 'country_win', code: p.code, flag: p.flag, name: p.name, wins: p.wins });
    console.log(`🏆 ${p.name} wins! Total: ${p.wins}`);
  }
  console.log(`Gift: ${username} (${code}) [${giftInfo.emoji}] +${amount} → ${p.gifts}/${GIFTS_TO_WIN}`);
}

// ── Broadcast ─────────────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ── WebSocket from browser ────────────────────────────────────────────────────
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'state', state: gameState }));
  if (TIKTOK_USERNAME) {
    ws.send(JSON.stringify({ type: 'auto_connect', username: TIKTOK_USERNAME }));
  }

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'connect_tiktok')    connectTikTok(msg.username);
      if (msg.type === 'disconnect_tiktok') disconnectTikTok();
      if (msg.type === 'test_gift') {
        const gn = (msg.giftName || 'rosa').toLowerCase();
        const co = GIFT_COUNTRY[gn] || msg.country || 'MX';
        handleGift(co, 'TestUser', msg.coins || 1, gn);
      }
      if (msg.type === 'reset_all')         resetAll();
    } catch (e) { /* ignore */ }
  });
});

function resetAll() {
  Object.values(gameState.players).forEach(p => {
    p.gifts = 0; p.wins = 0; p.totalGifts = 0;
  });
  gameState.recentGifts = [];
  broadcast({ type: 'state', state: gameState });
}

// ── TikTok Live ───────────────────────────────────────────────────────────────
let tiktokConn = null;

function connectTikTok(username) {
  if (tiktokConn) { tiktokConn.disconnect(); tiktokConn = null; }

  tiktokConn = new WebcastPushConnection(username, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
  });

  tiktokConn.connect()
    .then(state => {
      console.log(`Connected to @${username}`);
      broadcast({ type: 'tiktok_connected', username });
    })
    .catch(err => {
      console.error('TikTok error:', err.message);
      broadcast({ type: 'tiktok_error', message: err.message });
    });

  tiktokConn.on('gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return;
    const giftName = (data.giftName || '').toLowerCase();
    const country  = GIFT_COUNTRY[giftName]; // country determined by gift type
    if (!country) return; // ignore gifts not assigned to any country
    const amount      = (data.diamondCount || 1) * (data.repeatCount || 1);
    const giftPicture = data.giftPictureUrl || data.giftDetails?.giftPictureUrl || '';
    handleGift(country, data.uniqueId, amount, giftName, giftPicture);
  });

  tiktokConn.on('disconnected', () => broadcast({ type: 'tiktok_disconnected' }));
  tiktokConn.on('error', err => broadcast({ type: 'tiktok_error', message: String(err) }));
}

function disconnectTikTok() {
  if (tiktokConn) { tiktokConn.disconnect(); tiktokConn = null; }
  broadcast({ type: 'tiktok_disconnected' });
}

app.get('/api/state', (req, res) => res.json(gameState));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TikRace running → http://localhost:${PORT}`));
