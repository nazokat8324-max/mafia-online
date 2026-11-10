'use strict';
/* Ovozlar va musiqa — Web Audio API bilan "jonli" yaratiladi, tashqi fayl kerak emas.
   Rejimlar: 'all' (musiqa + effektlar), 'sfx' (faqat effektlar), 'off'. */
const Sound = (() => {
  let ctx = null, master, musicBus, sfxBus, noiseBuf;
  let mode = 'all';
  try { mode = localStorage.getItem('mafia-sound') || 'all'; } catch {}
  let current = null;   // hozirgi musiqa turi
  let wanted = null;    // so'ralgan musiqa (ovoz ochilishini kutayotgan bo'lishi mumkin)
  let stopMusic = null;

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      sfxBus = ctx.createGain();
      musicBus.connect(master);
      sfxBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      applyMode();
      if (wanted) startMusic(wanted);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function applyMode() {
    if (!ctx) return;
    const t = ctx.currentTime;
    musicBus.gain.setTargetAtTime(mode === 'all' ? 0.55 : 0, t, 0.3);
    sfxBus.gain.setTargetAtTime(mode === 'off' ? 0 : 0.9, t, 0.05);
  }

  // ───────── qurilish bloklari ─────────
  function tone(freq, start, dur, o = {}) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide, start + dur);
    const vol = o.vol ?? 0.3;
    const attack = o.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(o.dest || sfxBus);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  function noise(start, dur, o = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.filterType || 'lowpass';
    f.frequency.value = o.freq || 1000;
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(o.vol ?? 0.3, start + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(start, Math.random());
    src.stop(start + dur + 0.05);
  }

  // ───────── effektlar ─────────
  const SFX = {
    start(t) { for (let i = 0; i < 6; i++) noise(t + i * 0.07, 0.06, { vol: 0.25, freq: 3000, filterType: 'bandpass' }); },
    nightfall(t) {
      tone(440, t, 1.8, { type: 'triangle', vol: 0.18, glide: 110 });
      tone(98, t + 0.4, 3.5, { vol: 0.35, attack: 0.05 });
      tone(146.8, t + 0.4, 3.5, { vol: 0.14, attack: 0.05 });
      tone(196.6, t + 0.4, 3.5, { vol: 0.08, attack: 0.05 });
    },
    wake(t) { [880, 1318.5, 1760].forEach((f, i) => tone(f, t + i * 0.13, 1.4, { vol: 0.16 })); },
    morning(t) { [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, t + i * 0.15, 1.1, { type: 'triangle', vol: 0.15 })); },
    death(t) {
      tone(80, t, 2, { vol: 0.6, glide: 32 });
      noise(t, 0.6, { vol: 0.35, freq: 300 });
      tone(233, t + 0.1, 1.5, { type: 'triangle', vol: 0.08, glide: 220 });
    },
    gavel(t) {
      for (const d of [0, 0.28]) {
        noise(t + d, 0.09, { vol: 0.7, freq: 1800, filterType: 'bandpass', q: 2 });
        tone(160, t + d, 0.18, { vol: 0.45, glide: 90 });
      }
    },
    tick(t) { tone(1200, t, 0.05, { type: 'square', vol: 0.07 }); },
    select(t) { tone(660, t, 0.1, { type: 'triangle', vol: 0.2 }); tone(990, t + 0.05, 0.12, { type: 'triangle', vol: 0.12 }); },
    pop(t) { tone(880, t, 0.07, { vol: 0.07 }); },
    shot(t) { noise(t, 0.35, { vol: 0.8, freq: 2500 }); tone(120, t, 0.3, { vol: 0.5, glide: 40 }); },
    win(t) { [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => tone(f, t + i * 0.12, i === 4 ? 1.8 : 0.5, { type: 'triangle', vol: 0.18 })); },
    lose(t) { [392, 329.6, 261.6, 196].forEach((f, i) => tone(f, t + i * 0.28, i === 3 ? 2 : 0.6, { type: 'triangle', vol: 0.16 })); },
  };

  function play(name) {
    if (!ctx || mode === 'off' || !SFX[name]) return;
    SFX[name](ctx.currentTime + 0.02);
  }

  // ───────── musiqa ─────────
  function nightMusic() {
    const timers = [];
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
    bus.connect(musicBus);

    // Shamol: filtrlangan shovqin, chastotasi sekin "suzadi"
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 400; wf.Q.value = 3;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08; lfoGain.gain.value = 250;
    lfo.connect(lfoGain); lfoGain.connect(wf.frequency);
    const wg = ctx.createGain(); wg.gain.value = 0.12;
    wind.connect(wf); wf.connect(wg); wg.connect(bus);
    wind.start(); lfo.start();

    // Sekin minor akkordlar: Am – F – Dm – E
    const chords = [[110, 220, 261.6, 329.6], [87.3, 174.6, 220, 261.6], [73.4, 146.8, 174.6, 220], [82.4, 164.8, 207.7, 246.9]];
    let i = 0;
    const playChord = () => {
      const t = ctx.currentTime + 0.05;
      chords[i++ % chords.length].forEach((f, j) =>
        tone(f, t, 7.5, { type: j === 0 ? 'sine' : 'triangle', vol: j === 0 ? 0.12 : 0.045, attack: 2.5, dest: bus }));
    };
    playChord();
    timers.push(setInterval(playChord, 6500));

    // Chigirtkalar
    timers.push(setInterval(() => {
      if (Math.random() < 0.5) return;
      const t = ctx.currentTime + Math.random();
      const f = 4200 + Math.random() * 800;
      for (let k = 0; k < 3; k++) tone(f, t + k * 0.07, 0.05, { vol: 0.02, dest: bus });
    }, 1400));

    return () => {
      timers.forEach(clearInterval);
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0.0001, t + 1.5);
      setTimeout(() => { try { wind.stop(); lfo.stop(); bus.disconnect(); } catch {} }, 1700);
    };
  }

  function voteMusic() {
    // Yurak urishi: tez-tez ikki marta past "dum-dum"
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(musicBus);
    const beat = () => {
      const t = ctx.currentTime + 0.05;
      tone(55, t, 0.25, { vol: 0.5, dest: bus, glide: 40 });
      tone(55, t + 0.22, 0.3, { vol: 0.35, dest: bus, glide: 38 });
    };
    beat();
    const iv = setInterval(beat, 1000);
    return () => { clearInterval(iv); setTimeout(() => bus.disconnect(), 800); };
  }

  function startMusic(kind) {
    if (stopMusic) { stopMusic(); stopMusic = null; }
    current = kind;
    if (!ctx || !kind) return;
    stopMusic = kind === 'night' ? nightMusic() : kind === 'vote' ? voteMusic() : null;
  }

  function music(kind) {
    wanted = kind;
    if (kind === current && (stopMusic || !ctx)) return;
    startMusic(kind);
  }

  function cycle() {
    mode = mode === 'all' ? 'sfx' : mode === 'sfx' ? 'off' : 'all';
    try { localStorage.setItem('mafia-sound', mode); } catch {}
    unlock();
    applyMode();
    return mode;
  }

  return { unlock, play, music, cycle, get mode() { return mode; } };
})();

// Brauzerlar ovozni faqat foydalanuvchi bosgandan keyin ruxsat beradi
['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  document.addEventListener(ev, () => Sound.unlock(), { passive: true }));
