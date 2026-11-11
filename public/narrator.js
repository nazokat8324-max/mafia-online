'use strict';
/* Diktor — brauzerning o'z nutq sintezatori (speechSynthesis) bilan stol boshidagi
   boshlovchi kabi e'lon qiladi. Faqat hammaga ochiq ma'lumotni o'qiydi.
   O'zbek ovozi kam qurilmada bor: bo'lmasa turk ovozi tanlanadi va matn
   turk talaffuziga moslab o'qitiladi (sh → ş, ch → ç, x → h, q → k ...). */
const Narrator = (() => {
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let enabled = true;
  try { enabled = localStorage.getItem('mafia-narrator') !== 'off'; } catch {}
  let voice = null;
  let lang = 'uz-UZ';

  function pickVoice() {
    if (!supported) return;
    const vs = speechSynthesis.getVoices();
    voice = vs.find((v) => /^uz/i.test(v.lang))
      || vs.find((v) => /^tr/i.test(v.lang))
      || vs.find((v) => /^en/i.test(v.lang))
      || vs[0] || null;
    lang = voice ? voice.lang : 'tr-TR';
  }
  if (supported) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  /** Emojilarni olib tashlash va tanlangan ovoz tiliga moslash */
  function prepare(text) {
    let t = String(text)
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^uz/i.test(lang)) return t;
    t = t.replace(/([OoGg])['ʻ‘’`]/g, '$1');
    if (/^tr/i.test(lang)) {
      t = t.replace(/sh/g, 'ş').replace(/Sh/g, 'Ş').replace(/SH/g, 'Ş')
        .replace(/ch/g, 'ç').replace(/Ch/g, 'Ç').replace(/CH/g, 'Ç')
        .replace(/x/g, 'h').replace(/X/g, 'H')
        .replace(/q/g, 'k').replace(/Q/g, 'K')
        .replace(/j/g, 'c').replace(/J/g, 'C');
    }
    return t;
  }

  function say(text, { interrupt = false } = {}) {
    if (!supported || !enabled || !text) return;
    if (typeof Sound !== 'undefined' && Sound.mode === 'off') return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(prepare(text));
    u.lang = lang;
    if (voice) u.voice = voice;
    const noir = document.documentElement.dataset.theme === 'noir';
    u.rate = noir ? 0.86 : 0.95;  // noir'da sekinroq, past ovozda — eski radio diktori kabi
    u.pitch = noir ? 0.75 : 1;
    u.volume = 1;
    speechSynthesis.speak(u);
  }

  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem('mafia-narrator', enabled ? 'on' : 'off'); } catch {}
    if (!enabled && supported) speechSynthesis.cancel();
  }

  return {
    say, setEnabled,
    get enabled() { return enabled; },
    get supported() { return supported; },
    get voiceLabel() { return voice ? `${voice.name} (${voice.lang})` : 'standart'; },
  };
})();
