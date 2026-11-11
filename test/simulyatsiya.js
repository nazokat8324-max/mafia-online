'use strict';
/* Botlar bilan to'liq o'yinlarni simulyatsiya qiladi (npm test).
   Server tezlashtirilgan rejimda ishga tushiriladi va har bir o'yin
   g'alaba bilan tugashi hamda maxfiy ma'lumot sizib chiqmasligi tekshiriladi. */
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const { ROLES } = require('../game');

const PORT = 3999;
const URL = `http://localhost:${PORT}`;

const ALL_ROLES = { don: 1, mafia: 2, lawyer: 1, commissar: 1, doctor: 1, lover: 1, bum: 1, sniper: 1, maniac: 1, jester: 1 };
const SCENARIOS = [
  { n: 5, title: 'avto' },
  { n: 6, title: 'avto' },
  { n: 8, title: 'avto, oxirgi so\'zsiz', settings: { lastWord: false } },
  { n: 11, title: 'avto' },
  { n: 14, title: 'avto, rollar yashirin', settings: { revealRoles: false } },
  { n: 16, title: 'avto' },
  { n: 13, title: "qo'lda: barcha rollar", settings: { mode: 'custom', custom: ALL_ROLES } },
  { n: 13, title: "qo'lda, yashirin", settings: { mode: 'custom', custom: ALL_ROLES, revealRoles: false, dayTime: 60, voteTime: 20, nightTime: 15 } },
];

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, MAFIA_SPEED: '40' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const fail = (msg) => { console.error('❌', msg); server.kill(); process.exit(1); };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const team = (r) => r && ROLES[r].team;

const seen = { roles: new Set(), skip: 0, lastWord: 0, bumNote: 0, jesterWin: 0 };

function bot(name, ctx) {
  const s = io(URL, { forceNew: true, transports: ['websocket'] });
  s.botName = name;
  s.on('state', (st) => {
    s.last = st;
    const me = st.me;
    if (me.role) seen.roles.add(me.role);
    // Maxfiylik: begonaning roli ko'rinmasligi kerak
    if (st.phase !== 'gameover') {
      for (const p of st.players) {
        if (p.id === me.id || !p.role) continue;
        const teammate = team(me.role) === 'mafia' && team(p.role) === 'mafia';
        if (teammate) continue;
        if (p.alive) fail(`${name} (${me.role}) tirik ${p.name} rolini ko'rdi: ${p.role}`);
        if (!st.settings.revealRoles) fail(`${name} yashirin rejimda o'lgan ${p.name} rolini ko'rdi`);
      }
    }
    if (st.phase === 'night' && !me.awake && me.targets.length) fail(`${name} uxlab turib tanlay oladi`);
    if (st.phase === 'lastWord' && !st.settings.lastWord) fail("Oxirgi so'z o'chiq, lekin faza boshlandi");
    if (st.log.some((l) => l.to && l.text.startsWith('🧥 Tunda'))) seen.bumNote++;

    // Tasodifiy harakat
    if (me.canSkip && Math.random() < 0.5) { seen.skip++; s.emit('skip'); return; }
    if (me.targets.length && !me.myTarget && Math.random() < 0.9) {
      setTimeout(() => s.emit(st.phase === 'vote' ? 'vote' : 'act', pick(me.targets)), 5);
    }
    if (me.lastWord) {
      seen.lastWord++;
      s.emit('chat', 'Men begunohman!');
      if (Math.random() < 0.5) s.emit('endLastWord');
    }
    if (st.phase === 'day' && me.alive && Math.random() < 0.3) s.emit('ready');
    if (Math.random() < 0.05 && me.chat) s.emit('chat', 'salom');
  });
  return s;
}

const emit = (s, ev, data) => new Promise((r) => (data === undefined ? s.emit(ev, r) : s.emit(ev, data, r)));
const waitState = (s, pred) => new Promise((r) => {
  const iv = setInterval(() => { if (s.last && pred(s.last)) { clearInterval(iv); r(s.last); } }, 20);
});

async function playGame({ n, title, settings }) {
  const bots = Array.from({ length: n }, (_, i) => bot(`Bot${i + 1}`));
  await Promise.all(bots.map((b) => new Promise((r) => b.on('connect', r))));
  const host = bots[0];
  const { code } = await emit(host, 'create', { name: host.botName });
  for (const b of bots.slice(1)) {
    const res = await emit(b, 'join', { name: b.botName, code });
    if (res.error) fail(res.error);
  }
  if (settings) {
    // Xost bo'lmagan o'yinchi sozlamani o'zgartira olmasligi kerak
    bots[1].emit('settings', { voteTime: 60 });
    host.emit('settings', settings);
    await waitState(host, (st) => st.settings.mode === (settings.mode || 'auto') &&
      st.settings.revealRoles === (settings.revealRoles ?? true));
    if (!settings.voteTime && host.last.settings.voteTime === 60) fail("Xost bo'lmagan o'yinchi sozlamani o'zgartirdi");
  }
  const startRes = await emit(host, 'start');
  if (startRes.error) fail(startRes.error);

  const t0 = Date.now();
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (host.last && host.last.phase === 'gameover') { clearInterval(iv); resolve(); }
      if (Date.now() - t0 > 180000) fail(`${n} kishilik o'yin tugamadi (faza: ${host.last && host.last.phase})`);
    }, 50);
  });
  const st = host.last;
  const win = st.log.find((l) => l.kind === 'win');
  if (st.winner === 'jester') seen.jesterWin++;
  const comp = Object.entries(st.composition).map(([r, c]) => `${ROLES[r].icon}${c > 1 ? c : ''}`).join(' ');
  console.log(`✅ ${n} kishi (${title}), ${st.round} tun — ${win.text}\n   ${comp}`);
  bots.forEach((b) => b.close());
}

async function checkValidation() {
  const bots = Array.from({ length: 5 }, (_, i) => bot(`V${i}`));
  await Promise.all(bots.map((b) => new Promise((r) => b.on('connect', r))));
  const { code } = await emit(bots[0], 'create', { name: 'V0' });
  for (const b of bots.slice(1)) await emit(b, 'join', { name: b.botName, code });
  bots[0].emit('settings', { mode: 'custom', custom: ALL_ROLES });
  await waitState(bots[0], (st) => st.settings.mode === 'custom');
  const res = await emit(bots[0], 'start');
  if (!res.error) fail("5 kishiga 11 ta rol bilan o'yin boshlanib ketdi");
  console.log(`✅ Noto'g'ri sozlama rad etildi: "${res.error}"`);
  bots.forEach((b) => b.close());
}

server.stdout.once('data', async () => {
  try {
    await checkValidation();
    for (const sc of SCENARIOS) await playGame(sc);
    const missing = Object.keys(ROLES).filter((r) => !seen.roles.has(r));
    if (missing.length) fail(`Bu rollar hech qachon chiqmadi: ${missing.join(', ')}`);
    if (!seen.lastWord) fail("Oxirgi so'z hech qachon ishlamadi");
    console.log(`\nBarcha ${seen.roles.size} rol o'ynaldi · oxirgi so'z: ${seen.lastWord} marta · Snayper o'q uzmadi: ${seen.skip} marta · Daydi xabarlari: ${seen.bumNote > 0 ? 'bor' : "yo'q"} · Suid g'alabasi: ${seen.jesterWin}`);
    console.log('Hammasi joyida ✔');
    server.kill();
    process.exit(0);
  } catch (e) { fail(e.stack); }
});
