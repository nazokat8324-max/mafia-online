'use strict';
/* Mafia — brauzer qismi. Server yuborgan holatni (state) chizadi va
   o'yinchi harakatlarini serverga jo'natadi. */

const socket = io();
const $ = (id) => document.getElementById(id);

let ROLES = {};
let state = null;
let clockOffset = 0;          // server va brauzer soati farqi
let roleShownForGame = false; // rol kartasi bir marta ko'rsatiladi
let lastPhase = null;

const PHASES = {
  lobby: '🪑 Kutish zali',
  roles: '🃏 Rollar',
  night: '🌙 Tun',
  morning: '☀️ Tong',
  lastWord: "🕯️ Oxirgi so'z",
  day: '🗣️ Muhokama',
  vote: '🗳️ Ovoz berish',
  voteResult: '⚖️ Hukm',
  gameover: "🏁 O'yin tugadi",
};
const TEAMS = {
  town: '🟢 Tinch aholi jamoasi',
  mafia: '🔴 Mafia jamoasi',
  maniac: '⚫ Yolg\'iz — faqat o\'zingiz uchun',
  jester: '🤡 Yolg\'iz — maqsadingiz shahardan chiqarilish',
};
const TEAM_COLOR = { town: 'var(--cyan)', mafia: 'var(--red)', maniac: 'var(--violet)', jester: 'var(--amber)' };
const TIME_LABEL = (s) => (s ? `${s} s` : 'avto');

// ───────── avatarlar ─────────
const AVATARS = ['🦊', '🐺', '🦁', '🐯', '🐼', '🐸', '🐙', '🦉', '🐻', '🐨', '🦄', '🐲',
  '🦅', '🐍', '🦈', '🐝', '🤖', '👽', '👻', '🎃', '🤠', '🐧', '🧛', '🧙'];
const COLORS = ['#ff2bd6', '#22e6ff', '#8b5cf6', '#39ff9f', '#ffb020', '#ff3b5c', '#3b82f6', '#f472b6'];

function loadAvatar() {
  try {
    const a = JSON.parse(localStorage.getItem('mafia-avatar'));
    if (a && AVATARS.includes(a.e) && a.c >= 0 && a.c < COLORS.length) return a;
  } catch {}
  return { e: AVATARS[Math.floor(Math.random() * AVATARS.length)], c: Math.floor(Math.random() * COLORS.length) };
}
let myAvatar = loadAvatar();
function saveAvatar() { try { localStorage.setItem('mafia-avatar', JSON.stringify(myAvatar)); } catch {} }

/** Avatar tanlash paneli (bosh sahifa va lobbidagi oyna uchun umumiy) */
function avatarPicker(gridEl, colorEl, previewEl, getA, setA) {
  const draw = () => {
    const a = getA();
    previewEl.textContent = a.e;
    previewEl.style.setProperty('--c', COLORS[a.c]);
    gridEl.style.setProperty('--pick', COLORS[a.c]);
    gridEl.innerHTML = AVATARS.map((e) => `<button type="button" data-e="${e}" class="${e === a.e ? 'on' : ''}">${e}</button>`).join('');
    colorEl.innerHTML = COLORS.map((c, i) => `<button type="button" data-c="${i}" style="--c:${c}" class="${i === a.c ? 'on' : ''}" aria-label="rang ${i + 1}"></button>`).join('');
  };
  gridEl.onclick = (e) => { const b = e.target.closest('[data-e]'); if (b) { setA({ ...getA(), e: b.dataset.e }); draw(); Sound.play('select'); } };
  colorEl.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { setA({ ...getA(), c: Number(b.dataset.c) }); draw(); Sound.play('select'); } };
  draw();
  return draw;
}

// ───────── sessiya (sahifa yangilanganda qaytish uchun) ─────────
const SESSION_KEY = 'mafia-session';
function saveSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} }
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } }
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} }

// ───────── yordamchilar ─────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2600);
}
function show(screen) {
  $('home').classList.toggle('hidden', screen !== 'home');
  $('game').classList.toggle('hidden', screen !== 'game');
  if (screen === 'home') setPhaseClass('home');
}
function setPhaseClass(phase) {
  document.body.className = `phase-${phase}`;
  if (phase === 'night') document.body.classList.add('night');
}

// ───────── fon: neon shahar silueti ─────────
(function drawSkyline() {
  const W = 1600, H = 220;
  let x = 0, svg = '';
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  while (x < W) {
    const w = 40 + rnd() * 70, h = 60 + rnd() * 150;
    svg += `<rect x="${x}" y="${H - h}" width="${w - 4}" height="${h}" fill="#0a0818" stroke="url(#edge)" stroke-width="1"/>`;
    for (let wy = H - h + 10; wy < H - 10; wy += 14) {
      for (let wx = x + 6; wx < x + w - 12; wx += 11) {
        if (rnd() < 0.22) {
          const col = rnd() < 0.5 ? '#ff2bd6' : rnd() < 0.5 ? '#22e6ff' : '#ffb020';
          svg += `<rect class="win" x="${wx}" y="${wy}" width="4" height="6" fill="${col}" style="animation-delay:${(rnd() * 7).toFixed(2)}s"/>`;
        }
      }
    }
    x += w;
  }
  $('skyline').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">
    <defs><linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".9"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></linearGradient></defs>${svg}</svg>`;
})();

// ───────── bosh sahifa ─────────
try { $('nameInput').value = localStorage.getItem('mafia-name') || ''; } catch {}
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('codeInput').value = urlRoom.toUpperCase();

avatarPicker($('emojiGrid'), $('colorRow'), $('avatarPreview'), () => myAvatar, (a) => { myAvatar = a; saveAvatar(); });
$('avatarPreview').onclick = () => {
  myAvatar = { e: AVATARS[Math.floor(Math.random() * AVATARS.length)], c: Math.floor(Math.random() * COLORS.length) };
  saveAvatar();
  avatarPicker($('emojiGrid'), $('colorRow'), $('avatarPreview'), () => myAvatar, (a) => { myAvatar = a; saveAvatar(); });
};

function entered(res) {
  if (res.error) { $('homeError').textContent = res.error; return; }
  $('homeError').textContent = '';
  saveSession({ code: res.code, token: res.token });
  history.replaceState(null, '', `?room=${res.code}`);
  roleShownForGame = false;
  show('game');
}
function getName() {
  const name = $('nameInput').value.trim();
  try { localStorage.setItem('mafia-name', name); } catch {}
  return name;
}
$('createBtn').onclick = () => socket.emit('create', { name: getName(), avatar: myAvatar }, entered);
$('joinBtn').onclick = () => socket.emit('join', { name: getName(), code: $('codeInput').value, avatar: myAvatar }, entered);
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('codeInput').value ? $('joinBtn') : $('createBtn')).click(); });

$('copyBtn').onclick = async () => {
  const link = `${location.origin}/?room=${state.code}`;
  try { await navigator.clipboard.writeText(link); toast('Havola nusxalandi — do\'stlaringizga yuboring'); }
  catch { prompt('Havolani nusxalang:', link); }
};
$('leaveBtn').onclick = () => {
  const playing = state && !['lobby', 'gameover'].includes(state.phase) && state.me.alive;
  if (playing && !confirm("O'yindan chiqsangiz, siz o'lgan hisoblanasiz. Chiqasizmi?")) return;
  Voice.leave();
  socket.emit('leave');
  clearSession();
  state = null;
  history.replaceState(null, '', '/');
  show('home');
};

// ───────── lobbida avatarni almashtirish ─────────
let avatarDraft = null;
function openAvatarModal() {
  const me = state.players.find((p) => p.id === state.me.id);
  avatarDraft = { e: (me.avatar && me.avatar.e) || myAvatar.e, c: me.avatar ? me.avatar.c : myAvatar.c };
  avatarPicker($('emojiGrid2'), $('colorRow2'), $('avatarModalPreview'), () => avatarDraft, (a) => { avatarDraft = a; });
  $('avatarModal').classList.remove('hidden');
}
$('avatarSave').onclick = () => {
  myAvatar = avatarDraft;
  saveAvatar();
  socket.emit('avatar', myAvatar);
  $('avatarModal').classList.add('hidden');
};
$('avatarCancel').onclick = () => $('avatarModal').classList.add('hidden');

// ───────── telefon tablari ─────────
let activeTab = 'me';
function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === tab));
  if (tab === 'chat') { unread.chat = 0; const l = $('chatList'); l.scrollTop = l.scrollHeight; }
  if (tab === 'log') { unread.log = 0; const l = $('log'); l.scrollTop = l.scrollHeight; }
  drawDots();
}
const unread = { chat: 0, log: 0 };
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
function drawDots() {
  for (const k of ['chat', 'log']) {
    const dot = $(k + 'Dot');
    dot.classList.toggle('on', unread[k] > 0);
    dot.textContent = unread[k] > 9 ? '9+' : unread[k] || '';
  }
}
$('tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); };
setTab('me');

// ───────── socket hodisalari ─────────
socket.on('roles', (r) => { ROLES = r; });

socket.on('connect', () => {
  const s = loadSession();
  if (!s) return;
  socket.emit('resume', s, (res) => {
    if (res.error) { clearSession(); show('home'); return; }
    show('game');
  });
});

socket.on('state', (s) => {
  clockOffset = s.now - Date.now();
  if (s.phase === 'lobby') roleShownForGame = false;
  const prev = state;
  state = s;
  Voice.sync(s);
  trackChanges(prev, s);
  render();
  playSounds(prev, s);
  playEffects(prev, s);
});

// ───────── OVOZLI CHAT ─────────
Voice.init(socket, (msg) => { if (msg) toast(msg); renderVoice(); });

const VOICE_MODE = {
  all: '🟢 Hamma bir-birini eshitadi',
  silent: '🌙 Jimlik — hech kim eshitmaydi',
  mafia: '🔫 Faqat mafiya sheriklaringiz eshitadi',
  listen: "💀 Siz o'lgansiz — faqat tinglaysiz",
  lastword: "🕯️ Faqat oxirgi so'z egasi gapiradi",
  'lastword-speaker': "🕯️ Oxirgi so'zingiz — hamma sizni eshitadi",
};

/** Faqat mazmun o'zgarganda qayta chizadi — aks holda bosilayotgan tugma "yo'qolib" qolishi mumkin */
function setHTML(el, html) {
  if (el.dataset.html === html) return false;
  el.dataset.html = html;
  el.innerHTML = html;
  return true;
}

function renderVoice() {
  const box = $('voiceBox');
  if (!state) return;
  // Tuzilma faqat holat turi o'zgarganda quriladi, keyin faqat matnlar yangilanadi —
  // shunda tugmalar o'rnida qoladi va bosish yo'qolmaydi
  const kind = !Voice.supported ? 'na' : !Voice.enabled ? 'join' : Voice.hasMic ? 'mic' : 'listen';
  if (box.dataset.kind !== kind) {
    box.dataset.kind = kind;
    if (kind === 'na') {
      box.innerHTML = "<h3>🎙️ Ovozli chat</h3><p class=\"voice-status\">Bu brauzer ovozli chatni qo'llamaydi</p>";
    } else if (kind === 'join') {
      box.innerHTML = `<h3 class="v-title">🎙️ Ovozli chat</h3><p class="voice-status v-status"></p>
        <button class="btn primary wide" id="voiceJoin">🎙️ Ovozli chatga qo'shilish</button>`;
      $('voiceJoin').onclick = () => Voice.join();
    } else {
      box.innerHTML = `<h3 class="v-title"></h3><p class="voice-status v-status"></p>
        <div class="voice-btns">${kind === 'mic' ? '<button class="btn" id="voiceMute"></button>' : '<span class="voice-status">🎧 Faqat tinglash</span>'}
        <button class="btn ghost" id="voiceLeave">Chiqish</button></div>`;
      if ($('voiceMute')) $('voiceMute').onclick = () => Voice.toggleMute();
      $('voiceLeave').onclick = () => Voice.leave();
    }
  }
  if (kind === 'na') return;
  const inVoice = state.players.filter((p) => p.voice).length;
  const title = box.querySelector('.v-title');
  const status = box.querySelector('.v-status');
  if (kind === 'join') {
    status.textContent = inVoice ? `Hozir ${inVoice} kishi ovozli chatda` : 'Mikrofon orqali gaplashing';
    return;
  }
  title.textContent = `🎙️ Ovozli chat · ${inVoice} kishi`;
  status.textContent = VOICE_MODE[Voice.mode] || '';
  const mute = $('voiceMute');
  if (mute) {
    mute.textContent = Voice.muted ? "🔇 Mikrofon o'chiq" : '🎙️ Mikrofon yoqiq';
    mute.classList.toggle('danger', Voice.muted);
  }
}

// ───────── ovozlar: holat o'zgarishiga qarab ─────────
let lastDeathLogId = Infinity;
function playSounds(prev, s) {
  const deaths = s.log.filter((l) => l.kind === 'death');
  const newestDeath = deaths.length ? deaths[deaths.length - 1].id : 0;
  if (!prev) { lastDeathLogId = newestDeath; Sound.music(musicFor(s)); return; }

  if (prev.phase !== s.phase) {
    if (s.phase === 'roles') Sound.play('start');
    if (s.phase === 'night') Sound.play('nightfall');
    if (s.phase === 'morning') Sound.play('morning');
    if (s.phase === 'vote' || s.phase === 'voteResult') Sound.play('gavel');
    if (s.phase === 'gameover') Sound.play(iWon(s) ? 'win' : 'lose');
  }
  if (s.me.awake && !prev.me.awake) Sound.play('wake');
  if (newestDeath > lastDeathLogId && s.phase !== 'gameover') Sound.play('death');
  lastDeathLogId = newestDeath;
  Sound.music(musicFor(s));
}
function musicFor(s) {
  if (s.phase === 'night' || s.phase === 'roles') return 'night';
  if (s.phase === 'vote') return 'vote';
  return null;
}
function iWon(s) {
  const myTeam = s.me.role && ROLES[s.me.role] ? ROLES[s.me.role].team : null;
  return !!myTeam && myTeam === s.winner;
}

function updateSoundBtn() {
  $('soundBtn').textContent = { all: '🔊', sfx: '🔉', off: '🔇' }[Sound.mode];
}
$('soundBtn').onclick = () => {
  const m = Sound.cycle();
  updateSoundBtn();
  toast({ all: 'Musiqa va effektlar yoqildi', sfx: 'Faqat effektlar', off: "Ovoz o'chirildi" }[m]);
};
updateSoundBtn();

// ───────── animatsiyalar ─────────
const dyingUntil = new Map();   // o'lgan o'yinchi — silkinish animatsiyasi
const seenSeats = new Set();    // yangi o'tirganlar — paydo bo'lish animatsiyasi
let enterIds = new Set();
let bumpIds = new Set();

function trackChanges(prev, s) {
  enterIds = new Set();
  for (const p of s.players) {
    if (!seenSeats.has(p.id)) { if (prev) enterIds.add(p.id); seenSeats.add(p.id); }
  }
  bumpIds = new Set();
  if (!prev) return;
  const before = new Map(prev.players.map((p) => [p.id, p]));
  for (const p of s.players) {
    const b = before.get(p.id);
    if (!b) continue;
    if (b.alive && !p.alive && s.phase !== 'lobby') dyingUntil.set(p.id, Date.now() + 1700);
    if (p.votes && p.votes !== b.votes) bumpIds.add(p.id);
  }
}

const FX = {
  night: { icon: '🌙', title: 'TUN TUSHDI', sub: 'Shahar uxlamoqda...' },
  morning: { icon: '☀️', title: 'TONG OTDI', sub: 'Tunda nima bo\'ldi?' },
  vote: { icon: '⚖️', title: 'OVOZ BERISH', sub: 'Kim shahardan chiqariladi?' },
  roles: { icon: '🃏', title: 'ROLLAR', sub: 'Kartangizni hech kimga ko\'rsatmang' },
  lastWord: { icon: '🕯️', title: "OXIRGI SO'Z", sub: '' },
};
let fxTimer = null;
function playFx(kind, data) {
  const el = $('phaseFx');
  el.className = 'phase-fx';
  void el.offsetWidth; // animatsiyani qayta boshlash
  el.innerHTML = `<div class="fx-bg"></div><div><div class="fx-icon">${data.icon}</div>
    <p class="fx-title">${esc(data.title)}</p>${data.sub ? `<p class="fx-sub">${esc(data.sub)}</p>` : ''}</div>`;
  el.classList.add('fx-' + kind, 'play');
  clearTimeout(fxTimer);
  fxTimer = setTimeout(() => { el.className = 'phase-fx'; }, 3500);
}

function playEffects(prev, s) {
  if (!prev) return;
  if (prev.phase !== s.phase) {
    if (s.phase === 'gameover') {
      const won = iWon(s);
      const w = s.log.filter((l) => l.kind === 'win').pop();
      playFx(won ? 'win' : 'lose', { icon: won ? '🏆' : '🥀', title: won ? "G'ALABA" : "MAG'LUBIYAT", sub: w ? w.text : '' });
    } else if (FX[s.phase]) {
      playFx(s.phase, FX[s.phase]);
    }
  }
  const newlyDead = s.players.some((p) => dyingUntil.has(p.id) && dyingUntil.get(p.id) > Date.now() + 1500);
  if (newlyDead) {
    const f = $('flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
    if (navigator.vibrate) try { navigator.vibrate([80, 60, 120]); } catch {}
  }
}

// ───────── chat ─────────
socket.on('chatHistory', (list) => {
  $('chatList').innerHTML = '';
  list.forEach((m) => addChat(m, true));
});
socket.on('chat', (m) => addChat(m, false));

function addChat(m, history) {
  const li = document.createElement('li');
  const mine = state && m.fromId === state.me.id;
  if (m.channel === 'mafia') li.classList.add('mafia');
  if (m.lastWord) li.classList.add('lastword');
  if (mine) li.classList.add('mine');
  const prefix = m.channel === 'mafia' ? '🔫 ' : m.lastWord ? '🕯️ ' : '';
  li.innerHTML = `${prefix}<b>${esc(m.from)}:</b> ${esc(m.text)}`;
  const list = $('chatList');
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
  if (history || mine) return;
  Sound.play('pop');
  if (isMobile() && activeTab !== 'chat') { unread.chat++; drawDots(); }
}

$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  socket.emit('chat', text);
  $('chatInput').value = '';
};

// ───────── stolni bosish (tanlash) ─────────
$('seats').addEventListener('click', (e) => {
  const seat = e.target.closest('.seat');
  if (!seat || !state) return;
  const id = seat.dataset.id;
  if (id === state.me.id && state.phase === 'lobby') return openAvatarModal();
  if (!state.me.targets.includes(id)) return;
  Sound.play(state.step && state.step.key === 'sniper' ? 'shot' : 'select');
  if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
  socket.emit(state.phase === 'vote' ? 'vote' : 'act', id);
});

// ───────── CHIZISH ─────────
function render() {
  if (!state) return;
  const { me, phase } = state;
  const isNight = phase === 'night';

  setPhaseClass(phase);
  $('roomCode').textContent = state.code;
  $('phaseLabel').textContent = PHASES[phase] + (state.round && !['lobby', 'gameover'].includes(phase) ? ` · ${state.round}` : '');

  // Tun: uyg'oq bo'lmaganlar uchun ekran qorong'u
  $('nightOverlay').classList.toggle('hidden', !isNight || me.awake);
  $('nightStep').textContent = isNight && state.step ? state.step.title + '...' : '';
  const banner = $('awakeBanner');
  banner.classList.toggle('hidden', !me.awake);
  if (me.awake) {
    banner.textContent = me.blocked
      ? `💋 ${state.step.title}, lekin Mashuqa sizning oldingizda — bu tun harakat qila olmaysiz`
      : me.noBullets ? "🎯 O'qingiz tugagan. Shahar uyg'onishini kuting..."
        : `👁️ Siz uyg'oqsiz! ${me.prompt}`;
  }

  renderSeats();
  renderCenter();
  renderVoice();
  renderRoleCard();
  renderLog();

  // Chat holati
  const chatInput = $('chatInput');
  chatInput.disabled = !me.chat;
  $('chatTitle').textContent = me.chat === 'mafia' ? '🔫 Mafia suhbati (yashirin)' : '💬 Suhbat';
  chatInput.placeholder = me.lastWord ? "Oxirgi so'zingizni yozing..."
    : me.chat
      ? (me.chat === 'mafia' ? 'Faqat mafiya ko\'radi...' : 'Xabar yozing...')
      : phase === 'lastWord' ? "Tinglang — o'lgan o'yinchi gapirmoqda"
        : (me.alive ? 'Hozir gapirish mumkin emas' : "O'liklar gapirmaydi...");
  // Telefonda oxirgi so'z navbati kelsa — chatni ochamiz
  if (me.lastWord && isMobile() && activeTab !== 'chat') setTab('chat');

  // Rol kartasi
  if (phase === 'roles' && me.role && !roleShownForGame) {
    roleShownForGame = true;
    setTimeout(() => openRoleModal(false), 1200); // sahna effektidan keyin
  }
  if (phase !== lastPhase && phase !== 'roles' && lastPhase === 'roles') $('roleModal').classList.add('hidden');
  lastPhase = phase;
}

function seatPositions(n) {
  // Ellips bo'ylab joylashuv, 0-o'rin pastda (o'zingizga yaqin)
  const el = $('seats');
  const wide = el.clientWidth / Math.max(1, el.clientHeight);
  const rx = wide > 1.1 ? 43 : 40;
  const ry = wide > 1.1 ? 41 : 40;
  return Array.from({ length: n }, (_, i) => {
    const a = Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
  });
}

/** O'yinchilar soni va stol o'lchamiga qarab avatar kattaligi */
function avatarSize(n) {
  const el = $('seats');
  const w = el.clientWidth, h = el.clientHeight;
  const perimeter = Math.PI * (0.85 * w + 0.84 * h) / 2 * 2 * 0.5; // ellips aylanasining taxminiy uzunligi
  const per = perimeter / Math.max(n, 5);
  return Math.round(Math.max(34, Math.min(70, per * 0.5, w * 0.12)));
}

function renderSeats() {
  const { players, me, phase } = state;
  // O'zimiz doim pastda o'tirishimiz uchun o'rinlarni aylantiramiz
  const myIndex = Math.max(0, players.findIndex((p) => p.id === me.id));
  const ordered = players.map((_, i) => players[(i + myIndex) % players.length]);
  const pos = seatPositions(ordered.length);
  $('seats').style.setProperty('--av', avatarSize(ordered.length) + 'px');
  const meMafia = me.role && ROLES[me.role] && ROLES[me.role].team === 'mafia';
  const now = Date.now();

  $('seats').innerHTML = ordered.map((p, i) => {
    const role = p.role && ROLES[p.role];
    const color = COLORS[p.avatar ? p.avatar.c : 0] || COLORS[0];
    const cls = ['seat'];
    if (p.id === me.id) cls.push('me');
    if (!p.alive) cls.push('dead');
    if (!p.connected) cls.push('offline');
    if (p.speaking) cls.push('speaking');
    if (meMafia && role && role.team === 'mafia' && p.id !== me.id) cls.push('teammate');
    if (me.targets.includes(p.id)) cls.push('targetable');
    if (me.myTarget === p.id) cls.push('selected');
    if (enterIds.has(p.id)) cls.push('enter');
    if ((dyingUntil.get(p.id) || 0) > now) cls.push('dying');

    let tag = '';
    if (role) tag = role.name;
    else if (p.known === 'mafia') tag = '🔴 Mafia!';
    else if (p.known === 'clean') tag = '🟢 Toza';
    else if (p.known === 'commissar') tag = '🔴 Komissar!';
    else if (p.known === 'notcommissar') tag = '⚪ Komissar emas';
    if (p.speaking) tag = "🕯️ Oxirgi so'z";
    if (!p.connected) tag += ' 📴';
    if (p.id === me.id && phase === 'lobby') tag = isMobile() ? '✎ avatar' : '✎ avatarni almashtirish';

    const face = p.avatar && p.avatar.e ? p.avatar.e : esc(p.name[0].toUpperCase());
    let badges = '';
    if (role) badges += `<span class="badge role" title="${esc(role.name)}">${role.icon}</span>`;
    if (p.votes) badges += `<span class="badge${bumpIds.has(p.id) ? ' bump' : ''}">${p.votes}</span>`;
    if (p.ready) badges += '<span class="badge ok">✓</span>';
    if (p.id === state.hostId && phase === 'lobby') badges += '<span class="badge left">👑</span>';
    if (p.voice && !role) badges += '<span class="badge mic">🎙️</span>';

    let picks = '';
    if (p.mafiaPicks && p.mafiaPicks.length) picks = `<div class="picks">🎯 ${p.mafiaPicks.map(esc).join(', ')}</div>`;

    let voted = '';
    if (p.votedFor) {
      const t = players.find((q) => q.id === p.votedFor);
      if (t) voted = `<div class="picks">→ ${esc(t.name)}</div>`;
    }

    return `<div class="${cls.join(' ')}" data-id="${p.id}" style="left:${pos[i].x}%;top:${pos[i].y}%;--c:${color}">
      <div class="avatar">${face}${badges}</div>
      <div class="name">${esc(p.name)}${p.id === me.id && !isMobile() ? ' (siz)' : ''}</div>
      <div class="tag">${esc(tag)}</div>${picks}${voted}
    </div>`;
  }).join('');
  // Gapirayotganlar halqasi qayta chizilgandan keyin ham saqlansin
  if (Voice.enabled) for (const id of Voice.talkingIds()) {
    const el = document.querySelector(`.seat[data-id="${id}"]`);
    if (el) el.classList.add('talking');
  }
}

function compositionChips() {
  return Object.entries(state.composition)
    .map(([r, n]) => `<span class="chip" title="${ROLES[r] ? esc(ROLES[r].name) : r}">${ROLES[r] ? ROLES[r].icon : ''}<span class="lbl">${ROLES[r] ? ROLES[r].name : r}</span>${n > 1 ? ' ×' + n : ''}</span>`)
    .join('');
}

function renderCenter() {
  const { phase, me, players } = state;
  const isHost = me.id === state.hostId;
  const lastLog = state.log.filter((l) => l.to === null).slice(-3).map((l) => `<p>${esc(l.text)}</p>`).join('');
  let html = '';

  if (phase === 'lobby') {
    const n = players.length;
    const enough = n >= state.minPlayers;
    const st = state.settings;
    const summary = [
      st.mode === 'custom' ? '🎭 Rollar: qo\'lda' : '🎭 Rollar: avto',
      `🗣️ ${TIME_LABEL(st.dayTime)}`, `🌙 ${st.nightTime} s`, `🗳️ ${st.voteTime} s`,
      st.revealRoles ? '👁️ Rollar ochiladi' : '🙈 Rollar yashirin',
      st.lastWord ? "🕯️ Oxirgi so'z" : '',
    ].filter(Boolean).map((t) => `<span class="chip">${t}</span>`).join('');
    html = `<h2>${n} / ${state.maxPlayers} o'yinchi</h2>
      <p>${enough ? "O'yinni boshlash mumkin!" : `Yana kamida ${state.minPlayers - n} kishi kerak`}</p>
      <div class="chips">${compositionChips()}</div>
      <div class="chips muted-chips">${summary}</div>
      ${state.rolesError ? `<p class="center-error">⚠️ ${esc(state.rolesError)}</p>` : ''}
      ${isHost
        ? `<div class="center-btns"><button class="btn" id="settingsBtn">⚙️ Sozlamalar</button>
           <button class="btn primary" id="startBtn" ${enough && !state.rolesError ? '' : 'disabled'}>▶ Boshlash</button></div>`
        : '<p>👑 Xona egasi o\'yinni boshlashini kuting</p>'}`;
  } else if (phase === 'roles') {
    html = `<h2>🃏 Rollar tarqatildi</h2><p>Kartangizni hech kimga ko'rsatmang!</p>
      <div class="chips">${compositionChips()}</div>`;
  } else if (phase === 'night') {
    let hint = 'Nishonni tanlash uchun o\'yinchini bosing';
    if (me.blocked) hint = 'Bu tun siz band ekansiz...';
    else if (me.noBullets) hint = "O'qingiz tugagan";
    else if (!me.canAct) hint = 'Tanlov qilindi ✔';
    html = me.awake
      ? `<h2>${esc(state.step.title)}</h2><p>${hint}</p>
         ${me.canSkip ? '<button class="btn" id="skipBtn">Bu tun o\'q uzmayman</button>' : ''}`
      : `<h2>🌙 Tun</h2>`;
  } else if (phase === 'lastWord') {
    const speakers = players.filter((p) => p.speaking).map((p) => esc(p.name)).join(', ');
    html = `<h2>🕯️ Oxirgi so'z</h2>
      ${me.lastWord
        ? `<p>Siz gapirasiz! Chatga oxirgi so'zingizni yozing.</p><button class="btn primary" id="endWordBtn">Gapirib bo'ldim</button>`
        : `<p>${speakers} gapirmoqda. Tinglang...</p>`}`;
  } else if (phase === 'day') {
    const ready = players.find((p) => p.id === me.id).ready;
    html = `<h2>🗣️ Muhokama</h2><p>Kim mafiya? Gaplashing, dalil keltiring.</p>${lastLog}
      ${me.alive ? `<button class="btn ${ready ? '' : 'primary'}" id="readyBtn">${ready ? 'Bekor qilish' : 'Ovozga o\'tish'} (${state.readyCount}/${state.aliveCount})</button>` : ''}`;
  } else if (phase === 'vote') {
    html = `<h2>🗳️ Ovoz bering</h2>
      <p>${me.alive ? 'Shahardan chiqariladigan o\'yinchini bosing' : 'Tiriklar ovoz bermoqda...'}</p>`;
  } else if (phase === 'morning' || phase === 'voteResult') {
    html = `<h2>${PHASES[phase]}</h2>${lastLog}`;
  } else if (phase === 'gameover') {
    const w = state.log.filter((l) => l.kind === 'win').pop();
    html = `<h2>${iWon(state) ? "🏆 G'alaba!" : "🏁 O'yin tugadi"}</h2><p>${w ? esc(w.text) : ''}</p>
      ${isHost ? '<button class="btn primary" id="againBtn">↻ Yana o\'ynash</button>' : '<p>Xona egasi yangi o\'yin boshlashi mumkin</p>'}`;
  }

  // Bir xil matnni qayta chizmaymiz — aks holda animatsiya har safar qaytadan boshlanadi
  setHTML($('center'), html);
  const startBtn = $('startBtn');
  if (startBtn) startBtn.onclick = () => socket.emit('start', (r) => r && r.error && toast(r.error));
  const readyBtn = $('readyBtn');
  if (readyBtn) readyBtn.onclick = () => socket.emit('ready');
  const againBtn = $('againBtn');
  if (againBtn) againBtn.onclick = () => socket.emit('lobby');
  const skipBtn = $('skipBtn');
  if (skipBtn) skipBtn.onclick = () => socket.emit('skip');
  const endWordBtn = $('endWordBtn');
  if (endWordBtn) endWordBtn.onclick = () => socket.emit('endLastWord');
  const settingsBtn = $('settingsBtn');
  if (settingsBtn) settingsBtn.onclick = openSettings;
}

// ───────── XONA SOZLAMALARI ─────────
let draft = null;
function openSettings() {
  draft = JSON.parse(JSON.stringify(state.settings));
  renderSettings();
  $('settingsModal').classList.remove('hidden');
}
function renderSettings() {
  const o = state.options;
  const n = Math.max(state.minPlayers, state.players.length);
  const select = (key, label) => `<label class="set-row"><span>${label}</span>
    <select data-key="${key}">${o[key].map((v) => `<option value="${v}" ${draft[key] === v ? 'selected' : ''}>${TIME_LABEL(v)}</option>`).join('')}</select></label>`;
  const check = (key, label) => `<label class="set-row"><span>${label}</span>
    <input type="checkbox" data-key="${key}" ${draft[key] ? 'checked' : ''}></label>`;

  let rolesHtml = '';
  if (draft.mode === 'custom') {
    const used = state.customRoles.reduce((s, r) => s + draft.custom[r], 0);
    rolesHtml = `<div class="role-grid">${state.customRoles.map((r) => {
      const R = ROLES[r];
      const ctrl = r === 'mafia'
        ? `<span class="stepper"><button type="button" data-step="-1">−</button><b>${draft.custom.mafia}</b><button type="button" data-step="1">+</button></span>`
        : `<input type="checkbox" data-role="${r}" ${draft.custom[r] ? 'checked' : ''}>`;
      return `<label class="role-opt" title="${esc(R.desc)}"><span>${R.icon} ${R.name}</span>${ctrl}</label>`;
    }).join('')}</div>
    <p class="set-note">${ROLES.citizen.icon} Tinch aholi: ${Math.max(0, n - used)} ta (qolgan o'rinlar) · ${n} o'yinchi uchun</p>`;
  } else {
    rolesHtml = '<p class="set-note">O\'yinchilar soniga qarab rollar avtomatik qo\'shiladi: 5 kishida Don, Komissar va Shifokor; 6 dan Mashuqa, 7 dan Mafia, 8 dan Manyak, 9 dan Daydi, 10 dan yana Mafia, 11 dan Advokat, 12 dan Suid, 14 dan yana Mafia, 15 dan Snayper.</p>';
  }

  $('settingsBody').innerHTML = `
    <h3>🎭 Rollar</h3>
    <div class="seg">
      <button type="button" data-mode="auto" class="${draft.mode === 'auto' ? 'on' : ''}">Avtomatik</button>
      <button type="button" data-mode="custom" class="${draft.mode === 'custom' ? 'on' : ''}">Qo'lda tanlash</button>
    </div>
    ${rolesHtml}
    <h3>⏱ Vaqtlar</h3>
    ${select('dayTime', '🗣️ Muhokama')}
    ${select('nightTime', '🌙 Har bir rol uchun tunda')}
    ${select('voteTime', '🗳️ Ovoz berish')}
    <h3>📜 Qoidalar</h3>
    ${check('revealRoles', "👁️ O'lganlarning roli ochilsin")}
    ${check('lastWord', "🕯️ O'lganlarga oxirgi so'z (20 s)")}`;
}
$('settingsBody').addEventListener('click', (e) => {
  const mode = e.target.closest('[data-mode]');
  if (mode) { draft.mode = mode.dataset.mode; renderSettings(); return; }
  const step = e.target.closest('[data-step]');
  if (step) {
    e.preventDefault();
    draft.custom.mafia = Math.max(0, Math.min(5, draft.custom.mafia + Number(step.dataset.step)));
    renderSettings();
  }
});
$('settingsBody').addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.role) { draft.custom[el.dataset.role] = el.checked ? 1 : 0; renderSettings(); }
  else if (el.dataset.key) draft[el.dataset.key] = el.type === 'checkbox' ? el.checked : Number(el.value);
});
$('settingsSave').onclick = () => {
  socket.emit('settings', draft);
  $('settingsModal').classList.add('hidden');
  toast('Sozlamalar saqlandi');
};
$('settingsCancel').onclick = () => $('settingsModal').classList.add('hidden');

// ───────── rol kartasi ─────────
function renderRoleCard() {
  const { me } = state;
  const card = $('myRole');
  const role = me.role && ROLES[me.role];
  if (!role) {
    card.style.removeProperty('--team');
    setHTML(card, '<div class="icon">🪑</div><div><b>Rol hali yo\'q</b><small>O\'yin boshlanganda rolingizni olasiz</small></div>');
    card.onclick = null;
    return;
  }
  card.style.setProperty('--team', TEAM_COLOR[role.team]);
  setHTML(card, `<div class="icon">${role.icon}</div>
    <div><b>${role.name}${me.alive ? '' : ' — 💀'}</b><small>${TEAMS[role.team]} · batafsil uchun bosing</small></div>`);
  card.onclick = () => openRoleModal(true);
}

/** flipped=false — karta yopiq holda chiqadi, bosganda ag'dariladi */
function openRoleModal(flipped) {
  const role = ROLES[state.me.role];
  if (!role) return;
  $('roleFront').style.setProperty('--team', TEAM_COLOR[role.team]);
  $('roleModalIcon').textContent = role.icon;
  $('roleModalName').textContent = role.name;
  $('roleModalDesc').textContent = role.desc;
  $('roleModalTeam').textContent = TEAMS[role.team];
  $('flipCard').classList.toggle('flipped', !!flipped);
  $('roleModal').classList.remove('hidden');
}
$('flipCard').onclick = (e) => {
  if (e.target.closest('#roleModalClose')) return;
  if (!$('flipCard').classList.contains('flipped')) {
    $('flipCard').classList.add('flipped');
    Sound.play('wake');
  }
};
$('roleModalClose').onclick = () => $('roleModal').classList.add('hidden');

let renderedLogId = 0;
function renderLog() {
  const list = $('log');
  const last = state.log.length ? state.log[state.log.length - 1].id : 0;
  if (last === renderedLogId && list.children.length) return;
  const added = state.log.filter((l) => l.id > renderedLogId).length;
  if (renderedLogId && added && isMobile() && activeTab !== 'log') { unread.log += added; drawDots(); }
  renderedLogId = last;
  list.innerHTML = state.log.map((l) => `<li class="${l.kind}">${esc(l.text)}</li>`).join('');
  list.scrollTop = list.scrollHeight;
}

// ───────── taymer ─────────
let lastTick = null;
let timerTotal = 1;
let timerEndsAt = null;
setInterval(() => {
  const ring = $('timerRing');
  if (!state || !state.endsAt) {
    $('timer').textContent = '';
    $('nightTimer').textContent = '';
    ring.classList.add('idle');
    return;
  }
  const left = Math.max(0, (state.endsAt - (Date.now() + clockOffset)) / 1000);
  if (timerEndsAt !== state.endsAt) { timerEndsAt = state.endsAt; timerTotal = Math.max(1, left); }
  const sec = Math.ceil(left);
  const txt = sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec);
  ring.classList.remove('idle');
  ring.style.setProperty('--p', Math.min(1, left / timerTotal).toFixed(3));
  $('timer').textContent = txt;
  ring.classList.toggle('low', sec <= 5);
  // Oxirgi 5 soniyada taqillash — faqat harakat qilishi kerak bo'lganlarga
  const mustAct = state.me.canAct || (state.phase === 'vote' && state.me.alive) || state.me.lastWord;
  if (sec !== lastTick && sec > 0 && sec <= 5 && mustAct) Sound.play('tick');
  lastTick = sec;
  $('nightTimer').textContent = state.phase === 'night' ? txt : '';
}, 200);

window.addEventListener('resize', () => {
  if (!state) return;
  renderSeats();
  if (!isMobile()) document.querySelectorAll('.pane').forEach((p) => p.classList.add('active'));
  else setTab(activeTab);
});
if (!isMobile()) document.querySelectorAll('.pane').forEach((p) => p.classList.add('active'));
