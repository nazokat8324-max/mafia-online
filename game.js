'use strict';
/*
 * MAFIA — o'yin mantig'i (serverda ishlaydi).
 * Barcha qarorlar shu yerda qabul qilinadi; mijozlar (brauzerlar) faqat
 * o'zlariga ruxsat etilgan ma'lumotni ko'radi (viewFor funksiyasiga qarang).
 */
const crypto = require('crypto');

// Test uchun vaqtni tezlashtirish: MAFIA_SPEED=20 node server.js
const SPEED = Number(process.env.MAFIA_SPEED) || 1;
const ms = (s) => Math.max(150, Math.round((s * 1000) / SPEED));

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 16;

// O'zgarmas vaqtlar (soniya). Muhokama, tun va ovoz vaqtlari — xona sozlamalarida.
const TIME = {
  roles: 10,       // rolni ko'rish
  nightIntro: 4,   // "Shahar uxlamoqda..."
  morning: 7,      // tun natijalari e'loni
  voteResult: 6,   // ovoz natijasi
  lastWord: 20,    // oxirgi so'z
};

const ROLES = {
  citizen:   { name: 'Tinch aholi', team: 'town',   icon: '🧑', desc: "Maxsus qobiliyatingiz yo'q. Kunduzi muhokama qilib, mafiyani toping va unga qarshi ovoz bering." },
  don:       { name: 'Don',         team: 'mafia',  icon: '🎩', desc: "Mafiya boshlig'i. Qurbon bo'yicha oxirgi so'z sizniki. Keyin alohida uyg'onib, kim Komissar ekanini tekshirasiz." },
  mafia:     { name: 'Mafia',       team: 'mafia',  icon: '🔫', desc: "Tunda sheriklaringiz bilan uyg'onib, qurbonni tanlaysiz. Maqsad — shaharni egallash." },
  lawyer:    { name: 'Advokat',     team: 'mafia',  icon: '💼', desc: "Mafia jamoasidasiz, lekin o'ldirmaysiz. Har tun bir sherigingizni himoya qilasiz: Komissar uni tekshirsa, «mafia emas» deb ko'radi." },
  commissar: { name: 'Komissar',    team: 'town',   icon: '🕵️', desc: "Har tun bir kishini tekshirasiz: u mafiyami yoki yo'qmi — darhol bilib olasiz." },
  doctor:    { name: 'Shifokor',    team: 'town',   icon: '💉', desc: "Har tun bir kishini davolaysiz — hujumga uchrasa ham tirik qoladi. Bir odamni ketma-ket ikki tun davolay olmaysiz." },
  lover:     { name: 'Mashuqa',     team: 'town',   icon: '💋', desc: "Har tun bir kishining oldiga borasiz. U shu tun o'z qobiliyatidan foydalana olmaydi." },
  bum:       { name: 'Daydi',       team: 'town',   icon: '🧥', desc: "Har tun kimningdir uyi yonida tunaysiz va ertalab o'sha uyga tunda kim kelganini bilib olasiz." },
  sniper:    { name: 'Snayper',     team: 'town',   icon: '🎯', desc: "Butun o'yin davomida bitta o'qingiz bor. Istalgan tunda kimnidir otib tashlashingiz mumkin — adashmang!" },
  maniac:    { name: 'Manyak',      team: 'maniac', icon: '🔪', desc: "Yolg'iz o'ynaysiz. Har tun bir kishini o'ldirasiz. Oxirgi ikki tirik odamdan biri bo'lsangiz — g'olibsiz." },
  jester:    { name: 'Suid',        team: 'jester', icon: '🤡', desc: "Maqsadingiz — kunduzi ovoz bilan shahardan chiqarilish. Shunday bo'lsa, o'yin darhol tugaydi va siz yutasiz." },
};

// Tun tartibi: kim qachon uyg'onadi. time: tungi vaqtga qo'shimcha soniya.
const NIGHT_STEPS = [
  { key: 'lover',     roles: ['lover'],        title: "Mashuqa uyg'ondi",  prompt: 'Bu tun kimning oldiga borasiz?' },
  { key: 'mafia',     roles: ['mafia', 'don'], title: "Mafia uyg'ondi",    prompt: "Bu tun kimni o'ldirasiz?", extra: 10 },
  { key: 'don',       roles: ['don'],          title: "Don uyg'ondi",      prompt: 'Kim Komissar? Bir kishini tekshiring' },
  { key: 'lawyer',    roles: ['lawyer'],       title: "Advokat uyg'ondi",  prompt: 'Qaysi sherigingizni himoya qilasiz?' },
  { key: 'maniac',    roles: ['maniac'],       title: "Manyak uyg'ondi",   prompt: "Bu tun kimni o'ldirasiz?" },
  { key: 'sniper',    roles: ['sniper'],       title: "Snayper uyg'ondi",  prompt: "Yagona o'qingizni uzasizmi?", skippable: true },
  { key: 'bum',       roles: ['bum'],          title: "Daydi uyg'ondi",    prompt: 'Bu tun kimning uyi yonida tunaysiz?' },
  { key: 'doctor',    roles: ['doctor'],       title: "Shifokor uyg'ondi", prompt: 'Bu tun kimni davolaysiz?' },
  { key: 'commissar', roles: ['commissar'],    title: "Komissar uyg'ondi", prompt: 'Kimni tekshirasiz?' },
];

const WINNERS = {
  town:   "🏙️ Tinch aholi g'alaba qozondi! Shahar mafiyadan tozalandi.",
  mafia:  "🔫 Mafia g'alaba qozondi! Shahar endi ularniki.",
  maniac: "🔪 Manyak g'alaba qozondi! U oxirgi tirik qolganlardan biri.",
  jester: "🤡 Suid g'alaba qozondi! Shahar uni o'z qo'li bilan chiqarib yubordi.",
};

const isMafia = (p) => !!p && !!ROLES[p.role] && ROLES[p.role].team === 'mafia';

// ───────── ROLLAR TAQSIMOTI VA SOZLAMALAR ─────────

// Avtomatik rejim: o'yinchilar soniga qarab shu tartibda rollar qo'shiladi
const AUTO_ORDER = [
  'don', 'commissar', 'doctor', 'citizen', 'citizen', // 5
  'lover',   // 6
  'mafia',   // 7
  'maniac',  // 8
  'bum',     // 9
  'mafia',   // 10
  'lawyer',  // 11
  'jester',  // 12
  'citizen', // 13
  'mafia',   // 14
  'sniper',  // 15
  'citizen', // 16
];

// Qo'lda rejimda tanlanadigan rollar (mafia — soni, qolganlari 0 yoki 1)
const CUSTOM_ROLES = ['don', 'mafia', 'lawyer', 'commissar', 'doctor', 'lover', 'bum', 'sniper', 'maniac', 'jester'];

const OPTIONS = {
  dayTime: [0, 60, 90, 120, 180],  // 0 = avtomatik (tiriklar soniga qarab)
  nightTime: [15, 20, 30, 45],
  voteTime: [20, 30, 45, 60],
};

const DEFAULT_SETTINGS = {
  mode: 'auto',
  custom: { don: 1, mafia: 1, lawyer: 0, commissar: 1, doctor: 1, lover: 1, bum: 0, sniper: 0, maniac: 0, jester: 0 },
  dayTime: 0,
  nightTime: 20,
  voteTime: 30,
  revealRoles: true,
  lastWord: true,
};

function sanitizeSettings(input, prev = DEFAULT_SETTINGS) {
  const s = JSON.parse(JSON.stringify(prev));
  if (!input || typeof input !== 'object') return s;
  if (input.mode === 'auto' || input.mode === 'custom') s.mode = input.mode;
  if (input.custom && typeof input.custom === 'object') {
    for (const r of CUSTOM_ROLES) {
      if (input.custom[r] === undefined) continue;
      const max = r === 'mafia' ? 5 : 1;
      s.custom[r] = Math.max(0, Math.min(max, Math.floor(Number(input.custom[r]) || 0)));
    }
  }
  for (const k of Object.keys(OPTIONS)) {
    if (OPTIONS[k].includes(Number(input[k]))) s[k] = Number(input[k]);
  }
  if (typeof input.revealRoles === 'boolean') s.revealRoles = input.revealRoles;
  if (typeof input.lastWord === 'boolean') s.lastWord = input.lastWord;
  return s;
}

function buildRoles(n, settings) {
  let roles;
  if (settings.mode === 'custom') {
    roles = [];
    for (const r of CUSTOM_ROLES) for (let i = 0; i < settings.custom[r]; i++) roles.push(r);
  } else {
    roles = AUTO_ORDER.slice(0, n);
  }
  while (roles.length < n) roles.push('citizen');
  return roles;
}

/** Rollar to'plami o'ynash mumkinmi? Xato matni yoki null */
function validateRoles(n, settings) {
  const roles = buildRoles(n, settings);
  if (roles.length > n) return `Maxsus rollar (${roles.length}) o'yinchilardan (${n}) ko'p`;
  if (!roles.some((r) => r === 'don' || r === 'mafia')) return 'Kamida bitta Don yoki Mafia kerak';
  const team = roles.filter((r) => ROLES[r].team === 'mafia').length;
  if (team * 2 >= n) return `Mafia jamoasi (${team}) ${n} kishi uchun juda katta`;
  return null;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function countOf(list) {
  const c = {};
  for (const r of list) c[r] = (c[r] || 0) + 1;
  return c;
}

class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = [];
    this.hostId = null;
    this.phase = 'lobby'; // lobby | roles | night | morning | lastWord | day | vote | voteResult | gameover
    this.settings = sanitizeSettings(null);
    this.timer = null;
    this.endsAt = null;
    this.log = [];
    this.chat = [];
    this.round = 0;
    this.winner = null;
    this.gameRoles = [];
    this.logId = 0;
    this.votes = {};
    this.ready = new Set();
    this.lastWordIds = new Set();
  }

  // ───────── yordamchilar ─────────
  byId(id) { return this.players.find((p) => p.id === id); }
  alive() { return this.players.filter((p) => p.alive); }
  inGame() { return !['lobby', 'gameover'].includes(this.phase); }
  roleName(p) { return ROLES[p.role].name; }
  /** O'lim xabari oxiriga rol qo'shiladi (agar sozlamada yoqilgan bo'lsa) */
  wasRole(p) { return this.settings.revealRoles ? ` U ${this.roleName(p)} edi.` : ''; }

  setTimer(seconds, fn) {
    clearTimeout(this.timer);
    const t = ms(seconds);
    this.endsAt = Date.now() + t;
    this.timer = setTimeout(() => { this.timer = null; fn(); }, t);
  }

  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.endsAt = null;
  }

  /** to: null = hammaga, playerId = shaxsiy */
  addLog(text, kind = 'sys', to = null) {
    this.log.push({ id: ++this.logId, text, kind, to });
    if (this.log.length > 200) this.log.shift();
  }
  note(p, text) { this.addLog(text, 'private', p.id); }

  // ───────── o'yinchilar ─────────
  addPlayer(name, socketId) {
    const p = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(16).toString('hex'),
      name, socketId, connected: true,
      role: null, alive: true, known: {}, bullets: 0,
      voice: false, voiceSession: null, // ovozli chat
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    this.addLog(`${name} stolga o'tirdi`);
    return p;
  }

  removePlayer(p) {
    clearTimeout(p.leaveTimer);
    p.voice = false;
    p.voiceSession = null;
    if (this.inGame()) {
      // O'yin paytida chiqib ketgan o'yinchi "o'ladi"
      p.socketId = null;
      p.connected = false;
      this.lastWordIds.delete(p.id);
      if (p.alive) {
        p.alive = false;
        this.addLog(`🚪 ${p.name} o'yinni tark etdi.${this.wasRole(p)}`, 'death');
        const w = this.checkWin();
        if (w) this.endGame(w);
      }
    } else {
      this.players = this.players.filter((q) => q !== p);
      this.addLog(`${p.name} stoldan turdi`);
    }
    if (this.hostId === p.id) {
      const next = this.players.find((q) => q.connected);
      this.hostId = next ? next.id : null;
    }
    this.broadcast();
  }

  updateSettings(p, input) {
    if (p.id !== this.hostId || this.phase !== 'lobby') return;
    this.settings = sanitizeSettings(input, this.settings);
    this.broadcast();
  }

  // ───────── o'yin boshlanishi ─────────
  start(byPlayer) {
    if (byPlayer.id !== this.hostId) return 'Faqat xona egasi boshlay oladi';
    if (this.phase !== 'lobby') return "O'yin allaqachon boshlangan";
    const n = this.players.length;
    if (n < MIN_PLAYERS) return `Kamida ${MIN_PLAYERS} ta o'yinchi kerak`;
    const err = validateRoles(n, this.settings);
    if (err) return err;

    const roles = shuffle(buildRoles(n, this.settings));
    this.gameRoles = roles.slice();
    this.players.forEach((p, i) => {
      p.role = roles[i];
      p.alive = true;
      p.known = {};
      p.bullets = p.role === 'sniper' ? 1 : 0;
    });
    // Mafiya a'zolari bir-birini taniydi
    const mafia = this.players.filter(isMafia);
    for (const m of mafia) for (const o of mafia) if (o !== m) m.known[o.id] = 'team';

    this.round = 0;
    this.winner = null;
    this.lastHeal = null;
    this.log = [];
    this.chat = [];
    this.addLog("🎲 O'yin boshlandi! Rollar tarqatildi — kartangizga qarang.");
    this.phase = 'roles';
    this.setTimer(TIME.roles, () => this.startNight());
    this.broadcast();
    return null;
  }

  // ───────── TUN ─────────
  startNight() {
    this.round++;
    this.phase = 'night';
    this.night = { mafiaVotes: {}, blocked: null, actors: {}, done: new Set() };
    // Rollar ochiq bo'lsa — faqat tirik egasi borlar uyg'onadi.
    // Yopiq bo'lsa — o'yindagi barcha rollar "uyg'onadi" (kim o'lgani bilinmasligi uchun).
    const reveal = this.settings.revealRoles;
    this.steps = NIGHT_STEPS.filter((s) => s.roles.some((r) =>
      reveal ? this.players.some((p) => p.alive && p.role === r) : this.gameRoles.includes(r)));
    this.stepIndex = -1;
    this.step = null;
    this.addLog(`🌙 ${this.round}-tun. Shahar uxlamoqda...`, 'night');
    this.setTimer(TIME.nightIntro, () => this.nextStep());
    this.broadcast();
  }

  stepActors() {
    if (!this.step) return [];
    return this.players.filter((p) => p.alive && this.step.roles.includes(p.role));
  }

  /** Bu qadamda haqiqatan harakat qila oladiganlar */
  ableActors() {
    return this.stepActors().filter((a) => a.connected && a.id !== this.night.blocked &&
      !(a.role === 'sniper' && a.bullets <= 0));
  }

  nextStep() {
    this.stepIndex++;
    this.stepLocked = false;
    if (this.stepIndex >= this.steps.length) return this.resolveNight();
    this.step = this.steps[this.stepIndex];

    for (const a of this.stepActors()) {
      if (a.id === this.night.blocked) this.note(a, "💋 Bu tun Mashuqa sizning oldingizda. Siz harakat qila olmaysiz.");
    }
    // Hech kim harakat qila olmasa — tasodifiy pauza (boshqalar buni sezmasligi uchun)
    const seconds = this.ableActors().length
      ? this.settings.nightTime + (this.step.extra || 0)
      : 6 + crypto.randomInt(6);
    this.setTimer(seconds, () => this.nextStep());
    this.broadcast();
  }

  canAct(p) {
    if (this.phase !== 'night' || !this.step || this.stepLocked || !p.alive) return false;
    if (!this.step.roles.includes(p.role) || this.night.blocked === p.id) return false;
    if (p.role === 'sniper' && p.bullets <= 0) return false;
    return this.step.key === 'mafia' || !this.night.done.has(this.step.key);
  }

  /** p hozir kimni tanlay oladi */
  targetsFor(p) {
    if (!p.alive) return [];
    const alive = this.alive();
    if (this.phase === 'vote') return alive.filter((q) => q.id !== p.id).map((q) => q.id);
    if (!this.canAct(p)) return [];
    const k = this.step.key;
    return alive.filter((q) => {
      if (k === 'mafia' || k === 'don') return !isMafia(q);
      if (k === 'lawyer') return isMafia(q);
      if (k === 'doctor') return q.id !== this.lastHeal;
      return q.id !== p.id;
    }).map((q) => q.id);
  }

  act(p, targetId) {
    if (!this.targetsFor(p).includes(targetId)) return;
    const k = this.step.key;
    const t = this.byId(targetId);

    if (k === 'mafia') {
      this.night.mafiaVotes[p.id] = targetId;
      if (this.ableActors().every((a) => this.night.mafiaVotes[a.id])) {
        this.setTimer(3, () => this.nextStep());
      }
      return this.broadcast();
    }

    this.night[k] = targetId;
    this.night.actors[k] = p.id;
    this.night.done.add(k);
    switch (k) {
      case 'lover':
        this.night.blocked = targetId;
        this.note(p, `💋 Siz bu tun ${t.name}ning oldiga bordingiz.`);
        break;
      case 'don': {
        const res = t.role === 'commissar' ? 'commissar' : 'notcommissar';
        p.known[t.id] = res;
        this.note(p, `🎩 Tekshiruv: ${t.name} — ${res === 'commissar' ? 'KOMISSAR! 🔴' : 'Komissar emas'}`);
        break;
      }
      case 'lawyer':
        this.note(p, `💼 Siz bu tun ${t.name}ni himoya qilyapsiz.`);
        break;
      case 'maniac':
        this.note(p, `🔪 Siz ${t.name}ni nishonga oldingiz.`);
        break;
      case 'sniper':
        p.bullets--;
        this.note(p, `🎯 Siz ${t.name}ga o'q uzdingiz. Boshqa o'qingiz yo'q.`);
        break;
      case 'bum':
        this.note(p, `🧥 Siz bu tun ${t.name}ning uyi yonida tunayapsiz...`);
        break;
      case 'doctor':
        this.note(p, `💉 Siz bu tun ${t.name}ni davolayapsiz.`);
        break;
      case 'commissar': {
        // Advokat himoya qilgan mafiya "toza" ko'rinadi
        const hidden = this.night.lawyer === t.id;
        const res = isMafia(t) && !hidden ? 'mafia' : 'clean';
        p.known[t.id] = res;
        this.note(p, `🕵️ Tekshiruv: ${t.name} — ${res === 'mafia' ? 'MAFIA! 🔴' : 'mafia emas 🟢'}`);
        break;
      }
    }
    this.finishStepSoon(2);
    this.broadcast();
  }

  /** Ixtiyoriy harakatdan voz kechish (masalan, Snayper o'q uzmaydi) */
  skip(p) {
    if (!this.canAct(p) || !this.step.skippable) return;
    this.night.done.add(this.step.key);
    this.finishStepSoon(1.5);
    this.broadcast();
  }

  finishStepSoon(seconds) {
    this.stepLocked = true;
    this.setTimer(seconds, () => this.nextStep());
  }

  mafiaTarget() {
    const votes = this.night.mafiaVotes;
    const don = this.players.find((q) => q.role === 'don' && q.alive);
    if (don && votes[don.id]) return votes[don.id];
    const tally = countOf(Object.values(votes));
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter((id) => tally[id] === max);
    return max > 0 && top.length === 1 ? top[0] : null; // kelisha olmasa — hech kim
  }

  resolveNight() {
    this.step = null;
    const n = this.night;
    const mt = this.mafiaTarget();
    const victims = new Set([mt, n.maniac, n.sniper].filter(Boolean));

    let saved = false;
    if (n.doctor && victims.has(n.doctor)) {
      victims.delete(n.doctor);
      saved = true;
      const doc = this.byId(n.actors.doctor);
      if (doc) this.note(doc, '💉 Siz bu tun hayotni saqlab qoldingiz!');
    }
    this.lastHeal = n.doctor || null;

    // Daydi: kuzatgan uyiga kim kelganini bilib oladi
    if (n.bum) {
      const bum = this.byId(n.actors.bum);
      const house = this.byId(n.bum);
      const visitors = new Set();
      for (const key of ['lover', 'don', 'lawyer', 'maniac', 'sniper', 'doctor', 'commissar']) {
        if (n[key] === n.bum && n.actors[key] && n.actors[key] !== bum.id) visitors.add(this.byId(n.actors[key]).name);
      }
      if (mt === n.bum) {
        for (const [mid, t] of Object.entries(n.mafiaVotes)) if (t === n.bum) visitors.add(this.byId(mid).name);
      }
      this.note(bum, visitors.size
        ? `🧥 Tunda ${house.name}ning uyiga kelganlar: ${[...visitors].join(', ')}`
        : `🧥 Tunda ${house.name}ning uyiga hech kim kelmadi.`);
    }

    const dead = [...victims].map((id) => this.byId(id)).filter(Boolean);
    dead.forEach((d) => { d.alive = false; });

    this.addLog(`☀️ Tong otdi. ${this.round}-kun.`, 'day');
    if (dead.length) {
      for (const d of dead) this.addLog(`💀 Tunda ${d.name} o'ldirildi.${this.wasRole(d)}`, 'death');
    } else {
      this.addLog("Bu tun hech kim o'lmadi.", 'day');
    }
    if (saved) this.addLog("💉 Shifokor kimnidir o'limdan qutqarib qoldi!", 'day');

    this.phase = 'morning';
    const w = this.checkWin();
    if (w) return this.endGame(w);
    this.setTimer(TIME.morning, () => this.startLastWord(dead.map((d) => d.id), () => this.startDay()));
    this.broadcast();
  }

  // ───────── OXIRGI SO'Z ─────────
  startLastWord(ids, next) {
    ids = ids.filter((id) => this.byId(id));
    if (!this.settings.lastWord || !ids.length) return next();
    this.phase = 'lastWord';
    this.lastWordIds = new Set(ids);
    this.afterLastWord = next;
    const names = ids.map((id) => this.byId(id).name).join(', ');
    this.addLog(`🕯️ Oxirgi so'z: ${names}. Qolganlar tinglaydi.`, 'day');
    const online = ids.some((id) => this.byId(id).connected);
    this.setTimer(online ? TIME.lastWord : 2, () => this.finishLastWord());
    this.broadcast();
  }

  endLastWord(p) {
    if (this.phase !== 'lastWord' || !this.lastWordIds.has(p.id)) return;
    this.lastWordIds.delete(p.id);
    if (!this.lastWordIds.size) return this.finishLastWord();
    this.broadcast();
  }

  finishLastWord() {
    this.lastWordIds = new Set();
    const next = this.afterLastWord;
    this.afterLastWord = null;
    if (next && this.phase === 'lastWord') next();
  }

  // ───────── KUN ─────────
  startDay() {
    this.phase = 'day';
    this.ready = new Set();
    const t = this.settings.dayTime || Math.min(150, 40 + 10 * this.alive().length);
    this.addLog('🗣️ Muhokama boshlandi. Kim mafiya?', 'day');
    this.setTimer(t, () => this.startVote());
    this.broadcast();
  }

  toggleReady(p) {
    if (this.phase !== 'day' || !p.alive) return;
    if (this.ready.has(p.id)) this.ready.delete(p.id); else this.ready.add(p.id);
    if (this.ready.size > this.alive().length / 2) return this.startVote();
    this.broadcast();
  }

  startVote() {
    this.phase = 'vote';
    this.votes = {};
    this.addLog('🗳️ Ovoz berish! Shahardan kimni chiqaramiz?', 'day');
    this.setTimer(this.settings.voteTime, () => this.resolveVote());
    this.broadcast();
  }

  vote(p, targetId) {
    if (this.phase !== 'vote' || !this.targetsFor(p).includes(targetId)) return;
    this.votes[p.id] = targetId;
    const voters = this.alive().filter((q) => q.connected);
    if (voters.every((q) => this.votes[q.id])) this.setTimer(2, () => this.resolveVote());
    this.broadcast();
  }

  resolveVote() {
    const tally = countOf(Object.values(this.votes));
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter((id) => tally[id] === max);
    this.phase = 'voteResult';
    let out = null;
    if (max > 0 && top.length === 1) {
      out = this.byId(top[0]);
      out.alive = false;
      this.addLog(`⚖️ Shahar qaror qildi: ${out.name} chiqarib yuborildi (${max} ovoz).${this.wasRole(out)}`, 'death');
      if (out.role === 'jester') return this.endGame('jester');
    } else {
      this.addLog('⚖️ Ovozlar teng yoki hech kim ovoz bermadi — bugun hech kim chiqarilmadi.', 'day');
    }
    const w = this.checkWin();
    if (w) return this.endGame(w);
    this.setTimer(TIME.voteResult, () => this.startLastWord(out ? [out.id] : [], () => this.startNight()));
    this.broadcast();
  }

  // ───────── G'ALABA ─────────
  checkWin() {
    const alive = this.alive();
    const m = alive.filter(isMafia).length;
    const k = alive.filter((p) => p.role === 'maniac').length;
    const c = alive.length - m - k;
    if (m === 0 && k === 0) return 'town';
    if (k === 1 && alive.length <= 2) return 'maniac';
    if (k === 0 && m >= c) return 'mafia';
    return null;
  }

  endGame(winner) {
    this.clearTimer();
    this.step = null;
    this.lastWordIds = new Set();
    this.phase = 'gameover';
    this.winner = winner;
    this.addLog(WINNERS[winner], 'win');
    this.broadcast();
  }

  backToLobby(p) {
    if (p.id !== this.hostId || this.phase !== 'gameover') return;
    this.players = this.players.filter((q) => q.connected);
    for (const q of this.players) { q.role = null; q.alive = true; q.known = {}; q.bullets = 0; }
    this.phase = 'lobby';
    this.winner = null;
    this.log = [];
    this.chat = [];
    this.addLog("Yangi o'yin uchun stol tayyor.");
    this.broadcast();
  }

  // ───────── OVOZLI CHAT ─────────
  setVoice(p, on) {
    p.voice = !!on && p.connected;
    p.voiceSession = p.voice ? crypto.randomBytes(6).toString('hex') : null;
    this.broadcast();
  }

  /** Hozirgi fazada speaker gapirsa, listener eshitadimi? */
  canHear(speaker, listener) {
    if (speaker === listener || !speaker.voice || !listener.voice) return false;
    switch (this.phase) {
      case 'lobby':
      case 'gameover': return true;
      case 'roles': return false;
      case 'night': return speaker.alive && listener.alive && isMafia(speaker) && isMafia(listener);
      case 'lastWord': return this.lastWordIds.has(speaker.id);
      default: return speaker.alive; // tong, kun, ovoz berish — tiriklar gapiradi, hamma eshitadi
    }
  }

  voiceFor(p) {
    const others = this.players.filter((q) => q !== p);
    let mode = 'all';
    if (this.phase === 'roles') mode = 'silent';
    else if (this.phase === 'night') mode = p.alive && isMafia(p) ? 'mafia' : 'silent';
    else if (this.phase === 'lastWord') mode = this.lastWordIds.has(p.id) ? 'lastword-speaker' : 'lastword';
    else if (this.inGame() && !p.alive) mode = 'listen';
    return {
      mode,
      to: others.filter((q) => this.canHear(p, q)).map((q) => q.id),
      from: others.filter((q) => this.canHear(q, p)).map((q) => q.id),
    };
  }

  // ───────── CHAT ─────────
  chatChannel(p) {
    if (!this.inGame()) return 'all';
    if (this.phase === 'lastWord') return this.lastWordIds.has(p.id) ? 'all' : null;
    if (!p.alive || this.phase === 'roles') return null;
    if (this.phase === 'night') return isMafia(p) ? 'mafia' : null;
    return 'all';
  }

  sendChat(p, text) {
    text = String(text || '').trim().slice(0, 200);
    const channel = this.chatChannel(p);
    if (!text || !channel) return;
    const msg = { from: p.name, fromId: p.id, text, channel, lastWord: this.phase === 'lastWord', t: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 150) this.chat.shift();
    for (const q of this.players) {
      if (q.socketId && this.canSeeChat(q, msg)) this.io.to(q.socketId).emit('chat', msg);
    }
  }

  canSeeChat(p, msg) {
    return msg.channel === 'all' || isMafia(p) || this.phase === 'gameover';
  }

  chatHistoryFor(p) { return this.chat.filter((m) => this.canSeeChat(p, m)); }

  // ───────── HOLATNI YUBORISH ─────────
  /** Har bir o'yinchi faqat o'ziga ruxsat etilganini ko'radi */
  viewFor(p) {
    const over = this.phase === 'gameover';
    const meMafia = isMafia(p);
    const reveal = this.settings.revealRoles;
    const awake = this.phase === 'night' && !!this.step && p.alive && this.step.roles.includes(p.role);
    const targets = this.targetsFor(p);

    let myTarget = null;
    if (awake) myTarget = this.step.key === 'mafia' ? this.night.mafiaVotes[p.id] : this.night[this.step.key];
    if (this.phase === 'vote') myTarget = this.votes[p.id] || null;

    const showVotes = ['vote', 'voteResult'].includes(this.phase);
    const voteCounts = showVotes ? countOf(Object.values(this.votes)) : {};

    const players = this.players.map((q, seat) => {
      const showRole = q.id === p.id || over || (!q.alive && reveal) || (meMafia && isMafia(q));
      const v = {
        id: q.id, name: q.name, seat, alive: q.alive, connected: q.connected,
        role: showRole && q.role ? q.role : null,
        known: p.known[q.id] || null,
        votes: voteCounts[q.id] || 0,
        ready: this.phase === 'day' && this.ready.has(q.id),
        speaking: this.phase === 'lastWord' && this.lastWordIds.has(q.id),
        voice: q.voice,
        voiceSession: q.voiceSession,
      };
      if (showVotes && this.votes[q.id]) v.votedFor = this.votes[q.id]; // ovozlar ochiq
      // Mafiya tunda sheriklari kimni tanlaganini ko'radi
      if (awake && this.step.key === 'mafia' && meMafia) {
        v.mafiaPicks = Object.entries(this.night.mafiaVotes)
          .filter(([, t]) => t === q.id).map(([mid]) => this.byId(mid).name);
      }
      return v;
    });

    const lobby = this.phase === 'lobby';
    const nForRoles = Math.max(MIN_PLAYERS, this.players.length);
    const composition = countOf(lobby ? buildRoles(nForRoles, this.settings) : this.gameRoles);

    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      endsAt: this.endsAt,
      now: Date.now(),
      hostId: this.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      settings: this.settings,
      options: OPTIONS,
      customRoles: CUSTOM_ROLES,
      composition,
      rolesError: lobby ? validateRoles(nForRoles, this.settings) : null,
      step: this.phase === 'night' && this.step ? { key: this.step.key, title: this.step.title } : null,
      winner: this.winner,
      readyCount: this.phase === 'day' ? this.ready.size : 0,
      aliveCount: this.alive().length,
      players,
      me: {
        id: p.id, role: p.role, alive: p.alive,
        awake,
        blocked: awake && this.night.blocked === p.id,
        canAct: awake && this.canAct(p),
        canSkip: awake && this.canAct(p) && !!this.step.skippable,
        noBullets: awake && p.role === 'sniper' && p.bullets <= 0,
        prompt: awake ? this.step.prompt : null,
        targets,
        myTarget,
        chat: this.chatChannel(p),
        lastWord: this.phase === 'lastWord' && this.lastWordIds.has(p.id),
        voice: this.voiceFor(p),
      },
      log: this.log.filter((l) => l.to === null || l.to === p.id).slice(-60),
    };
  }

  broadcast() {
    for (const p of this.players) {
      if (p.socketId) this.io.to(p.socketId).emit('state', this.viewFor(p));
    }
  }
}

module.exports = { Room, ROLES, MIN_PLAYERS, MAX_PLAYERS, buildRoles, validateRoles, DEFAULT_SETTINGS };
