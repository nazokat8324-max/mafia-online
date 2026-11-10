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
  roles: '🃏 Rollar tarqatilmoqda',
  night: '🌙 Tun',
  morning: '☀️ Tong',
  day: '🗣️ Kun — muhokama',
  vote: '🗳️ Ovoz berish',
  voteResult: '⚖️ Hukm',
  gameover: "🏁 O'yin tugadi",
};
const TEAMS = {
  town: '🟢 Tinch aholi jamoasi',
  mafia: '🔴 Mafia jamoasi',
  maniac: '⚫ Yolg\'iz — faqat o\'zingiz uchun',
};

// ───────── sessiya (sahifa yangilanganda qaytish uchun) ─────────
const SESSION_KEY = 'mafia-session';
function saveSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} }
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } }
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} }

// ───────── yordamchilar ─────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function colorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 38%)`;
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
}

// ───────── bosh sahifa ─────────
try { $('nameInput').value = localStorage.getItem('mafia-name') || ''; } catch {}
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('codeInput').value = urlRoom.toUpperCase();

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
$('createBtn').onclick = () => socket.emit('create', { name: getName() }, entered);
$('joinBtn').onclick = () => socket.emit('join', { name: getName(), code: $('codeInput').value }, entered);
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

$('copyBtn').onclick = async () => {
  const link = `${location.origin}/?room=${state.code}`;
  try { await navigator.clipboard.writeText(link); toast('Havola nusxalandi — do\'stlaringizga yuboring'); }
  catch { prompt('Havolani nusxalang:', link); }
};
$('leaveBtn').onclick = () => {
  const playing = state && !['lobby', 'gameover'].includes(state.phase) && state.me.alive;
  if (playing && !confirm("O'yindan chiqsangiz, siz o'lgan hisoblanasiz. Chiqasizmi?")) return;
  socket.emit('leave');
  clearSession();
  state = null;
  history.replaceState(null, '', '/');
  show('home');
};

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
  state = s;
  render();
});

socket.on('chatHistory', (list) => {
  $('chatList').innerHTML = '';
  list.forEach(addChat);
});
socket.on('chat', addChat);

function addChat(m) {
  const li = document.createElement('li');
  if (m.channel === 'mafia') li.className = 'mafia';
  li.innerHTML = `${m.channel === 'mafia' ? '🔫 ' : ''}<b>${esc(m.from)}:</b> ${esc(m.text)}`;
  const list = $('chatList');
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
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
  if (!state.me.targets.includes(id)) return;
  socket.emit(state.phase === 'vote' ? 'vote' : 'act', id);
});

// ───────── CHIZISH ─────────
function render() {
  if (!state) return;
  const { me, phase } = state;
  const isNight = phase === 'night';

  document.body.classList.toggle('night', isNight);
  $('roomCode').textContent = state.code;
  $('phaseLabel').textContent = PHASES[phase] + (state.round && phase !== 'lobby' ? ` · ${state.round}` : '');

  // Tun: uyg'oq bo'lmaganlar uchun ekran qorong'u
  $('nightOverlay').classList.toggle('hidden', !isNight || me.awake);
  $('nightStep').textContent = isNight && state.step ? state.step.title + '...' : '';
  const banner = $('awakeBanner');
  banner.classList.toggle('hidden', !me.awake);
  if (me.awake) {
    banner.textContent = me.blocked
      ? `💋 ${state.step.title}, lekin Mashuqa sizning oldingizda — bu tun harakat qila olmaysiz`
      : `👁️ Siz uyg'oqsiz! ${me.prompt}`;
  }

  renderSeats();
  renderCenter();
  renderRoleCard();
  renderLog();

  // Chat holati
  const chatInput = $('chatInput');
  chatInput.disabled = !me.chat;
  $('chatTitle').textContent = me.chat === 'mafia' ? '🔫 Mafia suhbati (yashirin)' : 'Suhbat';
  chatInput.placeholder = me.chat
    ? (me.chat === 'mafia' ? 'Faqat mafiya ko\'radi...' : 'Xabar yozing...')
    : (me.alive ? 'Hozir gapirish mumkin emas' : "O'liklar gapirmaydi...");

  // Rol kartasi
  if (phase === 'roles' && me.role && !roleShownForGame) {
    roleShownForGame = true;
    openRoleModal();
  }
  if (phase !== lastPhase && phase !== 'roles' && lastPhase === 'roles') $('roleModal').classList.add('hidden');
  lastPhase = phase;
}

function seatPositions(n) {
  // Ellips bo'ylab joylashuv, 0-o'rin pastda (o'zingizga yaqin)
  const wide = $('seats').clientWidth / Math.max(1, $('seats').clientHeight);
  const rx = wide > 1.1 ? 43 : 40;
  const ry = wide > 1.1 ? 41 : 42;
  return Array.from({ length: n }, (_, i) => {
    const a = Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
  });
}

function renderSeats() {
  const { players, me, phase } = state;
  // O'zimiz doim pastda o'tirishimiz uchun o'rinlarni aylantiramiz
  const myIndex = Math.max(0, players.findIndex((p) => p.id === me.id));
  const ordered = players.map((_, i) => players[(i + myIndex) % players.length]);
  const pos = seatPositions(ordered.length);
  const meMafia = me.role && ROLES[me.role] && ROLES[me.role].team === 'mafia';

  $('seats').innerHTML = ordered.map((p, i) => {
    const role = p.role && ROLES[p.role];
    const cls = ['seat'];
    if (p.id === me.id) cls.push('me');
    if (!p.alive) cls.push('dead');
    if (!p.connected) cls.push('offline');
    if (meMafia && role && role.team === 'mafia' && p.id !== me.id) cls.push('teammate');
    if (me.targets.includes(p.id)) cls.push('targetable');
    if (me.myTarget === p.id) cls.push('selected');

    let tag = '';
    if (role) tag = `${role.icon} ${role.name}`;
    else if (p.known === 'mafia') tag = '🔴 Mafia!';
    else if (p.known === 'clean') tag = '🟢 Toza';
    else if (p.known === 'commissar') tag = '🔴 Komissar!';
    else if (p.known === 'notcommissar') tag = '⚪ Komissar emas';
    if (!p.connected) tag += ' 📴';

    const inner = role && (p.id === me.id || !p.alive || phase === 'gameover') ? role.icon : esc(p.name[0].toUpperCase());
    let badges = '';
    if (p.votes) badges += `<span class="badge">${p.votes}</span>`;
    if (p.ready) badges += '<span class="badge ok">✓</span>';
    if (p.id === state.hostId && phase === 'lobby') badges += '<span class="badge left">👑</span>';

    let picks = '';
    if (p.mafiaPicks && p.mafiaPicks.length) picks = `<div class="picks">🎯 ${p.mafiaPicks.map(esc).join(', ')}</div>`;

    let voted = '';
    if (p.votedFor) {
      const t = players.find((q) => q.id === p.votedFor);
      if (t) voted = `<div class="picks">→ ${esc(t.name)}</div>`;
    }

    return `<div class="${cls.join(' ')}" data-id="${p.id}" style="left:${pos[i].x}%;top:${pos[i].y}%">
      <div class="avatar" style="background:${colorFor(p.name)}">${inner}${badges}</div>
      <div class="name">${esc(p.name)}${p.id === me.id ? ' (siz)' : ''}</div>
      <div class="tag">${tag}</div>${picks}${voted}
    </div>`;
  }).join('');
}

function compositionChips() {
  return Object.entries(state.composition)
    .map(([r, n]) => `<span class="chip">${ROLES[r] ? ROLES[r].icon + ' ' + ROLES[r].name : r}${n > 1 ? ' ×' + n : ''}</span>`)
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
    html = `<h2>Stol atrofida ${n} kishi</h2>
      <p>${enough ? "O'yinni boshlash mumkin!" : `Yana kamida ${state.minPlayers - n} kishi kerak`}</p>
      <div class="chips">${compositionChips()}</div>
      ${isHost
        ? `<button class="btn primary" id="startBtn" ${enough ? '' : 'disabled'}>O'yinni boshlash</button>`
        : '<p>👑 Xona egasi o\'yinni boshlashini kuting</p>'}`;
  } else if (phase === 'roles') {
    html = `<h2>🃏 Rollar tarqatildi</h2><p>Kartangizni hech kimga ko'rsatmang!</p>
      <div class="chips">${compositionChips()}</div>`;
  } else if (phase === 'night') {
    html = me.awake
      ? `<h2>${esc(state.step.title)}</h2><p>${me.blocked ? 'Bu tun siz band ekansiz...' : 'Nishonni tanlash uchun o\'yinchini bosing'}</p>`
      : `<h2>🌙 Tun</h2>`;
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
    html = `<h2>🏁 O'yin tugadi</h2><p>${w ? esc(w.text) : ''}</p>
      ${isHost ? '<button class="btn primary" id="againBtn">Yana o\'ynash</button>' : '<p>Xona egasi yangi o\'yin boshlashi mumkin</p>'}`;
  }

  $('center').innerHTML = html;
  const startBtn = $('startBtn');
  if (startBtn) startBtn.onclick = () => socket.emit('start', (r) => r && r.error && toast(r.error));
  const readyBtn = $('readyBtn');
  if (readyBtn) readyBtn.onclick = () => socket.emit('ready');
  const againBtn = $('againBtn');
  if (againBtn) againBtn.onclick = () => socket.emit('lobby');
}

function renderRoleCard() {
  const { me } = state;
  const card = $('myRole');
  const role = me.role && ROLES[me.role];
  if (!role) {
    card.innerHTML = '<div class="icon">🪑</div><div><b>Rol hali yo\'q</b><small>O\'yin boshlanganda rolingizni olasiz</small></div>';
    card.onclick = null;
    return;
  }
  card.innerHTML = `<div class="icon">${role.icon}</div>
    <div><b>${role.name}${me.alive ? '' : ' — 💀 o\'ldingiz'}</b><small>${TEAMS[role.team]} · batafsil uchun bosing</small></div>`;
  card.onclick = openRoleModal;
}

function openRoleModal() {
  const role = ROLES[state.me.role];
  if (!role) return;
  $('roleModalIcon').textContent = role.icon;
  $('roleModalName').textContent = role.name;
  $('roleModalDesc').textContent = role.desc;
  $('roleModalTeam').textContent = TEAMS[role.team];
  $('roleModal').classList.remove('hidden');
}
$('roleModalClose').onclick = () => $('roleModal').classList.add('hidden');

let renderedLogId = 0;
function renderLog() {
  const list = $('log');
  const last = state.log.length ? state.log[state.log.length - 1].id : 0;
  if (last === renderedLogId && list.children.length) return;
  renderedLogId = last;
  list.innerHTML = state.log.map((l) => `<li class="${l.kind}">${esc(l.text)}</li>`).join('');
  list.scrollTop = list.scrollHeight;
}

// ───────── taymer ─────────
setInterval(() => {
  if (!state || !state.endsAt) { $('timer').textContent = ''; $('nightTimer').textContent = ''; return; }
  const left = Math.max(0, Math.ceil((state.endsAt - (Date.now() + clockOffset)) / 1000));
  const txt = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('timer').textContent = '⏱ ' + txt;
  $('timer').classList.toggle('low', left <= 5);
  $('nightTimer').textContent = state.phase === 'night' ? txt : '';
}, 250);

window.addEventListener('resize', () => state && renderSeats());
