'use strict';
/*
 * MAFIA — o'yin mantig'i (serverda ishlaydi).
 * Barcha qarorlar shu yerda qabul qilinadi; mijozlar (brauzerlar) faqat
 * o'zlariga ruxsat etilgan ma'lumotni ko'radi (viewFor funksiyasiga qarang).
 */
const crypto = require('crypto');
const profanity = require('./profanity');
const I18N = require('./public/i18n.js');
const uz = (key, p) => I18N.render('uz', key, p); // o'zbekcha matn (eski mijozlar va testlar uchun)

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
  defense: 20,     // o'zini oqlash
  verdict: 15,     // yakuniy "ha/yo'q" ovozi
};

// Rollar: jamoa va belgi. Nom va tavsif — public/i18n.js da (har bir til uchun)
const ROLE_META = {
  citizen: ['town', '🧑'], don: ['mafia', '🎩'], mafia: ['mafia', '🔫'], lawyer: ['mafia', '💼'],
  commissar: ['town', '🕵️'], doctor: ['town', '💉'], lover: ['town', '💋'], bum: ['town', '🧥'],
  sniper: ['town', '🎯'], guard: ['town', '🛡️'], kamikadze: ['town', '💣'], wizard: ['town', '🔮'],
  maniac: ['maniac', '🔪'], jester: ['jester', '🤡'],
};
const ROLES = Object.fromEntries(Object.entries(ROLE_META).map(([k, [team, icon]]) => [k, {
  name: uz(`role.${k}.name`), team, icon, desc: uz(`role.${k}.desc`),
}]));

// Tun tartibi: kim qachon uyg'onadi. time: tungi vaqtga qo'shimcha soniya.
const NIGHT_STEPS = [
  { key: 'lover',     roles: ['lover'],        title: "Mashuqa uyg'ondi",  prompt: 'Bu tun kimning oldiga borasiz?' },
  { key: 'mafia',     roles: ['mafia', 'don'], title: "Mafia uyg'ondi",    prompt: "Bu tun kimni o'ldirasiz?", extra: 10 },
  { key: 'don',       roles: ['don'],          title: "Don uyg'ondi",      prompt: 'Kim Komissar? Bir kishini tekshiring' },
  { key: 'lawyer',    roles: ['lawyer'],       title: "Advokat uyg'ondi",  prompt: 'Qaysi sherigingizni himoya qilasiz?' },
  { key: 'maniac',    roles: ['maniac'],       title: "Manyak uyg'ondi",   prompt: "Bu tun kimni o'ldirasiz?" },
  { key: 'sniper',    roles: ['sniper'],       title: "Snayper uyg'ondi",  prompt: "Yagona o'qingizni uzasizmi?", skippable: true },
  { key: 'kamikadze', roles: ['kamikadze'],    title: "Kamikadze uyg'ondi", prompt: 'Kim bilan birga portlaysiz?', skippable: true },
  { key: 'bum',       roles: ['bum'],          title: "Daydi uyg'ondi",    prompt: 'Bu tun kimning uyi yonida tunaysiz?' },
  { key: 'guard',     roles: ['guard'],        title: "Qo'riqchi uyg'ondi", prompt: "Bu tun kimni qo'riqlaysiz?" },
  { key: 'wizard',    roles: ['wizard'],       title: "Sehrgar uyg'ondi",  prompt: "Kimga ko'zgu sehrini solasiz?" },
  { key: 'doctor',    roles: ['doctor'],       title: "Shifokor uyg'ondi", prompt: 'Bu tun kimni davolaysiz?' },
  { key: 'commissar', roles: ['commissar'],    title: "Komissar uyg'ondi", prompt: 'Kimni tekshirasiz?' },
];

// G'olib e'lonlari: win.town, win.mafia, win.maniac, win.jester (public/i18n.js)

// Avatar: emoji (qisqa matn) + rang raqami (0–7)
const AVATAR_COLORS = 8;
function cleanAvatar(a) {
  const e = a && typeof a.e === 'string' ? a.e.trim() : '';
  // Faqat emoji: harf, raqam, bo'shliq va HTML belgilari taqiqlanadi
  const okEmoji = e && e.length <= 8 && !/[<>&"'\s\w]/.test(e);
  const c = a ? Math.floor(Number(a.c)) : NaN;
  return {
    e: okEmoji ? e : null,
    c: c >= 0 && c < AVATAR_COLORS ? c : crypto.randomInt(AVATAR_COLORS),
  };
}

// Ovoz berishda "hech kimni chiqarmaylik" tanlovi
const SKIP = '__skip__';

// Muhokama paytidagi reaksiyalar
const REACTIONS = ['🤔', '😱', '👀', '🤥', '😂', '👍', '👎', '🙏'];

// Bot o'yinchilar
const BOT_NAMES = ['Anvar', 'Dilnoza', 'Jahongir', 'Malika', 'Bobur', 'Shahzoda', 'Rustam', 'Zarina',
  'Otabek', 'Kamola', 'Sherzod', 'Nilufar', 'Feruza', 'Doston', 'Lola', 'Temur'];
// Bot gaplari soni (matnlar — public/i18n.js: bot.day.0 ...)
const BOT_LINES = { day: 8, defense: 4, lastWord: 4 };
const pickOne = (arr) => arr[crypto.randomInt(arr.length)];

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
  'guard',   // 13
  'mafia',   // 14
  'sniper',  // 15
  'wizard',  // 16
];

// Qo'lda rejimda tanlanadigan rollar (mafia — soni, qolganlari 0 yoki 1)
const CUSTOM_ROLES = ['don', 'mafia', 'lawyer', 'commissar', 'doctor', 'lover', 'bum', 'sniper', 'guard', 'kamikadze', 'wizard', 'maniac', 'jester'];

const OPTIONS = {
  dayTime: [0, 60, 90, 120, 180],  // 0 = avtomatik (tiriklar soniga qarab)
  nightTime: [15, 20, 30, 45],
  voteTime: [20, 30, 45, 60],
};

const DEFAULT_SETTINGS = {
  mode: 'auto',
  custom: { don: 1, mafia: 1, lawyer: 0, commissar: 1, doctor: 1, lover: 1, bum: 0, sniper: 0, guard: 0, kamikadze: 0, wizard: 0, maniac: 0, jester: 0 },
  dayTime: 0,
  nightTime: 20,
  voteTime: 30,
  revealRoles: true,
  lastWord: true,
  defense: true,
  listed: true,   // ochiq stollar ro'yxatida ko'rinsin (parolsiz bo'lsa)
  filter: true,   // chatda so'kinishlarni yashirish
};

function sanitizeSettings(input, prev = DEFAULT_SETTINGS) {
  const s = JSON.parse(JSON.stringify(prev));
  if (!input || typeof input !== 'object') return s;
  if (['auto', 'custom', 'classic', 'chaos'].includes(input.mode)) s.mode = input.mode;
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
  if (typeof input.defense === 'boolean') s.defense = input.defense;
  if (typeof input.listed === 'boolean') s.listed = input.listed;
  if (typeof input.filter === 'boolean') s.filter = input.filter;
  return s;
}

// "Xaos" to'plami: o'yinchilar soniga qarab shu tartibda imkon qadar ko'p rol
const CHAOS_ORDER = ['don', 'commissar', 'doctor', 'maniac', 'lover', 'jester', 'mafia', 'sniper', 'guard',
  'wizard', 'kamikadze', 'bum', 'lawyer', 'mafia', 'mafia', 'mafia'];

function buildRoles(n, settings) {
  let roles;
  if (settings.mode === 'custom') {
    roles = [];
    for (const r of CUSTOM_ROLES) for (let i = 0; i < settings.custom[r]; i++) roles.push(r);
  } else if (settings.mode === 'classic') {
    // "Klassik": faqat Don, Mafia, Komissar, Shifokor va tinch aholi
    roles = ['don', 'commissar', 'doctor'];
    const extra = n >= 14 ? 3 : n >= 11 ? 2 : n >= 8 ? 1 : 0;
    for (let i = 0; i < extra; i++) roles.push('mafia');
  } else if (settings.mode === 'chaos') {
    roles = [];
    for (const r of CHAOS_ORDER) {
      if (roles.length >= n) break;
      const team = roles.filter((x) => ROLES[x].team === 'mafia').length + (ROLES[r].team === 'mafia' ? 1 : 0);
      if (team * 2 >= n) continue; // mafia jamoasi yarmidan oshmasin
      roles.push(r);
    }
  } else {
    roles = AUTO_ORDER.slice(0, n);
  }
  while (roles.length < n) roles.push('citizen');
  return roles;
}

/** Rollar to'plami o'ynash mumkinmi? Xato ({ code, p }) yoki null */
function validateRoles(n, settings) {
  const roles = buildRoles(n, settings);
  if (roles.length > n) return { code: 'err.tooManyRoles', p: { count: roles.length, n } };
  if (!roles.some((r) => r === 'don' || r === 'mafia')) return { code: 'err.noKiller' };
  const team = roles.filter((r) => ROLES[r].team === 'mafia').length;
  if (team * 2 >= n) return { code: 'err.mafiaBig', p: { team, n } };
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
    this.spectators = [];       // tomoshabinlar (o'yin paytida kelganlar)
    this.history = [];          // o'yin xulosasi uchun: har tun va kun nima bo'lgani
    this.password = '';         // stol paroli (bo'sh — parolsiz)
    this.kickedNames = new Set();
    this.accusedId = null;      // o'zini oqlayotgan o'yinchi
    this.verdicts = {};
    this.lastVerdict = null;
  }

  // ───────── yordamchilar ─────────
  byId(id) { return this.players.find((p) => p.id === id); }
  alive() { return this.players.filter((p) => p.alive); }
  inGame() { return !['lobby', 'gameover'].includes(this.phase); }
  /** O'lim xabari oxiriga qo'shiladigan rol (agar sozlamada yoqilgan bo'lsa) */
  wasRole(p) { return this.settings.revealRoles ? p.role : null; }

  setTimer(seconds, fn) {
    clearTimeout(this.timer);
    const t = ms(seconds);
    this.endsAt = Date.now() + t;
    this.timer = setTimeout(() => {
      this.timer = null;
      // Taymer ichidagi kutilmagan xato butun serverni (barcha xonalarni) yiqitmasin
      try { fn(); } catch (e) {
        console.error(`[${this.code}] taymer xatosi (${this.phase}):`, e);
        this.addLog('log.serverError', {}, 'sys');
        this.broadcast();
      }
    }, t);
  }

  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.endsAt = null;
  }

  /** Jurnalga yozish: key — tarjima kaliti, p — parametrlar. to: null = hammaga, playerId = shaxsiy */
  addLog(key, p = {}, kind = 'sys', to = null) {
    this.log.push({ id: ++this.logId, key, p, text: uz(key, p), kind, to });
    if (this.log.length > 200) this.log.shift();
  }
  note(pl, key, p = {}) { this.addLog(key, p, 'private', pl.id); }

  // ───────── o'yinchilar ─────────
  addPlayer(name, socketId, avatar) {
    const p = {
      avatar: cleanAvatar(avatar),
      id: crypto.randomUUID(),
      token: crypto.randomBytes(16).toString('hex'),
      name, socketId, connected: true,
      role: null, alive: true, known: {}, bullets: 0,
      voice: false, voiceSession: null, // ovozli chat
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    this.addLog('log.sat', { name });
    return p;
  }

  removePlayer(p, kicked = false) {
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
        this.addLog(kicked ? 'log.kickedGame' : 'log.leftGame', { name: p.name, was: this.wasRole(p) }, 'death');
        // Ayblanuvchi chiqib ketsa — sud tugaydi, tun boshlanadi
        if (this.accusedId === p.id && ['defense', 'verdict'].includes(this.phase)) {
          this.accusedId = null;
          this.dayRecord.out = p.id;
          this.history.push(this.dayRecord);
          this.phase = 'voteResult';
          this.setTimer(TIME.voteResult, () => this.startNight());
        }
        const w = this.checkWin();
        if (w) this.endGame(w);
      }
    } else {
      this.players = this.players.filter((q) => q !== p);
      this.addLog(kicked ? 'log.kickedLobby' : 'log.stoodUp', { name: p.name });
    }
    if (this.hostId === p.id) {
      const next = this.players.find((q) => q.connected && !q.bot);
      this.hostId = next ? next.id : null;
    }
    this.broadcast();
  }

  /** Ochiq stollar ro'yxati uchun (parolli va yashirin stollar ko'rsatilmaydi) */
  publicInfo() {
    const host = this.byId(this.hostId);
    return {
      code: this.code,
      host: host ? host.name : '',
      hostAvatar: host && host.avatar ? host.avatar.e : null,
      players: this.players.length,
      humans: this.players.filter((p) => !p.bot).length,
      bots: this.players.filter((p) => p.bot).length,
      max: MAX_PLAYERS,
      inGame: this.inGame() || this.phase === 'gameover',
      round: this.round,
      spectators: this.spectators.filter((s) => s.connected).length,
      mode: this.settings.mode,
    };
  }

  // ───────── TOMOSHABINLAR ─────────
  addSpectator(name, socketId, avatar) {
    const s = {
      id: crypto.randomUUID(), token: crypto.randomBytes(16).toString('hex'),
      name, socketId, connected: true, avatar: cleanAvatar(avatar),
      spectator: true, role: null, alive: false, known: {}, bullets: 0, voice: false, voiceSession: null,
    };
    this.spectators.push(s);
    this.addLog('log.watching', { name });
    this.broadcast();
    return s;
  }

  removeSpectator(s) {
    clearTimeout(s.leaveTimer);
    this.spectators = this.spectators.filter((q) => q !== s);
    this.broadcast();
  }

  // ───────── BOTLAR ─────────
  addBot(p) {
    if (p.id !== this.hostId || this.phase !== 'lobby' || this.players.length >= MAX_PLAYERS) return;
    const used = new Set([...this.players, ...this.spectators].map((q) => q.name.toLowerCase()));
    const name = BOT_NAMES.find((n) => !used.has(n.toLowerCase())) || `Bot ${this.players.length + 1}`;
    const b = this.addPlayer(name, null, { e: '🤖', c: crypto.randomInt(AVATAR_COLORS) });
    b.bot = true;
    b.connected = true;
    this.broadcast();
  }

  /** Botning gapi: tarjima kaliti va parametrlar */
  botLine(b, kind) {
    const others = this.alive().filter((q) => q !== b);
    const x = others.length ? pickOne(others).name : '...';
    return { key: `bot.${kind}.${crypto.randomInt(BOT_LINES[kind])}`, p: { x } };
  }

  botSay(b, line) { this.sendChat(b, uz(line.key, line.p), line); }

  /** Har bir yangi vaziyatda bot bir marta "o'ylab" (1–5 s) harakat qiladi */
  runBots() {
    if (!this.inGame()) return;
    const key = `${this.phase}:${this.round}:${this.step ? this.step.key : ''}:${this.accusedId || ''}`;
    for (const b of this.players) {
      if (!b.bot || b.botKey === key) continue;
      if (!b.alive && !(this.phase === 'lastWord' && this.lastWordIds.has(b.id))) continue;
      b.botKey = key;
      const delay = 1.2 + Math.random() * 3.8;
      setTimeout(() => {
        if (b.botKey !== key || !this.players.includes(b)) return;
        try { this.botAct(b); } catch (e) { console.error(`[${this.code}] bot xatosi:`, e); }
      }, ms(delay));
    }
  }

  botVoteTarget(b, T) {
    const alive = (id) => { const q = this.byId(id); return q && q.alive; };
    // Komissar bot topgan mafiyaga ovoz beradi
    const found = T.find((id) => b.known[id] === 'mafia' && alive(id));
    if (found) return found;
    if (Math.random() < 0.1) return SKIP; // ba'zan "hech kimni chiqarmaylik"
    let pool = T;
    if (isMafia(b)) pool = T.filter((id) => !isMafia(this.byId(id))) ; // sheriklarga ovoz bermaydi
    if (!pool.length) pool = T;
    pool = pool.filter((id) => b.known[id] !== 'clean') .length ? pool.filter((id) => b.known[id] !== 'clean') : pool;
    // ko'pchilikka ergashish: eng ko'p ovoz olganni tanlash ehtimoli
    const tally = countOf(Object.values(this.votes));
    const leader = Object.keys(tally).sort((a, c) => tally[c] - tally[a]).find((id) => pool.includes(id));
    if (leader && Math.random() < 0.55) return leader;
    return pickOne(pool);
  }

  botAct(b) {
    switch (this.phase) {
      case 'night': {
        if (!this.canAct(b)) return;
        const k = this.step.key;
        const T = this.targetsFor(b);
        if (!T.length) return;
        let t = null;
        if (k === 'sniper' || k === 'kamikadze') {
          t = T.find((id) => b.known[id] === 'mafia') || null;
          if (!t && Math.random() < 0.8) return this.skip(b); // ko'r-ko'rona otmaydi
        }
        if (!t && k === 'mafia') {
          // Don Komissarni topgan bo'lsa — mafiya uni nishonga oladi
          const com = this.players.filter(isMafia).flatMap((m) => Object.keys(m.known).filter((id) => m.known[id] === 'commissar'));
          t = T.find((id) => com.includes(id)) || null;
          const donVote = Object.entries(this.night.mafiaVotes).find(([id]) => this.byId(id).role === 'don');
          if (!t && donVote && T.includes(donVote[1])) t = donVote[1]; // Don'ga ergashadi
        }
        if (!t && (k === 'commissar' || k === 'don')) {
          const fresh = T.filter((id) => !b.known[id]);
          t = fresh.length ? pickOne(fresh) : null;
        }
        if (!t && k === 'doctor' && T.includes(b.id) && Math.random() < 0.35) t = b.id;
        this.act(b, t || pickOne(T));
        return;
      }
      case 'day': {
        // Komissar bot mafiyani topgan bo'lsa — ochiqchasiga aytadi
        const exposed = Object.keys(b.known).find((id) => b.known[id] === 'mafia' && this.byId(id) && this.byId(id).alive);
        if (b.role === 'commissar' && exposed && Math.random() < 0.6) {
          this.botSay(b, { key: 'bot.comReveal', p: { name: this.byId(exposed).name } });
        } else if (Math.random() < 0.6) {
          this.botSay(b, this.botLine(b, 'day'));
        }
        setTimeout(() => {
          if (this.phase === 'day' && b.alive && !this.ready.has(b.id)) this.toggleReady(b);
        }, ms(2 + Math.random() * 5));
        return;
      }
      case 'vote': {
        const T = this.targetsFor(b);
        if (T.length) this.vote(b, this.botVoteTarget(b, T));
        return;
      }
      case 'defense':
        if (b.id === this.accusedId) {
          this.botSay(b, this.botLine(b, 'defense'));
          setTimeout(() => this.endDefense(b), ms(3 + Math.random() * 3));
        }
        return;
      case 'verdict': {
        if (b.id === this.accusedId || !b.alive) return;
        const acc = this.byId(this.accusedId);
        if (!acc) return;
        let yes = Math.random() < 0.6;
        if (isMafia(b) && isMafia(acc)) yes = false;
        if (b.known[acc.id] === 'mafia') yes = true;
        if (b.known[acc.id] === 'clean') yes = false;
        this.castVerdict(b, yes);
        return;
      }
      case 'lastWord':
        if (this.lastWordIds.has(b.id)) {
          this.botSay(b, this.botLine(b, 'lastWord'));
          setTimeout(() => this.endLastWord(b), ms(2 + Math.random() * 2));
        }
        return;
      default:
    }
  }

  setAvatar(p, avatar) {
    if (this.inGame()) return;
    p.avatar = cleanAvatar(avatar);
    this.broadcast();
  }

  updateSettings(p, input) {
    if (p.id !== this.hostId || this.phase !== 'lobby') return;
    this.settings = sanitizeSettings(input, this.settings);
    if (input && typeof input.password === 'string') this.password = input.password.trim().slice(0, 20);
    this.broadcast();
  }

  // ───────── XONA EGASI BOSHQARUVI ─────────
  transferHost(p, targetId) {
    const t = this.byId(targetId);
    if (p.id !== this.hostId || !t || t === p || !t.connected || t.bot) return;
    this.hostId = t.id;
    this.addLog('log.hostGiven', { from: p.name, to: t.name });
    this.broadcast();
  }

  /** Chiqarilgan o'yinchining socket id'sini qaytaradi (unga xabar yuborish uchun) */
  kick(p, targetId) {
    const t = this.byId(targetId);
    if (p.id !== this.hostId || !t || t === p) return null;
    const sid = t.socketId;
    this.kickedNames.add(t.name.toLowerCase());
    this.removePlayer(t, true);
    return sid;
  }

  // ───────── o'yin boshlanishi ─────────
  start(byPlayer) {
    if (byPlayer.id !== this.hostId) return { code: 'err.notHost' };
    if (this.phase !== 'lobby') return { code: 'err.started' };
    const n = this.players.length;
    if (n < MIN_PLAYERS) return { code: 'err.minPlayers', p: { min: MIN_PLAYERS } };
    const err = validateRoles(n, this.settings);
    if (err) return err;

    const roles = shuffle(buildRoles(n, this.settings));
    this.gameRoles = roles.slice();
    this.players.forEach((p, i) => {
      p.role = roles[i];
      p.alive = true;
      p.known = {};
      p.bullets = p.role === 'sniper' || p.role === 'kamikadze' ? 1 : 0;
    });
    // Mafiya a'zolari bir-birini taniydi
    const mafia = this.players.filter(isMafia);
    for (const m of mafia) for (const o of mafia) if (o !== m) m.known[o.id] = 'team';

    this.round = 0;
    this.winner = null;
    this.lastHeal = null;
    this.lastMirror = null;
    this.history = [];
    this.accusedId = null;
    this.lastVerdict = null;
    this.log = [];
    this.chat = [];
    this.addLog('log.started');
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
    this.addLog('log.night', { round: this.round }, 'night');
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
      !((a.role === 'sniper' || a.role === 'kamikadze') && a.bullets <= 0));
  }

  nextStep() {
    this.stepIndex++;
    this.stepLocked = false;
    if (this.stepIndex >= this.steps.length) return this.resolveNight();
    this.step = this.steps[this.stepIndex];

    for (const a of this.stepActors()) {
      if (a.id === this.night.blocked) this.note(a, 'note.blocked');
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
    if ((p.role === 'sniper' || p.role === 'kamikadze') && p.bullets <= 0) return false;
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
      if (k === 'wizard') return q.id !== p.id && q.id !== this.lastMirror;
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
        this.note(p, 'note.lover', { name: t.name });
        break;
      case 'don': {
        const res = t.role === 'commissar' ? 'commissar' : 'notcommissar';
        p.known[t.id] = res;
        this.night.donRes = res === 'commissar';
        this.note(p, res === 'commissar' ? 'note.donYes' : 'note.donNo', { name: t.name });
        break;
      }
      case 'lawyer':
        this.note(p, 'note.lawyer', { name: t.name });
        break;
      case 'maniac':
        this.note(p, 'note.maniac', { name: t.name });
        break;
      case 'sniper':
        p.bullets--;
        this.note(p, 'note.sniper', { name: t.name });
        break;
      case 'bum':
        this.note(p, 'note.bum', { name: t.name });
        break;
      case 'kamikadze':
        p.bullets--;
        this.note(p, 'note.kamikadze', { name: t.name });
        break;
      case 'guard':
        this.note(p, 'note.guard', { name: t.name });
        break;
      case 'wizard':
        this.note(p, 'note.wizard', { name: t.name });
        break;
      case 'doctor':
        this.note(p, 'note.doctor', { name: t.name });
        break;
      case 'commissar': {
        // Advokat himoya qilgan mafiya "toza" ko'rinadi
        const hidden = this.night.lawyer === t.id;
        const res = isMafia(t) && !hidden ? 'mafia' : 'clean';
        p.known[t.id] = res;
        this.night.comRes = { res, fooled: hidden && isMafia(t) };
        this.note(p, res === 'mafia' ? 'note.comMafia' : 'note.comClean', { name: t.name });
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

    // Hujumlar ro'yxati: kim kimga
    const attacks = [];
    if (mt) {
      const don = this.players.find((q) => q.role === 'don' && q.alive);
      const attacker = don && n.mafiaVotes[don.id] === mt ? don.id
        : Object.keys(n.mafiaVotes).find((id) => n.mafiaVotes[id] === mt) || null;
      attacks.push({ kind: 'mafia', by: attacker, t: mt });
    }
    if (n.maniac) attacks.push({ kind: 'maniac', by: n.actors.maniac, t: n.maniac });
    if (n.sniper) attacks.push({ kind: 'sniper', by: n.actors.sniper, t: n.sniper });
    if (n.kamikadze) attacks.push({ kind: 'kamikadze', by: n.actors.kamikadze, t: n.kamikadze });

    // Har bir hujum: 1) Shifokor davolasa — tirik; 2) Sehrgar ko'zgusi — hujumchi o'ladi;
    // 3) Qo'riqchi qo'riqlasa — qo'riqchi o'ladi; 4) aks holda nishon o'ladi
    const victims = new Set();
    if (n.kamikadze) victims.add(n.actors.kamikadze); // bomba egasi har doim halok bo'ladi
    let saved = false, guarded = false, mirrored = false;
    const guardId = n.guard ? n.actors.guard : null;
    for (const a of attacks) {
      if (a.t === n.doctor) { saved = true; continue; }
      if (a.t === n.wizard && a.by) {
        mirrored = true;
        if (a.by !== n.doctor) victims.add(a.by);
        continue;
      }
      if (guardId && a.t === n.guard && guardId !== a.t) {
        guarded = true;
        if (guardId !== n.doctor) victims.add(guardId);
        continue;
      }
      victims.add(a.t);
    }
    if (saved) {
      const doc = this.byId(n.actors.doctor);
      if (doc) this.note(doc, 'note.saved');
    }
    if (guarded) {
      const gp = this.byId(guardId);
      if (gp) this.note(gp, 'note.guardDied');
    }
    if (mirrored) {
      const wz = this.byId(n.actors.wizard);
      if (wz) this.note(wz, 'note.mirrored');
    }
    this.lastHeal = n.doctor || null;
    this.lastMirror = n.wizard || null;

    // Daydi: kuzatgan uyiga kim kelganini bilib oladi
    if (n.bum) {
      const bum = this.byId(n.actors.bum);
      const house = this.byId(n.bum);
      const visitors = new Set();
      for (const key of ['lover', 'don', 'lawyer', 'maniac', 'sniper', 'kamikadze', 'guard', 'wizard', 'doctor', 'commissar']) {
        if (n[key] === n.bum && n.actors[key] && n.actors[key] !== bum.id) visitors.add(this.byId(n.actors[key]).name);
      }
      if (mt === n.bum) {
        for (const [mid, t] of Object.entries(n.mafiaVotes)) if (t === n.bum) visitors.add(this.byId(mid).name);
      }
      if (visitors.size) this.note(bum, 'note.bumSaw', { house: house.name, names: [...visitors] });
      else this.note(bum, 'note.bumNone', { house: house.name });
    }

    const dead = [...victims].map((id) => this.byId(id)).filter(Boolean);
    dead.forEach((d) => { d.alive = false; });

    // O'yin xulosasi uchun: bu tun kim nima qildi
    const ev = [];
    const by = (k) => n.actors[k];
    if (n.lover) ev.push({ k: 'lover', by: by('lover'), t: n.lover });
    const mafiaVoters = Object.keys(n.mafiaVotes);
    if (mafiaVoters.length) ev.push({ k: 'mafia', by: mafiaVoters, t: mt });
    if (n.don) ev.push({ k: 'don', by: by('don'), t: n.don, res: !!n.donRes });
    if (n.lawyer) ev.push({ k: 'lawyer', by: by('lawyer'), t: n.lawyer });
    if (n.maniac) ev.push({ k: 'maniac', by: by('maniac'), t: n.maniac });
    if (n.sniper) ev.push({ k: 'sniper', by: by('sniper'), t: n.sniper });
    if (n.kamikadze) ev.push({ k: 'kamikadze', by: by('kamikadze'), t: n.kamikadze });
    if (n.guard) ev.push({ k: 'guard', by: by('guard'), t: n.guard, used: guarded });
    if (n.wizard) ev.push({ k: 'wizard', by: by('wizard'), t: n.wizard, used: mirrored });
    if (n.bum) ev.push({ k: 'bum', by: by('bum'), t: n.bum });
    if (n.doctor) ev.push({ k: 'doctor', by: by('doctor'), t: n.doctor, saved });
    if (n.commissar && n.comRes) ev.push({ k: 'commissar', by: by('commissar'), t: n.commissar, res: n.comRes.res, fooled: n.comRes.fooled });
    this.history.push({ type: 'night', round: this.round, events: ev, deaths: dead.map((d) => d.id) });

    this.addLog('log.morning', { round: this.round }, 'day');
    if (dead.length) {
      for (const d of dead) this.addLog('log.killed', { name: d.name, was: this.wasRole(d) }, 'death');
    } else {
      this.addLog('log.noDeaths', {}, 'day');
    }
    if (n.kamikadze) this.addLog('log.blast', {}, 'day');
    if (saved) this.addLog('log.saved', {}, 'day');
    if (guarded) this.addLog('log.guarded', {}, 'day');
    if (mirrored) this.addLog('log.mirrored', {}, 'day');

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
    this.addLog('log.lastWord', { names: ids.map((id) => this.byId(id).name) }, 'day');
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
    this.addLog('log.discussion', {}, 'day');
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
    this.lastVerdict = null;
    this.addLog('log.vote', {}, 'day');
    this.setTimer(this.settings.voteTime, () => this.resolveVote());
    this.broadcast();
  }

  vote(p, targetId) {
    if (this.phase !== 'vote') return;
    const ok = targetId === SKIP ? p.alive : this.targetsFor(p).includes(targetId);
    if (!ok) return;
    this.votes[p.id] = targetId;
    const voters = this.alive().filter((q) => q.connected);
    if (voters.every((q) => this.votes[q.id])) this.setTimer(2, () => this.resolveVote());
    this.broadcast();
  }

  resolveVote() {
    const tally = countOf(Object.values(this.votes));
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter((id) => tally[id] === max);
    this.dayRecord = { type: 'day', round: this.round, votes: { ...this.votes }, accused: null, out: null };
    // Ko'pchilik "hech kimni chiqarmaylik" desa — bugun hech kim chiqarilmaydi
    if (max > 0 && top.length === 1 && top[0] === SKIP) {
      this.dayRecord.skipped = true;
      this.history.push(this.dayRecord);
      this.phase = 'voteResult';
      this.addLog('log.skipped', { n: max }, 'day');
      this.setTimer(TIME.voteResult, () => this.startNight());
      return this.broadcast();
    }
    if (max > 0 && top.length === 1) {
      const acc = this.byId(top[0]);
      this.dayRecord.accused = acc.id;
      if (this.settings.defense) return this.startDefense(acc, max);
      return this.eliminate(acc, { votes: max }, false);
    }
    this.history.push(this.dayRecord);
    this.phase = 'voteResult';
    this.addLog('log.tie', {}, 'day');
    this.setTimer(TIME.voteResult, () => this.startNight());
    this.broadcast();
  }

  // ───────── O'ZINI OQLASH ─────────
  startDefense(acc, votes) {
    this.phase = 'defense';
    this.accusedId = acc.id;
    this.addLog('log.defense', { name: acc.name, votes }, 'day');
    this.setTimer(acc.connected ? TIME.defense : 2, () => this.startVerdict());
    this.broadcast();
  }

  endDefense(p) {
    if (this.phase === 'defense' && p.id === this.accusedId) this.startVerdict();
  }

  verdictVoters() { return this.alive().filter((q) => q.id !== this.accusedId); }

  startVerdict() {
    const acc = this.byId(this.accusedId);
    if (!acc || this.phase !== 'defense') return;
    this.phase = 'verdict';
    this.verdicts = {};
    this.addLog('log.verdict', { name: acc.name }, 'day');
    this.setTimer(TIME.verdict, () => this.resolveVerdict());
    this.broadcast();
  }

  castVerdict(p, yes) {
    if (this.phase !== 'verdict' || !p.alive || p.id === this.accusedId) return;
    this.verdicts[p.id] = !!yes;
    if (this.verdictVoters().filter((q) => q.connected).every((q) => q.id in this.verdicts)) {
      this.setTimer(2, () => this.resolveVerdict());
    }
    this.broadcast();
  }

  resolveVerdict() {
    if (this.phase !== 'verdict') return;
    const vals = Object.values(this.verdicts);
    const yes = vals.filter(Boolean).length;
    const no = vals.length - yes;
    const acc = this.byId(this.accusedId);
    this.lastVerdict = { yes, no };
    this.dayRecord.verdict = { yes, no };
    if (yes > no) return this.eliminate(acc, { yes, no }, true);
    this.accusedId = null;
    this.history.push(this.dayRecord);
    this.phase = 'voteResult';
    this.addLog('log.acquitted', { name: acc.name, yes, no }, 'day');
    this.setTimer(TIME.voteResult, () => this.startNight());
    this.broadcast();
  }

  /** Shahar qarori bilan chiqarish. afterDefense — o'zini oqlagan bo'lsa, oxirgi so'z berilmaydi */
  eliminate(out, info, afterDefense) {
    this.phase = 'voteResult';
    this.accusedId = null;
    out.alive = false;
    this.dayRecord.out = out.id;
    this.history.push(this.dayRecord);
    this.addLog('votes' in info ? 'log.outVotes' : 'log.outVerdict', { name: out.name, ...info, was: this.wasRole(out) }, 'death');
    if (out.role === 'jester') return this.endGame('jester');
    const w = this.checkWin();
    if (w) return this.endGame(w);
    this.setTimer(TIME.voteResult, () => (afterDefense ? this.startNight() : this.startLastWord([out.id], () => this.startNight())));
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
    this.accusedId = null;
    this.phase = 'gameover';
    this.winner = winner;
    this.addLog(`win.${winner}`, {}, 'win');
    this.broadcast();
  }

  backToLobby(p) {
    if (p.id !== this.hostId || this.phase !== 'gameover') return;
    this.players = this.players.filter((q) => q.connected);
    for (const q of this.players) { q.role = null; q.alive = true; q.known = {}; q.bullets = 0; q.botKey = null; }
    // Tomoshabinlar bo'sh o'rinlarga o'tiradi
    const waiting = this.spectators.filter((s) => s.connected);
    this.spectators = [];
    for (const s of waiting) {
      if (this.players.length >= MAX_PLAYERS) { this.spectators.push(s); continue; }
      s.spectator = false; s.alive = true; s.known = {}; s.role = null;
      this.players.push(s);
      this.addLog('log.sat', { name: s.name });
    }
    this.phase = 'lobby';
    this.winner = null;
    this.log = [];
    this.chat = [];
    this.addLog('log.newGame');
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
      case 'defense': return speaker.id === this.accusedId;
      default: return speaker.alive; // tong, kun, ovoz berish — tiriklar gapiradi, hamma eshitadi
    }
  }

  voiceFor(p) {
    const others = this.players.filter((q) => q !== p);
    let mode = 'all';
    if (this.phase === 'roles') mode = 'silent';
    else if (this.phase === 'night') mode = p.alive && isMafia(p) ? 'mafia' : 'silent';
    else if (this.phase === 'lastWord') mode = this.lastWordIds.has(p.id) ? 'lastword-speaker' : 'lastword';
    else if (this.phase === 'defense') mode = p.id === this.accusedId ? 'defense-speaker' : 'defense';
    else if (this.inGame() && !p.alive) mode = 'listen';
    return {
      mode,
      to: others.filter((q) => this.canHear(p, q)).map((q) => q.id),
      from: others.filter((q) => this.canHear(q, p)).map((q) => q.id),
    };
  }

  // ───────── REAKSIYALAR ─────────
  canReact(p) {
    if (['night', 'roles'].includes(this.phase)) return false; // tunda — uyg'oq rollar o'zini fosh qilmasin
    return !this.inGame() || p.alive;
  }

  react(p, emoji) {
    if (!REACTIONS.includes(emoji) || !this.canReact(p)) return;
    const now = Date.now();
    if (p.lastReact && now - p.lastReact < 1200) return; // tez-tez bosishdan himoya
    p.lastReact = now;
    for (const q of [...this.players, ...this.spectators]) {
      if (q.socketId) this.io.to(q.socketId).emit('reaction', { id: p.id, e: emoji });
    }
  }

  // ───────── CHAT ─────────
  chatChannel(p) {
    if (!this.inGame()) return 'all';
    if (this.phase === 'lastWord') return this.lastWordIds.has(p.id) ? 'all' : null;
    if (this.phase === 'defense') return p.id === this.accusedId ? 'all' : null;
    if (!p.alive || this.phase === 'roles') return null;
    if (this.phase === 'night') return isMafia(p) ? 'mafia' : null;
    return 'all';
  }

  /** tk — tarjima kaliti (faqat botlar uchun): har bir o'yinchi o'z tilida ko'radi */
  sendChat(p, text, tk = null) {
    text = String(text || '').trim().slice(0, 200);
    if (this.settings.filter) text = profanity.clean(text);
    const channel = this.chatChannel(p);
    if (!text || !channel) return;
    const msg = { from: p.name, fromId: p.id, text, channel, lastWord: this.phase === 'lastWord', defense: this.phase === 'defense', t: Date.now() };
    if (tk) msg.tk = { key: tk.key, p: tk.p };
    this.chat.push(msg);
    if (this.chat.length > 150) this.chat.shift();
    for (const q of [...this.players, ...this.spectators]) {
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

    const showVotes = ['vote', 'defense', 'verdict', 'voteResult'].includes(this.phase);
    const voteCounts = showVotes ? countOf(Object.values(this.votes)) : {};

    const players = this.players.map((q, seat) => {
      const showRole = q.id === p.id || over || (!q.alive && reveal) || (meMafia && isMafia(q));
      const v = {
        id: q.id, name: q.name, seat, alive: q.alive, connected: q.connected, avatar: q.avatar, bot: !!q.bot,
        role: showRole && q.role ? q.role : null,
        known: p.known[q.id] || null,
        votes: voteCounts[q.id] || 0,
        ready: this.phase === 'day' && this.ready.has(q.id),
        speaking: this.phase === 'lastWord' && this.lastWordIds.has(q.id),
        accused: ['defense', 'verdict'].includes(this.phase) && q.id === this.accusedId,
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
      skipVotes: voteCounts[SKIP] || 0,
      skipVoters: showVotes ? Object.keys(this.votes).filter((id) => this.votes[id] === SKIP) : [],
      verdict: this.phase === 'verdict'
        ? { voted: Object.keys(this.verdicts).length, total: this.verdictVoters().length }
        : this.phase === 'voteResult' ? this.lastVerdict : null,
      history: over ? this.history : null, // xulosa faqat o'yin tugagach ochiladi
      hasPassword: !!this.password,
      spectatorCount: this.spectators.filter((s) => s.connected).length,
      password: p.id === this.hostId ? this.password : undefined,
      aliveCount: this.alive().length,
      players,
      me: {
        id: p.id, role: p.role, alive: p.alive,
        awake,
        blocked: awake && this.night.blocked === p.id,
        canAct: awake && this.canAct(p),
        canSkip: awake && this.canAct(p) && !!this.step.skippable,
        noBullets: awake && (p.role === 'sniper' || p.role === 'kamikadze') && p.bullets <= 0,
        prompt: awake ? this.step.prompt : null,
        targets,
        myTarget,
        chat: this.chatChannel(p),
        lastWord: this.phase === 'lastWord' && this.lastWordIds.has(p.id),
        defense: this.phase === 'defense' && p.id === this.accusedId,
        canVerdict: this.phase === 'verdict' && p.alive && p.id !== this.accusedId,
        myVerdict: this.phase === 'verdict' && p.id in this.verdicts ? this.verdicts[p.id] : null,
        voice: this.voiceFor(p),
        canReact: this.canReact(p) && !p.spectator,
        spectator: !!p.spectator,
      },
      reactions: REACTIONS,
      log: this.log.filter((l) => l.to === null || l.to === p.id).slice(-60),
    };
  }

  /** Bir lahzadagi bir nechta o'zgarish — bitta yangilanish. Ko'p bosishlar "ko'chki"
   *  hosil qilib serverni bandlab qo'ymasligi uchun yuborish keyingi siklga qoldiriladi. */
  broadcast() {
    if (this.broadcastQueued) return;
    this.broadcastQueued = true;
    setImmediate(() => {
      this.broadcastQueued = false;
      for (const p of [...this.players, ...this.spectators]) {
        if (p.socketId) this.io.to(p.socketId).emit('state', this.viewFor(p));
      }
      this.runBots();
    });
  }
}

module.exports = { Room, ROLES, MIN_PLAYERS, MAX_PLAYERS, buildRoles, validateRoles, DEFAULT_SETTINGS };
