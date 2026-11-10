'use strict';
/* Botlar bilan to'liq o'yinlarni simulyatsiya qiladi (npm test).
   Server tezlashtirilgan rejimda ishga tushiriladi va har bir o'yin
   g'alaba bilan tugashi hamda maxfiy ma'lumot sizib chiqmasligi tekshiriladi. */
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
const SIZES = [5, 6, 8, 11, 14];

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, MAFIA_SPEED: '40' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const fail = (msg) => { console.error('❌', msg); server.kill(); process.exit(1); };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const TEAM = { citizen: 'town', commissar: 'town', doctor: 'town', lover: 'town', mafia: 'mafia', don: 'mafia', maniac: 'maniac' };

function bot(name) {
  const s = io(URL, { forceNew: true, transports: ['websocket'] });
  s.botName = name;
  s.on('state', (st) => {
    s.last = st;
    const me = st.me;
    // Maxfiylik: tirik begonaning roli ko'rinmasligi kerak
    if (st.phase !== 'gameover') {
      for (const p of st.players) {
        if (p.id === me.id || !p.alive || !p.role) continue;
        const ok = TEAM[me.role] === 'mafia' && TEAM[p.role] === 'mafia';
        if (!ok) fail(`${name} (${me.role}) ${p.name} rolini ko'rdi: ${p.role}`);
      }
    }
    if (st.phase === 'night' && !me.awake && me.targets.length) fail(`${name} uxlab turib tanlay oladi`);
    // Tasodifiy harakat
    if (me.targets.length && !me.myTarget && Math.random() < 0.9) {
      setTimeout(() => s.emit(st.phase === 'vote' ? 'vote' : 'act', pick(me.targets)), 5);
    }
    if (st.phase === 'day' && me.alive && Math.random() < 0.3) s.emit('ready');
    if (Math.random() < 0.05 && me.chat) s.emit('chat', 'salom');
  });
  return s;
}

const emit = (s, ev, data) => new Promise((r) => (data === undefined ? s.emit(ev, r) : s.emit(ev, data, r)));

async function playGame(n) {
  const bots = Array.from({ length: n }, (_, i) => bot(`Bot${i + 1}`));
  await Promise.all(bots.map((b) => new Promise((r) => b.on('connect', r))));
  const host = bots[0];
  const { code } = await emit(host, 'create', { name: host.botName });
  for (const b of bots.slice(1)) {
    const res = await emit(b, 'join', { name: b.botName, code });
    if (res.error) fail(res.error);
  }
  const startRes = await emit(host, 'start');
  if (startRes.error) fail(startRes.error);

  const t0 = Date.now();
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (host.last && host.last.phase === 'gameover') { clearInterval(iv); resolve(); }
      if (Date.now() - t0 > 60000) fail(`${n} kishilik o'yin tugamadi (faza: ${host.last && host.last.phase})`);
    }, 50);
  });
  const st = host.last;
  const win = st.log.find((l) => l.kind === 'win');
  const roles = st.players.map((p) => p.role).sort().join(',');
  console.log(`✅ ${n} o'yinchi, ${st.round} tun — ${win.text}\n   rollar: ${roles}`);
  bots.forEach((b) => b.close());
}

server.stdout.once('data', async () => {
  try {
    for (const n of SIZES) await playGame(n);
    console.log('\nHammasi joyida ✔');
    server.kill();
    process.exit(0);
  } catch (e) { fail(e.stack); }
});
