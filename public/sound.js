'use strict';
/* Ovozlar va musiqa — Web Audio API bilan "jonli" yaratiladi, tashqi fayl kerak emas.
   Rejimlar: 'all' (musiqa + effektlar), 'sfx' (faqat effektlar), 'off'.
   Uslubga qarab ikki xil ovoz: neon (sintezator) va noir (1930-yillar jazzi). */
const Sound = (() => {
  let ctx = null, master, musicBus, sfxBus, noiseBuf;
  let mode = 'all';
  try { mode = localStorage.getItem('mafia-sound') || 'all'; } catch {}
  let currentKey = null; // hozir chalinayotgan musiqa: "turi:uslub"
  let wanted = null;     // so'ralgan musiqa (ovoz ochilishini kutayotgan bo'lishi mumkin)
  let stopMusic = null;

  const theme = () => (document.documentElement.dataset.theme === 'noir' ? 'noir' : 'neon');

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

  /** Filtrli "jonli" cholg'u: saksofon, karnay, kontrabas uchun */
  function horn(freq, start, dur, o = {}) {
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sawtooth';
    osc.frequency.setValueAtTime(freq, start);
    if (o.bend) osc.frequency.linearRampToValueAtTime(freq * o.bend, start + dur);
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5.2;
      lg.gain.setValueAtTime(0, start);
      lg.gain.linearRampToValueAtTime(freq * 0.012, start + Math.min(0.35, dur * 0.6));
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(start); lfo.stop(start + dur + 0.1);
    }
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.cutoff || 1400, start);
    if (o.wah) { // sumkali karnay: filtr ochilib-yopiladi
      f.frequency.setValueAtTime(350, start);
      f.frequency.linearRampToValueAtTime(1700, start + dur * 0.35);
      f.frequency.linearRampToValueAtTime(450, start + dur);
    }
    const g = ctx.createGain();
    const vol = o.vol ?? 0.1;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(vol, start + (o.attack ?? 0.05));
    g.gain.setValueAtTime(vol, start + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  /** Elektr pianino (Rhodes'ga o'xshash) notasi */
  function keys(freq, start, dur, vol, dest) {
    tone(freq, start, dur, { vol, attack: 0.008, dest });
    tone(freq * 2, start, dur * 0.5, { vol: vol * 0.25, attack: 0.005, dest });
    tone(freq * 3.01, start, dur * 0.2, { vol: vol * 0.08, attack: 0.003, dest });
  }

  // ───────── NEON effektlari ─────────
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

  // ───────── NOIR effektlari (1930-yillar) ─────────
  const typeKey = (t, vol = 0.35) => {
    noise(t, 0.025, { vol, freq: 2400, filterType: 'highpass' });
    noise(t + 0.012, 0.05, { vol: vol * 0.5, freq: 900, filterType: 'bandpass', q: 3 });
  };
  const bell = (t, vol = 0.18) => {
    tone(2093, t, 1.6, { vol, attack: 0.002 });
    tone(4186, t, 0.9, { vol: vol * 0.35, attack: 0.002 });
    tone(3135, t, 1.2, { vol: vol * 0.2, attack: 0.002 });
  };
  const gunshot = (t, vol = 0.9) => {
    noise(t, 0.18, { vol, freq: 4000, attack: 0.001 });
    tone(110, t, 0.35, { vol: vol * 0.8, glide: 38, attack: 0.001 });
    noise(t + 0.05, 1.4, { vol: vol * 0.16, freq: 700, attack: 0.02 }); // ko'chadagi aks-sado
  };
  const SFX_NOIR = {
    nightfall(t) {
      [587.3, 440, 349.2, 293.7, 220].forEach((f, i) => keys(f, t + i * 0.2, 1.6, 0.09));
      tone(73.4, t + 0.9, 3, { vol: 0.3, attack: 0.02 });
      tone(110, t + 0.9, 3, { vol: 0.08, attack: 0.02 });
    },
    wake(t) { // vibrafon
      [587.3, 698.5, 880, 1174.7].forEach((f, i) => {
        tone(f, t + i * 0.11, 1.8, { vol: 0.12, attack: 0.003 });
        tone(f * 4, t + i * 0.11, 0.25, { vol: 0.02, attack: 0.002 });
      });
    },
    morning(t) {
      bell(t);
      [174.6, 220, 261.6, 329.6, 392].forEach((f) => keys(f, t + 0.35, 2.2, 0.07));
    },
    death(t) { gunshot(t); },
    shot(t) { gunshot(t, 1); tone(2400, t + 0.12, 0.5, { vol: 0.06, glide: 900 }); }, // rikoshet
    gavel(t) {
      for (const d of [0, 0.3]) {
        noise(t + d, 0.07, { vol: 0.75, freq: 1500, filterType: 'bandpass', q: 2.5 });
        tone(140, t + d, 0.16, { vol: 0.5, glide: 80 });
      }
    },
    tick(t) { tone(1500, t, 0.03, { vol: 0.12, attack: 0.001 }); noise(t, 0.02, { vol: 0.2, freq: 2500, filterType: 'bandpass', q: 4 }); },
    select(t) { typeKey(t); },
    pop(t) { typeKey(t, 0.18); },
    start(t) { for (let i = 0; i < 7; i++) typeKey(t + i * 0.06 + Math.random() * 0.02, 0.3); bell(t + 0.5, 0.12); },
    win(t) { // big-band karnaylari
      const chord = [261.6, 329.6, 392, 440, 523.3];
      chord.forEach((f) => horn(f, t, 0.28, { vol: 0.07, attack: 0.015, cutoff: 2600 }));
      chord.forEach((f) => horn(f * 1.0595, t + 0.32, 0.22, { vol: 0.06, attack: 0.015, cutoff: 2600 }));
      chord.forEach((f) => horn(f, t + 0.58, 1.6, { vol: 0.07, attack: 0.02, cutoff: 2400, vibrato: true }));
      noise(t + 0.58, 1.2, { vol: 0.08, freq: 8000, filterType: 'highpass' }); // tarelka
    },
    lose(t) { // "va-va-va-vaaa"
      [392, 370, 349.2].forEach((f, i) => horn(f, t + i * 0.5, 0.45, { vol: 0.13, wah: true, attack: 0.04 }));
      horn(329.6, t + 1.5, 1.6, { vol: 0.13, wah: true, vibrato: true, attack: 0.04, bend: 0.97 });
    },
  };

  function play(name) {
    if (!ctx || mode === 'off') return;
    const fx = (theme() === 'noir' && SFX_NOIR[name]) || SFX[name];
    if (fx) fx(ctx.currentTime + 0.02);
  }

  // ───────── NEON musiqasi ─────────
  function makeBus(fadeIn = 3) {
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeIn);
    bus.connect(musicBus);
    return bus;
  }
  function fadeOut(bus, extra = () => {}) {
    const t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(0.0001, t + 1.5);
    setTimeout(() => { try { extra(); bus.disconnect(); } catch {} }, 1700);
  }

  function nightMusic() {
    const timers = [];
    const bus = makeBus();

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

    return () => { timers.forEach(clearInterval); fadeOut(bus, () => { wind.stop(); lfo.stop(); }); };
  }

  function voteMusic() {
    // Yurak urishi: tez-tez ikki marta past "dum-dum"
    const bus = makeBus(0.05);
    const beat = () => {
      const t = ctx.currentTime + 0.05;
      tone(55, t, 0.25, { vol: 0.5, dest: bus, glide: 40 });
      tone(55, t + 0.22, 0.3, { vol: 0.35, dest: bus, glide: 38 });
    };
    beat();
    const iv = setInterval(beat, 1000);
    return () => { clearInterval(iv); fadeOut(bus); };
  }

  // ───────── NOIR musiqasi: sekin tungi jazz ─────────
  /** Grammofon plastinkasining shitirlashi */
  function vinyl(bus) {
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuf;
    hiss.loop = true;
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass'; hf.frequency.value = 3000; hf.Q.value = 0.5;
    const hg = ctx.createGain(); hg.gain.value = 0.012;
    hiss.connect(hf); hf.connect(hg); hg.connect(bus);
    hiss.start();
    const iv = setInterval(() => {
      const t = ctx.currentTime;
      for (let k = 0; k < 3; k++) {
        if (Math.random() < 0.35) noise(t + Math.random() * 0.1, 0.004, { vol: 0.03 + Math.random() * 0.07, freq: 2000, filterType: 'highpass', attack: 0.0005, dest: bus });
      }
    }, 100);
    return () => { clearInterval(iv); try { hiss.stop(); } catch {} };
  }

  function noirNightMusic() {
    const bus = makeBus(2.5);
    const stopVinyl = vinyl(bus);
    const beat = 60 / 74;           // ~74 urish/daqiqa
    const swing = beat * 0.66;      // "swing" — ikkinchi sakkizlik kechikib chalinadi
    // Dm9 – Gm9 – Em7b5 – A7b9 (re minorda klassik "ii–V–i" aylanasi)
    const BARS = [
      { bass: [73.4, 87.3, 110, 103.8], chord: [174.6, 220, 261.6, 329.6] },
      { bass: [98, 116.5, 146.8, 87.3], chord: [233.1, 293.7, 349.2, 440] },
      { bass: [82.4, 98, 116.5, 103.8], chord: [196, 233.1, 293.7, 349.2] },
      { bass: [110, 138.6, 164.8, 77.8], chord: [196, 277.2, 329.6, 466.2] },
    ];
    const BLUES = [293.7, 349.2, 392, 415.3, 440, 523.3, 587.3, 698.5]; // re minor blyuz gammasi
    let bar = 0;
    let next = ctx.currentTime + 0.3;

    const scheduleBar = () => {
      if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
      const t0 = next;
      const b = BARS[bar % BARS.length];
      // kontrabas: har urishda bitta "yuruvchi" nota
      b.bass.forEach((f, i) => {
        const t = t0 + i * beat;
        tone(f, t, beat * 0.95, { vol: 0.32, attack: 0.008, dest: bus });
        tone(f * 2, t, 0.12, { vol: 0.05, attack: 0.004, dest: bus }); // tor "chertilishi"
      });
      // cho'tkali baraban va "ride" tarelka
      for (let i = 0; i < 4; i++) {
        const t = t0 + i * beat;
        noise(t, 0.18, { vol: i % 2 ? 0.05 : 0.025, freq: 2500, filterType: 'bandpass', q: 0.7, attack: 0.03, dest: bus });
        noise(t, 0.25, { vol: 0.022, freq: 7000, filterType: 'highpass', dest: bus });
        if (i % 2) noise(t + swing, 0.12, { vol: 0.016, freq: 7000, filterType: 'highpass', dest: bus });
      }
      // pianino jo'rligi: sinkopali akkordlar
      const comp = [swing, 2 * beat + (Math.random() < 0.5 ? 0 : swing)];
      for (const off of comp) b.chord.forEach((f) => keys(f, t0 + off, beat * 1.4, 0.035, bus));
      // saksofon: har ikkinchi taktda blyuz iborasi
      if (bar % 2 === 1 || Math.random() < 0.25) {
        let t = t0 + beat * (Math.random() < 0.5 ? 0.5 : 1);
        let idx = 2 + Math.floor(Math.random() * 4);
        const n = 3 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n && t < t0 + beat * 3.6; k++) {
          const dur = Math.random() < 0.4 ? beat * 1.2 : beat * 0.5;
          idx = Math.max(0, Math.min(BLUES.length - 1, idx + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
          horn(BLUES[idx], t, dur, { vol: 0.045, attack: 0.07, cutoff: 1300, vibrato: dur > beat, bend: k === n - 1 ? 0.985 : 1, dest: bus });
          t += dur + (Math.random() < 0.3 ? swing * 0.5 : 0);
        }
      }
      bar++;
      next = t0 + 4 * beat;
    };
    scheduleBar();
    const iv = setInterval(scheduleBar, 4 * beat * 1000);
    return () => { clearInterval(iv); fadeOut(bus, stopVinyl); };
  }

  function noirVoteMusic() {
    // soat "tik-tak"i va tarang kontrabas
    const bus = makeBus(0.05);
    const stopVinyl = vinyl(bus);
    let n = 0;
    const tick = () => {
      const t = ctx.currentTime + 0.05;
      const hi = n % 2 === 0;
      tone(hi ? 1500 : 1150, t, 0.03, { vol: 0.1, attack: 0.001, dest: bus });
      noise(t, 0.02, { vol: 0.12, freq: hi ? 2600 : 2000, filterType: 'bandpass', q: 5, dest: bus });
      if (n % 4 === 0) tone(n % 8 === 0 ? 73.4 : 77.8, t, 1.6, { vol: 0.3, attack: 0.01, dest: bus });
      n++;
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => { clearInterval(iv); fadeOut(bus, stopVinyl); };
  }

  function startMusic(kind) {
    if (stopMusic) { stopMusic(); stopMusic = null; }
    currentKey = kind ? `${kind}:${theme()}` : null;
    if (!ctx || !kind) return;
    const noir = theme() === 'noir';
    if (kind === 'night') stopMusic = noir ? noirNightMusic() : nightMusic();
    else if (kind === 'vote') stopMusic = noir ? noirVoteMusic() : voteMusic();
  }

  function music(kind) {
    wanted = kind;
    const key = kind ? `${kind}:${theme()}` : null;
    if (key === currentKey && (stopMusic || !ctx || !kind)) return;
    startMusic(kind);
  }

  /** Uslub almashganda musiqani yangi uslubda qayta boshlash */
  function refresh() { music(wanted); }

  function cycle() {
    mode = mode === 'all' ? 'sfx' : mode === 'sfx' ? 'off' : 'all';
    try { localStorage.setItem('mafia-sound', mode); } catch {}
    unlock();
    applyMode();
    return mode;
  }

  /** Sinash uchun: musiqani bir necha soniya chalib ko'rish */
  function preview(kind, seconds = 8) {
    unlock();
    const prev = wanted;
    startMusic(kind);
    setTimeout(() => { if (currentKey === `${kind}:${theme()}`) startMusic(prev); }, seconds * 1000);
  }

  return { unlock, play, music, refresh, cycle, preview, get mode() { return mode; } };
})();

// Brauzerlar ovozni faqat foydalanuvchi bosgandan keyin ruxsat beradi
['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  document.addEventListener(ev, () => Sound.unlock(), { passive: true }));
