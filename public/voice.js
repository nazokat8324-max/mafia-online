'use strict';
/* Ovozli chat — WebRTC (o'yinchilar o'rtasida to'g'ridan-to'g'ri, "mesh").
   Server faqat signallarni uzatadi va kim kimni eshitishini belgilaydi (state.me.voice).
   Taqiq ikki tomonda qo'llanadi:
     • jo'natuvchi — ruxsat yo'q odamga mikrofon treki umuman yuborilmaydi (replaceTrack(null));
     • qabul qiluvchi — ruxsat yo'q odamning ovozi o'chirib qo'yiladi. */
const Voice = (() => {
  let socket = null;
  let onChange = () => {};
  let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];

  let enabled = false;      // ovozli chatga qo'shilganmi
  let muted = false;        // o'z mikrofonini o'chirganmi
  let micStream = null;
  let micTrack = null;
  let myId = null;
  let mySession = null;
  let allowedTo = new Set();
  let allowedFrom = new Set();
  let mode = 'all';

  const peers = new Map();  // playerId -> peer
  let actx = null;
  const meters = new Map(); // playerId -> { analyser, buf }
  const talking = new Set();

  // ───────── qo'shilish / chiqish ─────────
  async function join() {
    if (enabled) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micTrack = micStream.getAudioTracks()[0];
    } catch (e) {
      micStream = null;
      micTrack = null;
      onChange("Mikrofonga ruxsat berilmadi — siz faqat tinglaysiz");
    }
    enabled = true;
    muted = false;
    ensureAudioContext();
    if (micStream) addMeter(myId || 'me', micStream);
    try { sessionStorage.setItem('mafia-voice', '1'); } catch {}
    socket.emit('voice', true);
    onChange();
  }

  function leave() {
    if (!enabled) return;
    enabled = false;
    socket.emit('voice', false);
    for (const id of [...peers.keys()]) closePeer(id);
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    micTrack = null;
    meters.clear();
    talking.clear();
    try { sessionStorage.removeItem('mafia-voice'); } catch {}
    onChange();
  }

  function toggleMute() {
    if (!enabled || !micTrack) return;
    muted = !muted;
    applyGates();
    onChange();
  }

  // ───────── server holati bilan moslash ─────────
  function sync(state) {
    myId = state.me.id;
    const v = state.me.voice || { to: [], from: [], mode: 'silent' };
    allowedTo = new Set(v.to);
    allowedFrom = new Set(v.from);
    mode = v.mode;
    const me = state.players.find((p) => p.id === myId);

    // Sahifa yangilangandan keyin avtomatik qayta qo'shilish
    if (!enabled) {
      let wantVoice = false;
      try { wantVoice = sessionStorage.getItem('mafia-voice') === '1'; } catch {}
      if (wantVoice && !join.pending) { join.pending = true; join().finally(() => { join.pending = false; }); }
      return;
    }
    if (!me || !me.voice) return; // server hali qo'shilganimizni ko'rmagan
    mySession = me.voiceSession;

    const others = state.players.filter((p) => p.id !== myId && p.voice && p.connected);
    for (const [id, peer] of peers) {
      const o = others.find((p) => p.id === id);
      if (!o || o.voiceSession !== peer.session || peer.mySession !== mySession) closePeer(id);
    }
    // Ulanishni har doim id'si kichik o'yinchi boshlaydi — ikki tomon bir vaqtda boshlamasligi uchun
    for (const o of others) {
      if (!peers.has(o.id) && myId < o.id) createPeer(o.id, o.voiceSession, true);
    }
    applyGates();
  }

  // ───────── WebRTC ulanishlari ─────────
  function createPeer(id, session, initiator) {
    const pc = new RTCPeerConnection({ iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    const peer = { id, pc, session, mySession, audio, sender: null, pendingIce: [], sentTrack: undefined };
    peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('rtc', { to: id, data: { type: 'ice', candidate: e.candidate, session: mySession } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      audio.srcObject = stream;
      audio.play().catch(() => {});
      addMeter(id, stream);
      applyGates();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        closePeer(id); // keyingi sync'da qayta ulanadi
        onChange();
      }
    };

    if (initiator) {
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      peer.sender = tr.sender;
      applyGate(peer);
      (async () => {
        await pc.setLocalDescription(await pc.createOffer());
        socket.emit('rtc', { to: id, data: { type: 'offer', sdp: pc.localDescription, session: mySession } });
      })().catch((e) => console.warn('offer xatosi', e));
    }
    return peer;
  }

  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch {}
    peer.audio.srcObject = null;
    peers.delete(id);
    meters.delete(id);
    talking.delete(id);
  }

  async function flushIce(peer) {
    for (const c of peer.pendingIce.splice(0)) {
      try { await peer.pc.addIceCandidate(c); } catch {}
    }
  }

  async function onSignal({ from, data }) {
    if (!enabled || !data || !mySession) return;
    let peer = peers.get(from);
    try {
      if (data.type === 'offer') {
        if (peer && peer.session !== data.session) { closePeer(from); peer = null; }
        if (!peer) peer = createPeer(from, data.session, false);
        await peer.pc.setRemoteDescription(data.sdp);
        const tr = peer.pc.getTransceivers()[0];
        if (tr) { tr.direction = 'sendrecv'; peer.sender = tr.sender; peer.sentTrack = undefined; applyGate(peer); }
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        socket.emit('rtc', { to: from, data: { type: 'answer', sdp: peer.pc.localDescription, session: mySession } });
        await flushIce(peer);
      } else if (data.type === 'answer') {
        if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription(data.sdp);
        await flushIce(peer);
      } else if (data.type === 'ice') {
        if (!peer || peer.session !== data.session) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.pendingIce.push(data.candidate);
      }
    } catch (e) {
      console.warn('signal xatosi', e);
    }
  }

  // ───────── kim kimni eshitadi ─────────
  function applyGate(peer) {
    const send = allowedTo.has(peer.id) && !muted && micTrack ? micTrack : null;
    if (peer.sender && peer.sentTrack !== send) {
      peer.sentTrack = send;
      peer.sender.replaceTrack(send).catch(() => {});
    }
    peer.audio.muted = !allowedFrom.has(peer.id);
  }
  function applyGates() { for (const peer of peers.values()) applyGate(peer); }

  // ───────── kim gapirayotganini aniqlash ─────────
  function ensureAudioContext() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === 'suspended') actx.resume();
  }

  function addMeter(id, stream) {
    if (!actx) return;
    try {
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser); // karnayga ulanmaydi — faqat o'lchash uchun
      meters.set(id, { analyser, buf: new Uint8Array(analyser.fftSize) });
    } catch {}
  }

  function level(m) {
    m.analyser.getByteTimeDomainData(m.buf);
    let sum = 0;
    for (const v of m.buf) { const x = (v - 128) / 128; sum += x * x; }
    return Math.sqrt(sum / m.buf.length);
  }

  setInterval(() => {
    if (!enabled) return;
    for (const [key, m] of meters) {
      const id = key === 'me' ? myId : key;
      let on = level(m) > 0.04;
      if (id === myId) on = on && !muted && allowedTo.size > 0;
      else on = on && allowedFrom.has(id);
      const seat = document.querySelector(`.seat[data-id="${id}"]`);
      if (seat) seat.classList.toggle('talking', on);
      if (on) talking.add(id); else talking.delete(id);
    }
  }, 120);

  // Brauzer ovozni faqat bosishdan keyin ruxsat beradi
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => {
    if (actx && actx.state === 'suspended') actx.resume();
    for (const p of peers.values()) if (p.audio.paused && p.audio.srcObject) p.audio.play().catch(() => {});
  }, { passive: true }));

  function init(sock, changeCb) {
    socket = sock;
    onChange = changeCb;
    socket.on('ice', (list) => { if (Array.isArray(list) && list.length) iceServers = list; });
    socket.on('rtc', onSignal);
    // Internet uzilsa — ulanishlar yangidan quriladi
    socket.on('disconnect', () => {
      for (const id of [...peers.keys()]) closePeer(id);
      if (enabled) { enabled = false; if (micStream) micStream.getTracks().forEach((t) => t.stop()); micStream = null; micTrack = null; meters.clear(); }
    });
  }

  return {
    init, join, leave, toggleMute, sync,
    get enabled() { return enabled; },
    get muted() { return muted; },
    get hasMic() { return !!micTrack; },
    get mode() { return mode; },
    get canSpeak() { return allowedTo.size > 0; },
    get supported() { return !!(window.RTCPeerConnection && navigator.mediaDevices); },
    debug: () => ({ peers: [...peers.values()].map((p) => ({ id: p.id, state: p.pc.connectionState, sending: !!p.sentTrack, mutedIn: p.audio.muted })), talking: [...talking] }),
  };
})();
