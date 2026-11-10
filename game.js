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

// Fazalar davomiyligi (soniya)
const TIME = {
  roles: 10,       // rolni ko'rish
  nightIntro: 4,   // "Shahar uxlamoqda..."
  morning: 7,      // tun natijalari e'loni
  vote: 30,        // ovoz berish
  voteResult: 6,   // ovoz natijasi
  dayBase: 40,     // muhokama: 40s + har bir tirik o'yinchi uchun 10s
  dayPerPlayer: 10,
  dayMax: 150,
};

const ROLES = {
  citizen:   { name: 'Tinch aholi', team: 'town',   icon: '🧑', desc: "Maxsus qobiliyatingiz yo'q. Kunduzi muhokama qilib, mafiyani toping va unga qarshi ovoz bering." },
  mafia:     { name: 'Mafia',       team: 'mafia',  icon: '🔫', desc: "Tunda sheriklaringiz bilan uyg'onib, qurbonni tanlaysiz. Maqsad — shaharni egallash." },
  don:       { name: 'Don',         team: 'mafia',  icon: '🎩', desc: "Mafiya boshlig'i. Qurbon bo'yicha oxirgi so'z sizniki. Keyin alohida uyg'onib, kim Komissar ekanini tekshirasiz." },
  commissar: { name: 'Komissar',    team: 'town',   icon: '🕵️', desc: "Har tun bir kishini tekshirasiz: u mafiyami yoki yo'qmi — darhol bilib olasiz." },
  doctor:    { name: 'Shifokor',    team: 'town',   icon: '💉', desc: "Har tun bir kishini davolaysiz — hujumga uchrasa ham tirik qoladi. Bir odamni ketma-ket ikki tun davolay olmaysiz." },
  lover:     { name: 'Mashuqa',     team: 'town',   icon: '💋', desc: "Har tun bir kishining oldiga borasiz. U shu tun o'z qobiliyatidan foydalana olmaydi." },
  maniac:    { name: 'Manyak',      team: 'maniac', icon: '🔪', desc: "Yolg'iz o'ynaysiz. Har tun bir kishini o'ldirasiz. Oxirgi ikki tirik odamdan biri bo'lsangiz — g'olibsiz." },
};

// Tun tartibi: kim qachon uyg'onadi
const NIGHT_STEPS = [
  { key: 'lover',     roles: ['lover'],        title: "Mashuqa uyg'ondi",  prompt: 'Bu tun kimning oldiga borasiz?', time: 20 },
  { key: 'mafia',     roles: ['mafia', 'don'], title: "Mafia uyg'ondi",    prompt: "Bu tun kimni o'ldirasiz?",       time: 35 },
  { key: 'don',       roles: ['don'],          title: "Don uyg'ondi",      prompt: 'Kim Komissar? Bir kishini tekshiring', time: 20 },
  { key: 'maniac',    roles: ['maniac'],       title: "Manyak uyg'ondi",   prompt: "Bu tun kimni o'ldirasiz?",       time: 20 },
  { key: 'doctor',    roles: ['doctor'],       title: "Shifokor uyg'ondi", prompt: 'Bu tun kimni davolaysiz?',       time: 20 },
  { key: 'commissar', roles: ['commissar'],    title: "Komissar uyg'ondi", prompt: 'Kimni tekshirasiz?',             time: 20 },
];

const WINNERS = {
  town:   "🏙️ Tinch aholi g'alaba qozondi! Shahar mafiyadan tozalandi.",
  mafia:  "🔫 Mafia g'alaba qozondi! Shahar endi ularniki.",
  maniac: "🔪 Manyak g'alaba qozondi! U oxirgi tirik qolganlardan biri.",
};

const isMafia = (p) => p && ROLES[p.role] && ROLES[p.role].team === 'mafia';

/** O'yinchilar soniga qarab rollar ro'yxati */
function buildRoles(n) {
  const roles = ['don', 'commissar', 'doctor'];
  const extraMafia = n >= 13 ? 3 : n >= 10 ? 2 : n >= 7 ? 1 : 0;
  for (let i = 0; i < extraMafia; i++) roles.push('mafia');
  if (n >= 6) roles.push('lover');
  if (n >= 8) roles.push('maniac');
  while (roles.length < n) roles.push('citizen');
  return roles.slice(0, n);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function countRoles(list) {
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
    this.phase = 'lobby'; // lobby | roles | night | morning | day | vote | voteResult | gameover
    this.timer = null;
    this.endsAt = null;
    this.log = [];
    this.chat = [];
    this.round = 0;
    this.winner = null;
    this.gameRoles = [];
    this.logId = 0;
  }

  // ───────── yordamchilar ─────────
  byId(id) { return this.players.find((p) => p.id === id); }
  alive() { return this.players.filter((p) => p.alive); }
  inGame() { return !['lobby', 'gameover'].includes(this.phase); }

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

  /** to: null = hammaga, playerId = shaxsiy, 'mafia' = faqat mafiyaga */
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
      role: null, alive: true, known: {},
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    this.addLog(`${name} stolga o'tirdi`);
    return p;
  }

  removePlayer(p) {
    clearTimeout(p.leaveTimer);
    if (this.inGame()) {
      // O'yin paytida chiqib ketgan o'yinchi "o'ladi"
      p.socketId = null;
      p.connected = false;
      if (p.alive) {
        p.alive = false;
        this.addLog(`🚪 ${p.name} o'yinni tark etdi. U ${ROLES[p.role].name} edi.`, 'death');
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

  // ───────── o'yin boshlanishi ─────────
  start(byPlayer) {
    if (byPlayer.id !== this.hostId) return 'Faqat xona egasi boshlay oladi';
    if (this.phase !== 'lobby') return "O'yin allaqachon boshlangan";
    if (this.players.length < MIN_PLAYERS) return `Kamida ${MIN_PLAYERS} ta o'yinchi kerak`;

    const roles = shuffle(buildRoles(this.players.length));
    this.gameRoles = roles.slice();
    this.players.forEach((p, i) => {
      p.role = roles[i];
      p.alive = true;
      p.known = {};
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
    this.night = { mafiaVotes: {}, blocked: null };
    // Faqat tirik egasi bor rollar uyg'onadi
    this.steps = NIGHT_STEPS.filter((s) =>
      this.players.some((p) => p.alive && s.roles.includes(p.role)));
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

  nextStep() {
    this.stepIndex++;
    this.stepLocked = false;
    if (this.stepIndex >= this.steps.length) return this.resolveNight();
    this.step = this.steps[this.stepIndex];

    const actors = this.stepActors();
    for (const a of actors) {
      if (a.id === this.night.blocked) this.note(a, "💋 Bu tun Mashuqa sizning oldingizda. Siz harakat qila olmaysiz.");
    }
    const able = actors.filter((a) => a.id !== this.night.blocked && a.connected);
    // Hech kim harakat qila olmasa, qisqa pauza (boshqalar baribir bilmasligi uchun)
    const seconds = able.length ? this.step.time : 5 + crypto.randomInt(4);
    this.setTimer(seconds, () => this.nextStep());
    this.broadcast();
  }

  canAct(p) {
    return this.phase === 'night' && !!this.step && !this.stepLocked && p.alive &&
      this.step.roles.includes(p.role) && this.night.blocked !== p.id &&
      (this.step.key === 'mafia' || this.night[this.step.key] == null);
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
      const voters = this.stepActors().filter((a) => a.id !== this.night.blocked && a.connected);
      if (voters.every((a) => this.night.mafiaVotes[a.id])) this.finishStepSoon(3);
    } else {
      this.night[k] = targetId;
      if (k === 'lover') this.night.blocked = targetId;
      if (k === 'commissar') {
        const res = isMafia(t) ? 'mafia' : 'clean';
        p.known[t.id] = res;
        this.note(p, `🕵️ Tekshiruv: ${t.name} — ${res === 'mafia' ? 'MAFIA! 🔴' : 'mafia emas 🟢'}`);
      }
      if (k === 'don') {
        const res = t.role === 'commissar' ? 'commissar' : 'notcommissar';
        p.known[t.id] = res;
        this.note(p, `🎩 Tekshiruv: ${t.name} — ${res === 'commissar' ? 'KOMISSAR! 🔴' : 'Komissar emas'}`);
      }
      if (k === 'lover') this.note(p, `💋 Siz bu tun ${t.name}ning oldiga bordingiz.`);
      if (k === 'doctor') this.note(p, `💉 Siz bu tun ${t.name}ni davolayapsiz.`);
      if (k === 'maniac') this.note(p, `🔪 Siz ${t.name}ni nishonga oldingiz.`);
      this.finishStepSoon(2);
    }
    this.broadcast();
  }

  finishStepSoon(seconds) {
    this.stepLocked = this.step.key !== 'mafia' ? true : this.stepLocked;
    this.setTimer(seconds, () => this.nextStep());
  }

  mafiaTarget() {
    const votes = this.night.mafiaVotes;
    const don = this.players.find((q) => q.role === 'don' && q.alive);
    if (don && votes[don.id]) return votes[don.id];
    const tally = countRoles(Object.values(votes));
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter((id) => tally[id] === max);
    return max > 0 && top.length === 1 ? top[0] : null; // kelisha olmasa — hech kim
  }

  resolveNight() {
    this.step = null;
    const n = this.night;
    const victims = new Set();
    const mt = this.mafiaTarget();
    if (mt) victims.add(mt);
    if (n.maniac) victims.add(n.maniac);

    let saved = false;
    if (n.doctor && victims.has(n.doctor)) {
      victims.delete(n.doctor);
      saved = true;
      const doc = this.players.find((q) => q.role === 'doctor');
      if (doc) this.note(doc, '💉 Siz bu tun hayotni saqlab qoldingiz!');
    }
    this.lastHeal = n.doctor || null;

    const dead = [...victims].map((id) => this.byId(id)).filter(Boolean);
    dead.forEach((d) => { d.alive = false; });

    this.addLog(`☀️ Tong otdi. ${this.round}-kun.`, 'day');
    if (dead.length) {
      for (const d of dead) this.addLog(`💀 Tunda ${d.name} o'ldirildi. U ${ROLES[d.role].name} edi.`, 'death');
    } else {
      this.addLog("Bu tun hech kim o'lmadi.", 'day');
    }
    if (saved) this.addLog('💉 Shifokor kimnidir o\'limdan qutqarib qoldi!', 'day');

    this.phase = 'morning';
    const w = this.checkWin();
    if (w) return this.endGame(w);
    this.setTimer(TIME.morning, () => this.startDay());
    this.broadcast();
  }

  // ───────── KUN ─────────
  startDay() {
    this.phase = 'day';
    this.ready = new Set();
    const t = Math.min(TIME.dayMax, TIME.dayBase + TIME.dayPerPlayer * this.alive().length);
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
    this.addLog("🗳️ Ovoz berish! Shahardan kimni chiqaramiz?", 'day');
    this.setTimer(TIME.vote, () => this.resolveVote());
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
    const tally = countRoles(Object.values(this.votes));
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter((id) => tally[id] === max);
    this.phase = 'voteResult';
    if (max > 0 && top.length === 1) {
      const out = this.byId(top[0]);
      out.alive = false;
      this.addLog(`⚖️ Shahar qaror qildi: ${out.name} chiqarib yuborildi (${max} ovoz). U ${ROLES[out.role].name} edi.`, 'death');
    } else {
      this.addLog("⚖️ Ovozlar teng yoki hech kim ovoz bermadi — bugun hech kim chiqarilmadi.", 'day');
    }
    const w = this.checkWin();
    if (w) return this.endGame(w);
    this.setTimer(TIME.voteResult, () => this.startNight());
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
    this.phase = 'gameover';
    this.winner = winner;
    this.addLog(WINNERS[winner], 'win');
    this.broadcast();
  }

  backToLobby(p) {
    if (p.id !== this.hostId || this.phase !== 'gameover') return;
    this.players = this.players.filter((q) => q.connected);
    for (const q of this.players) { q.role = null; q.alive = true; q.known = {}; }
    this.phase = 'lobby';
    this.winner = null;
    this.log = [];
    this.chat = [];
    this.addLog('Yangi o\'yin uchun stol tayyor.');
    this.broadcast();
  }

  // ───────── CHAT ─────────
  chatChannel(p) {
    if (!this.inGame()) return 'all';
    if (!p.alive || this.phase === 'roles') return null;
    if (this.phase === 'night') return isMafia(p) ? 'mafia' : null;
    return 'all';
  }

  sendChat(p, text) {
    text = String(text || '').trim().slice(0, 200);
    const channel = this.chatChannel(p);
    if (!text || !channel) return;
    const msg = { from: p.name, fromId: p.id, text, channel, t: Date.now() };
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
    const awake = this.phase === 'night' && !!this.step && p.alive && this.step.roles.includes(p.role);
    const targets = this.targetsFor(p);

    let myTarget = null;
    if (awake) myTarget = this.step.key === 'mafia' ? this.night.mafiaVotes[p.id] : this.night[this.step.key];
    if (this.phase === 'vote') myTarget = this.votes[p.id] || null;

    const voteCounts = ['vote', 'voteResult'].includes(this.phase) ? countRoles(Object.values(this.votes)) : {};

    const players = this.players.map((q, seat) => {
      const showRole = q.id === p.id || !q.alive || over || (meMafia && isMafia(q));
      const v = {
        id: q.id, name: q.name, seat, alive: q.alive, connected: q.connected,
        role: showRole && q.role ? q.role : null,
        known: p.known[q.id] || null,
        votes: voteCounts[q.id] || 0,
        ready: this.phase === 'day' && this.ready.has(q.id),
      };
      if (['vote', 'voteResult'].includes(this.phase) && this.votes[q.id]) {
        v.votedFor = this.votes[q.id]; // ovozlar ochiq
      }
      // Mafiya tunda sheriklari kimni tanlaganini ko'radi
      if (awake && this.step.key === 'mafia' && meMafia) {
        v.mafiaPicks = Object.entries(this.night.mafiaVotes)
          .filter(([, t]) => t === q.id).map(([mid]) => this.byId(mid).name);
      }
      return v;
    });

    const composition = this.phase === 'lobby'
      ? countRoles(buildRoles(Math.max(MIN_PLAYERS, this.players.length)))
      : countRoles(this.gameRoles);

    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      endsAt: this.endsAt,
      now: Date.now(),
      hostId: this.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      composition,
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
        prompt: awake ? this.step.prompt : null,
        targets,
        myTarget,
        chat: this.chatChannel(p),
      },
      log: this.log.filter((l) => l.to === null || l.to === p.id || (l.to === 'mafia' && meMafia)).slice(-60),
    };
  }

  broadcast() {
    for (const p of this.players) {
      if (p.socketId) this.io.to(p.socketId).emit('state', this.viewFor(p));
    }
  }
}

module.exports = { Room, ROLES, MIN_PLAYERS, MAX_PLAYERS };
