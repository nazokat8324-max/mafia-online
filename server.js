'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Room, ROLES, MAX_PLAYERS } = require('./game');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.send('ok')); // Render tekshiruvi uchun
const server = http.createServer(app);
const io = new Server(server);

// Ovozli chat uchun ICE serverlar. TURN server qo'shish uchun Render'da
// TURN_URL, TURN_USER, TURN_PASS muhit o'zgaruvchilarini kiriting.
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (process.env.TURN_URL) {
  ICE_SERVERS.push({
    urls: process.env.TURN_URL.split(','),
    username: process.env.TURN_USER,
    credential: process.env.TURN_PASS,
  });
}

/** code -> Room */
const rooms = new Map();

function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => abc[crypto.randomInt(abc.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

/** Hamma chiqib ketgan xonani 10 daqiqadan keyin o'chiramiz */
function scheduleCleanup(room) {
  clearTimeout(room.cleanupTimer);
  if (room.players.some((p) => p.connected)) return;
  room.cleanupTimer = setTimeout(() => {
    if (!room.players.some((p) => p.connected)) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
    }
  }, 10 * 60 * 1000);
}

function attach(socket, room, player) {
  socket.data.room = room;
  socket.data.player = player;
  player.socketId = socket.id;
  player.connected = true;
  if (!room.hostId || !room.players.some((q) => q.id === room.hostId && q.connected)) room.hostId = player.id;
  clearTimeout(player.leaveTimer);
  clearTimeout(room.cleanupTimer);
  socket.emit('chatHistory', room.chatHistoryFor(player));
  room.broadcast();
}

io.on('connection', (socket) => {
  socket.emit('roles', ROLES);
  socket.emit('ice', ICE_SERVERS);

  socket.on('create', ({ name, avatar } = {}, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    name = cleanName(name);
    if (!name) return cb({ error: 'Ismingizni kiriting' });
    const room = new Room(newCode(), io);
    rooms.set(room.code, room);
    const p = room.addPlayer(name, socket.id, avatar);
    cb({ code: room.code, token: p.token });
    attach(socket, room, p);
  });

  socket.on('join', ({ code, name, avatar, password } = {}, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    name = cleanName(name);
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!name) return cb({ error: 'Ismingizni kiriting' });
    if (!room) return cb({ error: 'Bunday xona topilmadi' });
    if (room.phase !== 'lobby') return cb({ error: "Bu xonada o'yin allaqachon boshlangan" });
    if (room.players.length >= MAX_PLAYERS) return cb({ error: "Stol to'la" });
    if (room.kickedNames.has(name.toLowerCase())) return cb({ error: 'Xona egasi sizni bu stoldan chiqargan' });
    if (room.password && String(password || '').trim() !== room.password) {
      return cb({ error: password ? "Parol noto'g'ri" : 'Bu stol parol bilan himoyalangan', needPassword: true });
    }
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return cb({ error: 'Bu ism band, boshqasini tanlang' });
    }
    const p = room.addPlayer(name, socket.id, avatar);
    cb({ code: room.code, token: p.token });
    attach(socket, room, p);
  });

  // Sahifa yangilansa yoki internet uzilib qolsa — o'sha o'ringa qaytish
  socket.on('resume', ({ code, token } = {}, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const room = rooms.get(code);
    const p = room && room.players.find((q) => q.token === token);
    if (!p) return cb({ error: 'Sessiya topilmadi' });
    cb({ code: room.code, token: p.token });
    attach(socket, room, p);
  });

  // Har bir hodisa xatolardan himoyalangan: noto'g'ri xabar serverni yiqitmasin
  const withPlayer = (fn) => (...args) => {
    const { room, player } = socket.data;
    if (!room || !player || !room.players.includes(player)) return;
    try { fn(room, player, ...args); } catch (e) { console.error('Xato:', e); }
  };

  socket.on('start', withPlayer((room, p, ...args) => {
    const cb = args.find((a) => typeof a === 'function');
    const err = room.start(p);
    if (cb) cb({ error: err });
  }));
  socket.on('act', withPlayer((room, p, targetId) => room.act(p, targetId)));
  socket.on('vote', withPlayer((room, p, targetId) => room.vote(p, targetId)));
  socket.on('skip', withPlayer((room, p) => room.skip(p)));
  socket.on('react', withPlayer((room, p, e) => room.react(p, e)));
  socket.on('endDefense', withPlayer((room, p) => room.endDefense(p)));
  socket.on('verdict', withPlayer((room, p, yes) => room.castVerdict(p, yes)));
  socket.on('transferHost', withPlayer((room, p, id) => room.transferHost(p, id)));
  socket.on('kick', withPlayer((room, p, id) => {
    const sid = room.kick(p, id);
    const target = sid && io.sockets.sockets.get(sid);
    if (target) { target.data = {}; target.emit('kicked'); }
    scheduleCleanup(room);
  }));
  socket.on('ready', withPlayer((room, p) => room.toggleReady(p)));
  socket.on('settings', withPlayer((room, p, s) => room.updateSettings(p, s)));
  socket.on('endLastWord', withPlayer((room, p) => room.endLastWord(p)));
  socket.on('chat', withPlayer((room, p, text) => room.sendChat(p, text)));
  socket.on('lobby', withPlayer((room, p) => room.backToLobby(p)));
  socket.on('avatar', withPlayer((room, p, a) => room.setAvatar(p, a)));

  // Ovozli chat: qo'shilish/chiqish va WebRTC signallarini uzatish
  socket.on('voice', withPlayer((room, p, on) => room.setVoice(p, on)));
  socket.on('rtc', withPlayer((room, p, msg) => {
    if (!msg || typeof msg !== 'object') return;
    const target = room.byId(msg.to);
    if (!target || !target.socketId || !p.voice || !target.voice) return;
    io.to(target.socketId).emit('rtc', { from: p.id, data: msg.data });
  }));
  socket.on('leave', withPlayer((room, p) => {
    room.removePlayer(p);
    socket.data = {};
    scheduleCleanup(room);
  }));

  socket.on('disconnect', withPlayer((room, p) => {
    if (p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    p.voice = false;
    p.voiceSession = null;
    if (room.hostId === p.id) {
      const next = room.players.find((q) => q.connected);
      if (next) room.hostId = next.id;
    }
    // Lobbida 20 soniya ichida qaytmasa — stoldan turadi
    if (room.phase === 'lobby') {
      p.leaveTimer = setTimeout(() => {
        if (!p.connected && room.players.includes(p)) room.removePlayer(p);
      }, 20000);
    }
    room.broadcast();
    scheduleCleanup(room);
  }));
});

server.listen(PORT, () => {
  console.log(`🌙 Mafia serveri ishga tushdi: http://localhost:${PORT}`);
});
