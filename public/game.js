// ── Fullscreen on start ───────────────────────────────────────────────────────
document.getElementById('fs-btn').addEventListener('click', () => {
  document.documentElement.requestFullscreen().catch(() => {});
  document.getElementById('fs-prompt').style.display = 'none';
});

// ── Canvas setup ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');

function resize() {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
resize();
window.addEventListener('resize', resize);

// ── WebSocket ─────────────────────────────────────────────────────────────────
const ws = new WebSocket(`ws://${location.host}`);
ws.onopen    = () => send({ type: 'reset_all' });
ws.onmessage = e => handleMsg(JSON.parse(e.data));
ws.onclose   = () => setStatus('offline', '● Sin conexión');
function send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// ── TikTok gift image map (loaded from server) ────────────────────────────────
let giftImgMap = {};
fetch('/api/gifts').then(r => r.json()).then(data => {
  giftImgMap = data;
}).catch(() => {});

// Proxy TikTok CDN URLs through the server to avoid CORS
function proxyUrl(url) {
  if (!url) return '';
  if (url.includes('tiktokcdn.com')) return `/proxy/img?url=${encodeURIComponent(url)}`;
  return url;
}

// ── State ─────────────────────────────────────────────────────────────────────
const GIFTS_TO_WIN = 30;
const state = { players: {} };
const anim  = {}; // per-player animation state

// ── Layout (dynamic — recalculated each frame to fit all 20 countries) ────────
let GIFT_W  = 40;
let FLAG_W  = 44;
let LEFT_W  = 84;
let RIGHT_W = 32;
let ROW_H   = 32;

// ── Assigned gift per country (shown by default before any gift is received) ──
const COUNTRY_GIFT = {
  MX: 'rosa',             US: 'gg',               ES: 'tiktok',
  CO: 'pop',              CL: 'maracas',           AR: 'rosa blanca',
  EC: 'guiño, guiño',     VE: 'alas de guardián',  GT: 'rebanada de pastel',
  BR: 'es maíz',          BO: 'cono de helado',    HN: 'barra fluoresce',
  SV: 'quiéreme',         CR: 'te adoro',          NI: 'eres increíble',
  PA: 'fragmento de e',   PE: 'estilo libre',      PY: 'clásicos',
  GY: 'wink charm',       CU: 'heart',
};

// ── National team jersey colors (real uniform colors) ────────────────────────
const COUNTRY_JERSEY = {
  MX: { body:'#006847', shorts:'#006847', stripe:'#CE1126' },
  US: { body:'#00205B', shorts:'#FFFFFF', stripe:'#BF0A30' },
  ES: { body:'#D60020', shorts:'#D60020', stripe:'#FFD700' },
  CO: { body:'#FCD116', shorts:'#003087', stripe:'#CE1126' },
  CL: { body:'#D40000', shorts:'#003087', stripe:'#FFFFFF' },
  AR: { body:'#74ACDF', shorts:'#003087', stripe:'#FFFFFF' },
  EC: { body:'#FFD700', shorts:'#003087', stripe:'#CE1126' },
  VE: { body:'#CF142B', shorts:'#00247D', stripe:'#FFD700' },
  GT: { body:'#4997D0', shorts:'#4997D0', stripe:'#FFFFFF' },
  BR: { body:'#FFDF00', shorts:'#009C3B', stripe:'#009C3B' },
  BO: { body:'#009638', shorts:'#FFFFFF', stripe:'#D52B1E' },
  HN: { body:'#0073CF', shorts:'#0073CF', stripe:'#FFFFFF' },
  SV: { body:'#0F47AF', shorts:'#0F47AF', stripe:'#FFFFFF' },
  CR: { body:'#CE1126', shorts:'#002B7F', stripe:'#FFFFFF' },
  NI: { body:'#003893', shorts:'#FFFFFF', stripe:'#FFFFFF' },
  PA: { body:'#D21034', shorts:'#002B7F', stripe:'#FFFFFF' },
  PE: { body:'#D91023', shorts:'#FFFFFF', stripe:'#FFFFFF' },
  PY: { body:'#D52B1E', shorts:'#002B7F', stripe:'#FFFFFF' },
  GY: { body:'#009E60', shorts:'#000000', stripe:'#FFD700' },
  CU: { body:'#002A8F', shorts:'#CE1126', stripe:'#FFFFFF' },
};

function jerseyFor(code) {
  return COUNTRY_JERSEY[code] || { body:'#7c3aed', shorts:'#4a148c', stripe:'#FFFFFF' };
}

// ── Image cache (flags + gifts) ───────────────────────────────────────────────
const imgCache = {};

function loadImg(url) {
  if (!imgCache[url]) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    imgCache[url] = img;
  }
  return imgCache[url];
}

function flagUrl(code) {
  return `https://flagcdn.com/w80/${code.toLowerCase()}.png`;
}

function drawImgContain(img, x, y, w, h, radius = 4) {
  if (!img || !img.complete || img.naturalWidth === 0) return;
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const sw = img.naturalWidth * scale;
  const sh = img.naturalHeight * scale;
  const sx = x + (w - sw) / 2;
  const sy = y + (h - sh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(sx, sy, sw, sh, radius);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh);
  ctx.restore();
}

// Pre-render emoji onto offscreen canvas (for gift icons in canvas)
const emojiCache = {};
function getEmojiCanvas(emoji, size) {
  const key = `${emoji}_${size}`;
  if (!emojiCache[key]) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const cx = c.getContext('2d');
    cx.font = `${size * 0.72}px serif`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText(emoji, size / 2, size / 2 + 2);
    emojiCache[key] = c;
  }
  return emojiCache[key];
}

// ── Draw cartoon soccer player ────────────────────────────────────────────────
function drawPlayer(x, y, jersey, legPhase, jumpY = 0) {
  const s = Math.max(0.28, ROW_H / 52); // scale with row height
  ctx.save();
  ctx.translate(x, y);

  const sw  = Math.sin(legPhase) * 10 * s;      // leg swing
  const bob = Math.abs(Math.sin(legPhase)) * 1.5; // subtle micro-bob

  // Shadow on ground — stays at ground level even when player jumps
  const shadowScale = Math.max(0.35, 1 - jumpY / (ROW_H * 0.55));
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 26*s + jumpY, 10*s * shadowScale, 3*s * shadowScale, 0, 0, Math.PI*2);
  ctx.fill();

  // ── SHORTS ──
  ctx.fillStyle = jersey.shorts;
  ctx.beginPath();
  ctx.roundRect(-6*s, 6*s + bob, 12*s, 8*s, 2*s);
  ctx.fill();

  // ── LEGS ──
  ctx.lineCap = 'round';

  // Left leg
  ctx.strokeStyle = '#FBBF7A'; ctx.lineWidth = 5*s;
  ctx.beginPath();
  ctx.moveTo(-3*s, 12*s + bob);
  ctx.lineTo(-4*s + sw, 21*s + bob * 0.5);
  ctx.stroke();
  // Left shin
  ctx.beginPath();
  ctx.moveTo(-4*s + sw, 21*s + bob * 0.5);
  ctx.lineTo(-2*s + sw * 0.8, 28*s);
  ctx.stroke();

  // Right leg
  ctx.beginPath();
  ctx.moveTo(3*s, 12*s + bob);
  ctx.lineTo(4*s - sw, 21*s + bob * 0.5);
  ctx.stroke();
  // Right shin
  ctx.beginPath();
  ctx.moveTo(4*s - sw, 21*s + bob * 0.5);
  ctx.lineTo(2*s - sw * 0.8, 28*s);
  ctx.stroke();

  // Cleats
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.ellipse(-2*s + sw * 0.8, 28*s, 4*s, 2*s, -0.3, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(2*s - sw * 0.8, 28*s, 4*s, 2*s, 0.3, 0, Math.PI*2);
  ctx.fill();

  // ── JERSEY ──
  ctx.fillStyle = jersey.body;
  ctx.beginPath();
  ctx.roundRect(-7*s, -4*s + bob, 14*s, 16*s, [4*s, 4*s, 2*s, 2*s]);
  ctx.fill();

  // Jersey stripe (real national team color)
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = jersey.stripe || '#ffffff';
  ctx.beginPath();
  ctx.rect(-2.5*s, -4*s + bob, 5*s, 16*s);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // ── ARMS ──
  const armSw = Math.sin(legPhase + Math.PI) * 8 * s;
  ctx.strokeStyle = jersey.body; ctx.lineWidth = 5*s;

  // Left arm
  ctx.beginPath();
  ctx.moveTo(-6*s, 0*s + bob);
  ctx.quadraticCurveTo(-13*s, 5*s + armSw, -11*s, 12*s + armSw * 0.5);
  ctx.stroke();
  // Left hand
  ctx.fillStyle = '#FBBF7A';
  ctx.beginPath();
  ctx.arc(-11*s, 12*s + armSw * 0.5, 3*s, 0, Math.PI*2);
  ctx.fill();

  // Right arm
  ctx.strokeStyle = jersey.body;
  ctx.beginPath();
  ctx.moveTo(6*s, 0*s + bob);
  ctx.quadraticCurveTo(13*s, 5*s - armSw, 11*s, 12*s - armSw * 0.5);
  ctx.stroke();
  // Right hand
  ctx.fillStyle = '#FBBF7A';
  ctx.beginPath();
  ctx.arc(11*s, 12*s - armSw * 0.5, 3*s, 0, Math.PI*2);
  ctx.fill();

  // ── NECK ──
  ctx.fillStyle = '#FBBF7A';
  ctx.beginPath();
  ctx.rect(-2.5*s, -10*s + bob, 5*s, 8*s);
  ctx.fill();

  // ── HEAD ──
  ctx.fillStyle = '#FBBF7A';
  ctx.beginPath();
  ctx.arc(0, -17*s + bob, 11*s, 0, Math.PI*2);
  ctx.fill();

  // Hair
  ctx.fillStyle = '#3d1f0a';
  ctx.beginPath();
  ctx.arc(0, -22*s + bob, 9*s, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -27*s + bob, 7*s, 5*s, 0, 0, Math.PI);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(-4*s, -18*s + bob, 3*s, 3.5*s, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4*s, -18*s + bob, 3*s, 3.5*s, 0, 0, Math.PI*2);
  ctx.fill();

  // Pupils
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(-3.5*s, -17.5*s + bob, 1.8*s, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(4.5*s, -17.5*s + bob, 1.8*s, 0, Math.PI*2);
  ctx.fill();

  // Eye shine
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-2.8*s, -18.5*s + bob, 0.8*s, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(5.2*s, -18.5*s + bob, 0.8*s, 0, Math.PI*2);
  ctx.fill();

  // Smile
  ctx.strokeStyle = '#a0522d';
  ctx.lineWidth = 1.5*s;
  ctx.beginPath();
  ctx.arc(0, -15*s + bob, 4*s, 0.15, Math.PI - 0.15);
  ctx.stroke();

  // Cheeks
  ctx.fillStyle = 'rgba(255,150,150,0.4)';
  ctx.beginPath();
  ctx.ellipse(-6*s, -15*s + bob, 3*s, 2*s, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(6*s, -15*s + bob, 3*s, 2*s, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.restore();
}

// ── Draw soccer ball ──────────────────────────────────────────────────────────
function drawBall(x, y, r, spin) {
  ctx.save();
  ctx.translate(x, y);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(0, r + 2, r, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f5f5f5';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(spin);
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.19, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.rotate(-spin);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.32, r * 0.22, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// ── Draw track background ─────────────────────────────────────────────────────
function drawTrack(players) {
  const W = canvas.width, H = canvas.height;

  // Light blue background like the reference
  ctx.fillStyle = '#a8cfe0';
  ctx.fillRect(0, 0, W, H);

  // Subtle inner glow from top
  const topGlow = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  topGlow.addColorStop(0, 'rgba(200,230,255,0.3)');
  topGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, W, H);

  // Left gift column bg
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(0, 0, GIFT_W, H);

  // Left flag column bg
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(GIFT_W, 0, FLAG_W, H);

  // Alternating rows
  players.forEach((_, i) => {
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(LEFT_W, i * ROW_H, W - LEFT_W - RIGHT_W, ROW_H);
    }
    // Dashed separator
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 9]);
    ctx.beginPath();
    ctx.moveTo(LEFT_W, (i + 1) * ROW_H);
    ctx.lineTo(W - RIGHT_W, (i + 1) * ROW_H);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // Thin separator between gift and flag columns
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(GIFT_W, 0); ctx.lineTo(GIFT_W, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(LEFT_W, 0); ctx.lineTo(LEFT_W, H); ctx.stroke();

  // ── Finish line checkered ──
  const fx = W - RIGHT_W;
  const ck = 14;
  const rows = Math.ceil(H / ck);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < Math.ceil(RIGHT_W / ck); c++) {
      // Light purple + white like reference
      ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(160,100,200,0.5)';
      ctx.fillRect(fx + c * ck, r * ck, ck, ck);
    }
  }

  // Header labels
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 9px "Segoe UI", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('REGALO', GIFT_W / 2, 3);
  ctx.fillText('PAÍS', GIFT_W + FLAG_W / 2, 3);
}

// ── Draw all players ──────────────────────────────────────────────────────────
function drawPlayers(players) {
  const W       = canvas.width;
  const trackW  = W - LEFT_W - RIGHT_W;
  const finishX = W - RIGHT_W;

  players.forEach((p, i) => {
    const y    = i * ROW_H;
    const midY = y + ROW_H / 2;

    // Preload flag image
    const flagImg = loadImg(flagUrl(p.code));

    // ── Gift icon column ──────────────────────────────────────────────────────
    // Always show the country's assigned gift — never changes regardless of what's received
    const assignedGift = (COUNTRY_GIFT[p.code] || 'rosa').toLowerCase();
    const giftUrl = giftImgMap[assignedGift]?.img || '';
    const pad = 3;
    const gSize = ROW_H - pad * 2;

    if (giftUrl) {
      const giftImg2 = loadImg(proxyUrl(giftUrl));
      drawImgContain(giftImg2, pad, y + pad, gSize, gSize, 4);
    } else {
      const emojiC = getEmojiCanvas('🌹', gSize);
      ctx.drawImage(emojiC, GIFT_W / 2 - gSize / 2, y + pad);
    }

    // ── Flag column ───────────────────────────────────────────────────────────
    const pct = Math.min(p.gifts / GIFTS_TO_WIN, 1);
    drawImgContain(flagImg, GIFT_W + 3, y + 4, FLAG_W - 6, ROW_H - 12, 3);

    // mini progress bar under flag
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.roundRect(GIFT_W + 3, y + ROW_H - 6, FLAG_W - 6, 3, 1); ctx.fill();
    if (pct > 0) {
      ctx.fillStyle = jerseyFor(p.code).body;
      ctx.beginPath(); ctx.roundRect(GIFT_W + 3, y + ROW_H - 6, (FLAG_W - 6) * pct, 3, 1); ctx.fill();
    }

    // gift count (tiny)
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '8px "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${p.gifts}/100`, GIFT_W + FLAG_W / 2, y + ROW_H);

    // ── Track: compute position ───────────────────────────────────────────────
    const an = anim[p.code];
    if (!an) return;

    const targetX = LEFT_W + 16 + trackW * pct;
    an.displayX  += (targetX - an.displayX) * 0.1;
    const dx      = Math.max(LEFT_W + 16, Math.min(an.displayX, finishX - 20));

    an.legPhase += 0.18;
    an.ballSpin = (an.ballSpin || 0) + 0.11;

    // Jumping animation — always active
    const jumpH = ROW_H * 0.3;
    const jumpOffset = Math.abs(Math.sin(an.legPhase)) * jumpH;
    // Ball bounces opposite to player (up when player lands, down when player peaks)
    const ballBounceOffset = (1 - Math.abs(Math.sin(an.legPhase))) * jumpH * 0.5;
    const ballR = Math.max(3, Math.round(ROW_H * 0.13));

    // ── Country name watermark at player position ─────────────────────────────
    const nameX = Math.min(dx + 22, finishX - 80);
    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(p.name, nameX, midY);

    // ── Gift flash animation ──────────────────────────────────────────────────
    const flashAge = Date.now() - (an.flashTime || 0);
    if (flashAge < 600) {
      const alpha = (1 - flashAge / 600) * 0.45;
      ctx.save();
      ctx.fillStyle = `rgba(255,215,0,${alpha})`;
      ctx.fillRect(LEFT_W, y, canvas.width - LEFT_W - RIGHT_W, ROW_H);
      // Glow ring around player
      const gx = Math.max(LEFT_W + 16, Math.min(an.displayX, canvas.width - RIGHT_W - 20));
      ctx.beginPath();
      ctx.arc(gx - 14, midY - 4, ROW_H * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,215,0,${alpha * 0.6})`;
      ctx.fill();
      ctx.restore();
    }

    // ── Player character (jumps while advancing) ──────────────────────────────
    drawPlayer(dx - 14, midY - 4 - jumpOffset, jerseyFor(p.code), an.legPhase, jumpOffset);

    // ── Ball (smaller, bounces opposite to player) ────────────────────────────
    drawBall(dx + ballR + 6, midY + ROW_H * 0.18 - ballBounceOffset, ballR, an.ballSpin);
  });
}

// ── Render loop ───────────────────────────────────────────────────────────────
function getSorted() {
  return Object.values(state.players)
    .sort((a, b) => b.gifts - a.gifts || b.wins - a.wins);
}

function render() {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  // Fit all 20 countries on screen regardless of resolution
  ROW_H  = Math.max(18, Math.floor(canvas.height / 20));
  GIFT_W = Math.max(22, Math.round(ROW_H * 1.2));
  FLAG_W = Math.max(28, Math.round(ROW_H * 1.35));
  LEFT_W = GIFT_W + FLAG_W;
  RIGHT_W = Math.max(22, Math.round(ROW_H * 0.9));

  const players = getSorted();
  players.forEach(p => {
    if (!anim[p.code]) anim[p.code] = { legPhase: 0, displayX: LEFT_W + 20, ballSpin: 0 };
  });

  drawTrack(players);

  if (players.length === 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.font = 'bold 18px "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Conecta TikTok o usa el panel de prueba 🎁', canvas.width / 2, canvas.height / 2);
  } else {
    drawPlayers(players);
  }

  requestAnimationFrame(render);
}
render();

// ── Podium HTML updater ───────────────────────────────────────────────────────
const POD_IDS = ['pod-1', 'pod-2', 'pod-3'];

function updatePodium() {
  const sorted = Object.values(state.players)
    .sort((a, b) => b.wins - a.wins || b.totalGifts - a.totalGifts);

  [0, 1, 2].forEach(rank => {
    const p      = sorted[rank];
    const el     = document.getElementById(POD_IDS[rank]);
    const flagEl = el.querySelector('.pod-flag');
    const nameEl = el.querySelector('.pod-name');
    const winsEl = el.querySelector('.pod-wins');

    if (!p) {
      flagEl.src = '';
      flagEl.style.visibility = 'hidden';
      nameEl.textContent = '—';
      winsEl.textContent = '0 WINS';
      return;
    }
    const newSrc = flagUrl(p.code);
    if (flagEl.getAttribute('data-code') !== p.code) {
      flagEl.src = newSrc;
      flagEl.style.visibility = 'visible';
      flagEl.setAttribute('data-code', p.code);
      flagEl.classList.remove('bump'); void flagEl.offsetWidth;
      flagEl.classList.add('bump');
    }
    nameEl.textContent = p.name;
    winsEl.textContent = p.wins === 1 ? '1 WIN' : `${p.wins} WINS`;
  });
}

// ── Message handler ───────────────────────────────────────────────────────────
function handleMsg(msg) {
  switch (msg.type) {
    case 'state':
      state.players = {};
      Object.values(msg.state.players).forEach(p => { state.players[p.code] = p; });
      updatePodium();
      break;

    case 'gift': {
      if (anim[msg.code]) anim[msg.code].flashTime = Date.now();
      if (!state.players[msg.code]) {
        state.players[msg.code] = {
          code: msg.code, flag: msg.flag, name: msg.name,
          gifts: 0, wins: 0, totalGifts: 0,
          lastGiftEmoji: '🎁', lastGiftImgUrl: '',
        };
      }
      Object.assign(state.players[msg.code], {
        gifts: msg.gifts, wins: msg.wins, totalGifts: msg.totalGifts,
        lastGiftEmoji:  msg.lastGiftEmoji  || state.players[msg.code].lastGiftEmoji,
        lastGiftImgUrl: msg.lastGiftImgUrl || state.players[msg.code].lastGiftImgUrl,
        lastGiftName:   msg.lastGiftName   || state.players[msg.code].lastGiftName,
      });
      addFeedItem(msg.code, msg.username, msg.amount, msg.lastGiftEmoji, msg.lastGiftImgUrl);
      updatePodium();
      if (msg.newWins === 0) announceGift(msg.username, msg.name, msg.lastGiftName, msg.amount);
      break;
    }

    case 'country_win':
      if (state.players[msg.code]) state.players[msg.code].wins = msg.wins;
      showWinFlash(msg.code, msg.name, msg.wins);
      launchConfetti();
      updatePodium();
      setTimeout(() => animadorSay('GOOOL! ' + msg.name + ' gano una vuelta! ' + msg.wins + (msg.wins === 1 ? ' victoria!' : ' victorias!') + ' Que increible!', true), 800);
      break;

    case 'auto_connect':
      document.getElementById('inp-user').value = msg.username;
      localStorage.setItem('tiktok_user', msg.username);
      setStatus('connecting', `● Conectando @${msg.username}…`);
      send({ type: 'connect_tiktok', username: msg.username });
      break;

    case 'tiktok_connected':    setStatus('online',     `● @${msg.username}`);     break;
    case 'tiktok_disconnected': setStatus('offline',    '● Sin conexión');          break;
    case 'tiktok_error':        setStatus('offline',    `● Error: ${msg.message}`); break;
  }
}

// ── Win flash ─────────────────────────────────────────────────────────────────
function showWinFlash(code, name, wins) {
  document.getElementById('win-flag').src = flagUrl(code);
  document.getElementById('win-text').textContent  = `¡${name} GANA!`;
  document.getElementById('win-count').textContent = `🏆 ${wins} ${wins === 1 ? 'victoria' : 'victorias'}`;
  const el = document.getElementById('win-flash');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function launchConfetti() {
  const colors = ['#ffd700','#ff6b6b','#4ecdc4','#a855f7','#22c55e','#f59e0b','#f472b6'];
  const ov = document.createElement('canvas');
  ov.style.cssText = 'position:fixed;inset:0;z-index:250;pointer-events:none;';
  ov.width = window.innerWidth; ov.height = window.innerHeight;
  document.body.appendChild(ov);
  const oc = ov.getContext('2d');
  const parts = Array.from({ length: 60 }, () => ({
    x: Math.random() * ov.width, y: -20,
    vx: (Math.random() - .5) * 5, vy: 3 + Math.random() * 5,
    rot: Math.random() * Math.PI * 2, vr: (Math.random() - .5) * 0.15,
    w: 8 + Math.random() * 9, h: 6 + Math.random() * 8,
    color: colors[Math.floor(Math.random() * colors.length)],
    circle: Math.random() > .5,
  }));
  let frame = 0; const maxF = 170;
  (function tick() {
    oc.clearRect(0, 0, ov.width, ov.height);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      oc.save(); oc.translate(p.x, p.y); oc.rotate(p.rot);
      oc.globalAlpha = Math.max(0, 1 - frame / maxF);
      oc.fillStyle = p.color;
      oc.beginPath();
      if (p.circle) oc.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      else oc.rect(-p.w / 2, -p.h / 2, p.w, p.h);
      oc.fill(); oc.restore();
    });
    if (++frame < maxF) requestAnimationFrame(tick); else ov.remove();
  })();
}

// ── Gift feed ─────────────────────────────────────────────────────────────────
function addFeedItem(code, username, amount, emoji, imgUrl) {
  const feed = document.getElementById('feed');
  const div  = document.createElement('div');
  div.className = 'feed-item';
  const proxied = proxyUrl(imgUrl);
  const giftHtml = proxied
    ? `<img src="${proxied}" style="height:20px;vertical-align:middle;border-radius:3px">`
    : `<span style="font-size:18px">${emoji || '🎁'}</span>`;
  div.innerHTML = `${giftHtml} <img src="${flagUrl(code)}" style="height:16px;border-radius:2px;vertical-align:middle"> <b>${username}</b> ×${amount}`;
  feed.appendChild(div);
  setTimeout(() => div.remove(), 3200);
  while (feed.children.length > 6) feed.removeChild(feed.firstChild);
}

// ── Animador (announcer character + voice) ────────────────────────────────────
const acv = document.getElementById('animador-canvas');
const acx = acv.getContext('2d');
let animPhase  = 0;
let isSpeaking = false;
let spVoice    = null;

function pickSpanishVoice() {
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return;
  spVoice = vs.find(v => v.lang === 'es-MX') ||
            vs.find(v => v.lang === 'es-ES') ||
            vs.find(v => v.lang.startsWith('es')) || null;
}
pickSpanishVoice();
speechSynthesis.onvoiceschanged = pickSpanishVoice;

function drawAnnouncer() {
  const W = acv.width, H = acv.height;
  acx.clearRect(0, 0, W, H);
  const bob = Math.sin(animPhase) * 2;

  // Shadow
  acx.fillStyle = 'rgba(0,0,0,0.15)';
  acx.beginPath(); acx.ellipse(W/2, H - 5, 14, 4, 0, 0, Math.PI*2); acx.fill();

  // Legs
  acx.strokeStyle = '#1a1a2e'; acx.lineWidth = 5; acx.lineCap = 'round';
  acx.beginPath(); acx.moveTo(W/2-4, 56+bob); acx.lineTo(W/2-5, 72); acx.stroke();
  acx.beginPath(); acx.moveTo(W/2+4, 56+bob); acx.lineTo(W/2+5, 72); acx.stroke();
  // Shoes
  acx.fillStyle = '#111';
  acx.beginPath(); acx.ellipse(W/2-6, 73, 6, 3, -0.2, 0, Math.PI*2); acx.fill();
  acx.beginPath(); acx.ellipse(W/2+6, 73, 6, 3,  0.2, 0, Math.PI*2); acx.fill();

  // Body (suit)
  acx.fillStyle = '#1e3a5f';
  acx.beginPath(); acx.roundRect(W/2-12, 34+bob, 24, 24, [4,4,2,2]); acx.fill();
  // Lapels
  acx.fillStyle = '#fff';
  acx.beginPath();
  acx.moveTo(W/2, 35+bob); acx.lineTo(W/2-4, 43+bob); acx.lineTo(W/2, 45+bob); acx.lineTo(W/2+4, 43+bob);
  acx.closePath(); acx.fill();
  // Tie
  acx.fillStyle = '#e53935';
  acx.beginPath();
  acx.moveTo(W/2-2, 38+bob); acx.lineTo(W/2+2, 38+bob);
  acx.lineTo(W/2+3, 52+bob); acx.lineTo(W/2, 56+bob); acx.lineTo(W/2-3, 52+bob);
  acx.closePath(); acx.fill();

  // Neck
  acx.fillStyle = '#FBBF7A';
  acx.beginPath(); acx.roundRect(W/2-3, 27+bob, 6, 9, 2); acx.fill();

  // Head
  acx.fillStyle = '#FBBF7A';
  acx.beginPath(); acx.arc(W/2, 18+bob, 13, 0, Math.PI*2); acx.fill();
  // Hair
  acx.fillStyle = '#3d1f0a';
  acx.beginPath(); acx.arc(W/2, 10+bob, 10, Math.PI*1.1, Math.PI*1.9); acx.fill();
  acx.beginPath(); acx.ellipse(W/2, 7+bob, 8, 5, 0, 0, Math.PI); acx.fill();
  // Eyes
  acx.fillStyle = '#fff';
  acx.beginPath(); acx.ellipse(W/2-4.5, 17+bob, 3.5, 4, 0, 0, Math.PI*2); acx.fill();
  acx.beginPath(); acx.ellipse(W/2+4.5, 17+bob, 3.5, 4, 0, 0, Math.PI*2); acx.fill();
  acx.fillStyle = '#1a1a2e';
  acx.beginPath(); acx.arc(W/2-4,   17.5+bob, 2, 0, Math.PI*2); acx.fill();
  acx.beginPath(); acx.arc(W/2+5,   17.5+bob, 2, 0, Math.PI*2); acx.fill();
  acx.fillStyle = '#fff';
  acx.beginPath(); acx.arc(W/2-3.2, 16.5+bob, 0.8, 0, Math.PI*2); acx.fill();
  acx.beginPath(); acx.arc(W/2+5.8, 16.5+bob, 0.8, 0, Math.PI*2); acx.fill();
  // Cheeks
  acx.fillStyle = 'rgba(255,150,150,0.35)';
  acx.beginPath(); acx.ellipse(W/2-8, 22+bob, 3, 2, 0, 0, Math.PI*2); acx.fill();
  acx.beginPath(); acx.ellipse(W/2+8, 22+bob, 3, 2, 0, 0, Math.PI*2); acx.fill();
  // Mouth — opens when speaking
  const mh = isSpeaking ? Math.abs(Math.sin(animPhase * 4)) * 3.5 + 1 : 1.5;
  acx.fillStyle = '#a0522d';
  acx.beginPath(); acx.ellipse(W/2, 25+bob, 4, mh, 0, 0, Math.PI*2); acx.fill();
  if (mh > 2.5) {
    acx.fillStyle = '#c0392b';
    acx.beginPath(); acx.ellipse(W/2, 26+bob, 3, mh-1, 0, 0, Math.PI); acx.fill();
  }

  // Arm holding mic
  acx.strokeStyle = '#1e3a5f'; acx.lineWidth = 5;
  acx.beginPath(); acx.moveTo(W/2+11, 42+bob); acx.lineTo(W/2+19, 54); acx.stroke();
  acx.strokeStyle = '#FBBF7A'; acx.lineWidth = 4;
  acx.beginPath(); acx.moveTo(W/2+11, 42+bob); acx.lineTo(W/2+18, 53); acx.stroke();
  // Microphone
  acx.fillStyle = '#222';
  acx.beginPath(); acx.ellipse(W/2+20, 56, 5, 7, 0.2, 0, Math.PI*2); acx.fill();
  acx.fillStyle = '#555';
  acx.beginPath(); acx.ellipse(W/2+19, 55, 3, 5, 0.2, 0, Math.PI*2); acx.fill();
  acx.strokeStyle = '#444'; acx.lineWidth = 2;
  acx.beginPath(); acx.moveTo(W/2+20, 63); acx.lineTo(W/2+20, 70); acx.stroke();

  animPhase += 0.07;
  requestAnimationFrame(drawAnnouncer);
}
drawAnnouncer();

// Speech queue — plays messages one after another
const speechQueue = [];

function nextSpeech() {
  if (speechQueue.length === 0) { isSpeaking = false; return; }
  const text = speechQueue.shift();
  isSpeaking = true;
  const bubble = document.getElementById('animador-bubble');
  bubble.textContent = text;
  bubble.style.display = 'block';
  bubble.style.animation = 'none';
  void bubble.offsetWidth;
  bubble.style.animation = '';
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
    const clean = text.replace(/[^ -ÿ]/g, ' ').replace(/s+/g, ' ').trim();
    const utt = new SpeechSynthesisUtterance(clean);
    if (spVoice) utt.voice = spVoice;
    utt.lang = 'es-MX'; utt.rate = 1.12; utt.pitch = 1.15;
    const done = () => { setTimeout(() => { bubble.style.display = 'none'; nextSpeech(); }, 250); };
    utt.onend = done; utt.onerror = done;
    speechSynthesis.speak(utt);
  } else {
    setTimeout(() => { bubble.style.display = 'none'; nextSpeech(); }, Math.max(1800, text.length * 58));
  }
}

function animadorSay(text, urgent = false) {
  if (urgent) speechQueue.unshift(text);
  else if (speechQueue.length < 3) speechQueue.push(text);
  if (!isSpeaking) nextSpeech();
}

function announceGift(username, countryName, giftName, amount) {
  const g   = giftName || 'un regalo';
  const amt = amount > 1 ? ' por ' + amount : '';
  const opts = [
    'Epa! ' + username + ' le mando ' + g + amt + ' a ' + countryName + '! Arriba ' + countryName + '!',
    'Wow wow wow! ' + username + ' esta apoyando a ' + countryName + '! Que locura!',
    'Oigan! ' + username + ' activo a ' + countryName + ' con ' + g + amt + '! Se prende esto!',
    'No no no! ' + username + ' le metio ' + g + ' a ' + countryName + '! Eso si es apoyo!',
    'Si senor! ' + username + ' cree en ' + countryName + '! ' + countryName + ' para arriba!',
    'Fuego! Fuego! ' + username + ' mando ' + g + amt + ' para ' + countryName + '!',
    'Miren eso! ' + username + ' aparece con ' + g + ' y le da vida a ' + countryName + '!',
    'Oye tu! ' + username + ' acaba de hacer mover a ' + countryName + '! Brutal!',
  ];
  animadorSay(opts[Math.floor(Math.random() * opts.length)]);
}

const IDLE_LINES = [
  'Quien va a ganar hoy? Tu decides mandando regalos!',
  'Eres de Mexico? Manda una Rosa para que avance tu pais!',
  'Eres de Colombia? Un Pop y Colombia se dispara!',
  'Eres de Brasil? Manda Es Maiz y Brasil revienta!',
  'Eres de Argentina? Rosa Blanca para los gauchos!',
  'Eres de Espana? Manda TikTok y Espana vuela!',
  'Eres de Chile? Maracas para que Chile se mueva!',
  'Eres de USA? Un GG y USA se pone a correr!',
  'El que mas regalos mande gana la vuelta! Apurate!',
  'Miren que emocionante! Cualquier pais puede ganar!',
  'Eres de Ecuador? Guino Guino para Ecuador!',
  'Eres de Venezuela? Alas Guardian y Venezuela despega!',
  'Treinta regalos y ganas una vuelta! A darle!',
  'No se queden quietos! Su pais los necesita ahora!',
  'Esto esta muy apretado! Quien va a romperla primero?',
  'Mira tu pais ahi parado esperandote! Mandele un regalito!',
  'Hay alguien de Peru? Estilo Libre para Peru!',
  'Hay alguien de Bolivia? Cono de helado para Bolivia!',
  'Alguien de Panama? Fragmento para que Panama corra!',
  'No sean tacanos! Manden regalos para sus paises! Un regalito no duele!',
  'Oigan! No sean tacanos! Su pais los necesita ahora mismo!',
  'Ey ey ey! No sean tacanos! Manden ese regalito para su pais!',
  'No sean tacanos que es solo un peso! Manden regalo para su pais!',
  'Todos envien regalos para sus paises! No sean tacanos por favor!',
  'Vamos vamos! No sean tacanos! Su seleccion los esta esperando!',
  'Oiga oiga! No sea tacano! Mande su regalito y haga correr a su pais!',
];
let idleIdx = Math.floor(Math.random() * IDLE_LINES.length);

setInterval(() => {
  if (speechQueue.length === 0 && !isSpeaking) {
    animadorSay(IDLE_LINES[idleIdx % IDLE_LINES.length]);
    idleIdx++;
  }
}, 11000);

setTimeout(() => animadorSay('Bienvenidos al Mundialito de Paises! Manda regalos para que tu pais avance y gane la vuelta!', true), 3500);


// ── Panel controls ────────────────────────────────────────────────────────────
const panel = document.getElementById('panel');

// Hidden by default — press ~ to toggle during stream
document.addEventListener('keydown', e => {
  if (e.key === '`' || e.key === '~') {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }
});

document.getElementById('panel-header').addEventListener('click', () => {
  const body = document.getElementById('panel-body');
  const icon = document.getElementById('toggle-icon');
  body.classList.toggle('hidden');
  icon.textContent = body.classList.contains('hidden') ? '▼' : '▲';
});

document.getElementById('btn-connect').addEventListener('click', () => {
  const u = document.getElementById('inp-user').value.replace('@', '').trim();
  if (!u) return;
  localStorage.setItem('tiktok_user', u);
  setStatus('connecting', '● Conectando…');
  send({ type: 'connect_tiktok', username: u });
});

document.getElementById('inp-user').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-connect').click();
});

// Auto-connect is handled server-side via TIKTOK_USERNAME in server.js

// Auto-select the country's assigned gift when country changes
document.getElementById('sel-country').addEventListener('change', () => {
  const code = document.getElementById('sel-country').value;
  const gift = COUNTRY_GIFT[code];
  if (gift) {
    const opt = document.querySelector(`#sel-gift option[value="${gift}"]`);
    if (opt) document.getElementById('sel-gift').value = gift;
  }
});

const GIFT_COINS = new Proxy({}, { get: () => 1 });

document.getElementById('btn-gift').addEventListener('click', () => {
  const country  = document.getElementById('sel-country').value;
  const giftName = document.getElementById('sel-gift').value;
  const qty      = parseInt(document.getElementById('inp-qty').value) || 1;
  const coins    = (GIFT_COINS[giftName] || 1) * qty;
  send({ type: 'test_gift', country, coins, giftName });
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('¿Resetear todos los datos?')) {
    state.players = {};
    send({ type: 'reset_all' });
  }
});

function setStatus(cls, text) {
  const el = document.getElementById('tiktok-status');
  el.className = 'status ' + cls;
  el.textContent = text;
  const btn = document.getElementById('btn-reconnect');
  if (cls === 'online') {
    btn.textContent = '📡 Conectado';
    btn.classList.add('connected');
  } else if (cls === 'connecting') {
    btn.textContent = '📡 Conectando…';
    btn.classList.remove('connected');
  } else {
    btn.textContent = '📡 Sin conexión';
    btn.classList.remove('connected');
  }
}

document.getElementById('btn-reconnect').addEventListener('click', () => {
  const u = localStorage.getItem('tiktok_user') || 'juandavidyt16';
  setStatus('connecting', '● Conectando…');
  send({ type: 'connect_tiktok', username: u });
});
