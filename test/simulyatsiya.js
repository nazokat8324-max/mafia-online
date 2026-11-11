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

const ALL_ROLES = { don: 1, mafia: 2, lawyer: 1, commissar: 1, doctor: 1, lover: 1, bum: 1, sniper: 1, guard: 1, kamikadze: 1, wizard: 1, maniac: 1, jester: 1 };
const SCENARIOS = [
  { n: 5, title: 'avto' },
  { n: 6, title: "avto, o'zini oqlashsiz", settings: { defense: false } },
  { n: 8, title: 'avto, oxirgi so\'zsiz', settings: { lastWord: false } },
  { n: 11, title: 'avto' },
  { n: 14, title: 'avto, rollar yashirin', settings: { revealRoles: false } },
  { n: 16, title: 'avto' },
  { n: 16, title: "qo'lda: barcha rollar", settings: { mode: 'custom', custom: ALL_ROLES } },
  { n: 16, title: "qo'lda, yashirin", settings: { mode: 'custom', custom: ALL_ROLES, revealRoles: false, dayTime: 60, voteTime: 20, nightTime: 15 } },
];

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, MAFIA_SPEED: '40' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const fail = (msg) => { console.error('❌', msg); server.kill(); process.exit(1); };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const team = (r) => r && ROLES[r].team;

const seen = { reactions: 0, roles: new Set(), skip: 0, lastWord: 0, bumNote: 0, jesterWin: 0, defense: 0, verdict: 0, acquitted: 0, history: 0 };

function bot(name, ctx) {
  const s = io(URL, { forceNew: true, transports: ['websocket'] });
  s.botName = name;
  s.on('reaction', (r) => {
    seen.reactions++;
    if (s.last && ['night', 'roles'].includes(s.last.phase)) fail(`${name} tunda reaksiya oldi: ${r.e}`);
  });
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
    // O'yin xulosasi o'yin tugamaguncha hech kimga yuborilmasligi kerak
    if (st.phase !== 'gameover' && st.history) fail(`${name} o'yin paytida xulosani ko'rdi`);
    if (st.phase === 'defense' && !st.settings.defense) fail("O'zini oqlash o'chiq, lekin faza boshlandi");
    if (st.phase === 'defense' && st.me.chat && !st.me.defense) fail(`${name} birovning himoyasi paytida gapira oladi`);
    if (st.log.some((l) => l.text.startsWith('🕊️'))) seen.acquitted = Math.max(seen.acquitted, 1);

    // Tasodifiy harakat
    if (me.canSkip && Math.random() < 0.5) { seen.skip++; s.emit('skip'); return; }
    if (me.targets.length && !me.myTarget && Math.random() < 0.9) {
      setTimeout(() => s.emit(st.phase === 'vote' ? 'vote' : 'act', pick(me.targets)), 5);
    }
    if (me.defense) {
      seen.defense++;
      s.emit('chat', "Men tinch aholiman, ishoning!");
      if (Math.random() < 0.6) setTimeout(() => s.emit('endDefense'), 20);
    }
    if (me.canVerdict && me.myVerdict === null && Math.random() < 0.9) {
      seen.verdict++;
      setTimeout(() => s.emit('verdict', Math.random() < 0.55), 10);
    }
    if (me.lastWord) {
      seen.lastWord++;
      s.emit('chat', 'Men begunohman!');
      if (Math.random() < 0.5) s.emit('endLastWord');
    }
    // Haqiqiy odam kabi: tugmani bir marta bosadi (avval bu yerda "ko'chki" hosil bo'lardi)
    if (st.phase === 'day' && me.alive && !s.readySent && Math.random() < 0.3) { s.readySent = true; s.emit('ready'); }
    if (st.phase !== 'day') s.readySent = false;
    if (Math.random() < 0.05 && me.chat) s.emit('chat', 'salom');
    if (Math.random() < 0.04 && st.reactions) s.emit('react', pick(st.reactions)); // tunda ham urinadi — server rad etishi kerak
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
  if (!Array.isArray(st.history) || !st.history.some((h) => h.type === 'night')) fail("O'yin oxirida xulosa (history) yo'q");
  const ids = new Set(st.players.map((p) => p.id));
  for (const h of st.history) {
    for (const e of h.events || []) {
      for (const id of [].concat(e.by, e.t).filter(Boolean)) if (!ids.has(id)) fail("Xulosada noma'lum o'yinchi: " + id);
    }
  }
  seen.history++;
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

async function checkHostControls() {
  const bots = Array.from({ length: 4 }, (_, i) => bot(`H${i}`));
  await Promise.all(bots.map((b) => new Promise((r) => b.on('connect', r))));
  const [host, a, b2, c] = bots;
  const { code } = await emit(host, 'create', { name: 'H0' });
  await emit(a, 'join', { name: 'H1', code });
  // parol qo'yish
  host.emit('settings', { password: 'sir123' });
  await waitState(host, (st) => st.hasPassword && st.password === 'sir123');
  await waitState(a, (st) => st.hasPassword);
  if (a.last.password !== undefined) fail("Xost bo'lmagan o'yinchi parolni ko'rdi");
  let r = await emit(b2, 'join', { name: 'H2', code });
  if (!r.needPassword) fail("Parolsiz qo'shilib ketdi");
  r = await emit(b2, 'join', { name: 'H2', code, password: 'xato' });
  if (!r.error) fail("Noto'g'ri parol bilan qo'shilib ketdi");
  r = await emit(b2, 'join', { name: 'H2', code, password: 'sir123' });
  if (r.error) fail("To'g'ri parol bilan qo'shila olmadi: " + r.error);
  // xost bo'lmagan chiqara olmaydi
  const idOf = (n) => host.last.players.find((p) => p.name === n).id;
  await waitState(host, (st) => st.players.length === 3);
  a.emit('kick', idOf('H2'));
  await new Promise((res) => setTimeout(res, 300));
  if (host.last.players.length !== 3) fail("Xost bo'lmagan o'yinchi boshqani chiqardi");
  // xost chiqaradi
  const kicked = new Promise((res) => b2.once('kicked', res));
  host.emit('kick', idOf('H2'));
  await kicked;
  await waitState(host, (st) => st.players.length === 2);
  r = await emit(c, 'join', { name: 'H2', code, password: 'sir123' });
  if (!r.error) fail("Chiqarilgan ism bilan qayta kirib oldi");
  // chiqarilgan socket endi hech narsa qila olmaydi
  b2.emit('chat', 'salom');
  // xostlikni topshirish
  host.emit('transferHost', idOf('H1'));
  await waitState(a, (st) => st.hostId === st.me.id);
  host.emit('kick', idOf('H1'));
  await new Promise((res) => setTimeout(res, 300));
  if (host.last.players.length !== 2) fail("Sobiq xost hali ham chiqara oladi");
  console.log("✅ Xona egasi: parol, chiqarish, qayta kira olmaslik va xostlikni topshirish ishlaydi");
  bots.forEach((b) => b.close());
}

server.stdout.once('data', async () => {
  try {
    await checkHostControls();
    await checkValidation();
    for (const sc of SCENARIOS) await playGame(sc);
    const missing = Object.keys(ROLES).filter((r) => !seen.roles.has(r));
    if (missing.length) fail(`Bu rollar hech qachon chiqmadi: ${missing.join(', ')}`);
    if (!seen.lastWord) fail("Oxirgi so'z hech qachon ishlamadi");
    if (!seen.defense || !seen.verdict) fail("O'zini oqlash / yakuniy ovoz hech qachon ishlamadi");
    if (!seen.reactions) fail('Reaksiyalar hech qachon yetib bormadi');
    console.log(`Reaksiyalar: ${seen.reactions} ta yetkazildi (tunda — 0)`);
    console.log(`O'zini oqlash: ${seen.defense} marta · yakuniy ovozlar: ${seen.verdict} · oqlanganlar bor: ${seen.acquitted ? 'ha' : "yo'q"} · xulosalar: ${seen.history}`);
    console.log(`\nBarcha ${seen.roles.size} rol o'ynaldi · oxirgi so'z: ${seen.lastWord} marta · Snayper o'q uzmadi: ${seen.skip} marta · Daydi xabarlari: ${seen.bumNote > 0 ? 'bor' : "yo'q"} · Suid g'alabasi: ${seen.jesterWin}`);
    console.log('Hammasi joyida ✔');
    server.kill();
    process.exit(0);
  } catch (e) { fail(e.stack); }
});
