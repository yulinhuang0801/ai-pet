// The pet's voice. Built-in barks and meows are synthesised with Web Audio;
// any line can be replaced with the owner's own recording or audio file.

export const VOICE_SLOTS = {
  dog: [
    { kind: 'happy', name: 'Happy bark' },
    { kind: 'excited', name: 'Excited' },
    { kind: 'greet', name: 'Hello' },
    { kind: 'beg', name: 'Begging' },
    { kind: 'alert', name: 'Alarm bark' },
  ],
  cat: [
    { kind: 'happy', name: 'Chirp' },
    { kind: 'excited', name: 'Excited meow' },
    { kind: 'greet', name: 'Hello' },
    { kind: 'beg', name: 'Begging meow' },
    { kind: 'content', name: 'Purr' },
  ],
};

export class Voice {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.clips = {}; // kind -> AudioBuffer
    this.species = 'dog';
    this.pitch = 1;
  }

  // Browsers only allow audio after the person interacts with the page.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    for (const [kind, data] of Object.entries(this.pending ?? {})) this.setClip(kind, data);
    this.pending = null;
  }

  setPet(pet) {
    this.species = pet.species;
    const size = pet.look.size;
    this.pitch = pet.species === 'cat' ? { small: 1.15, medium: 1, large: 0.9 }[size] : { small: 1.45, medium: 1, large: 0.72 }[size];
  }

  // data: an ArrayBuffer of any audio format the browser can decode, or null.
  async setClip(kind, data) {
    if (!data) { delete this.clips[kind]; return; }
    if (!this.ctx) { (this.pending ??= {})[kind] = data; return; }
    try {
      this.clips[kind] = await this.ctx.decodeAudioData(data.slice(0));
    } catch {
      delete this.clips[kind];
      throw new Error('That file could not be played. Try an MP3, M4A, WAV or OGG file.');
    }
  }

  hasClip(kind) { return Boolean(this.clips[kind]); }

  play(kind) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const clip = this.clips[kind];
    if (clip) {
      const src = this.ctx.createBufferSource();
      src.buffer = clip;
      // A little variation so a recording does not sound canned.
      src.playbackRate.value = 0.94 + Math.random() * 0.12;
      src.connect(this.master);
      src.start();
      return;
    }
    const t = this.ctx.currentTime + 0.01;
    const p = this.pitch;
    if (this.species === 'dog') {
      if (kind === 'happy') this.bark(t, 1, p);
      else if (kind === 'excited') { this.bark(t, 0.9, p * 1.1); this.bark(t + 0.2, 0.9, p * 1.15); }
      else if (kind === 'greet') this.bark(t, 0.7, p * 1.35);
      else if (kind === 'alert') { this.bark(t, 1.3, p * 0.85); this.bark(t + 0.24, 1.3, p * 0.85); }
      else if (kind === 'beg') this.whine(t, p);
      else if (kind === 'yawn') this.yawn(t, p);
      else if (kind === 'content') this.huff(t);
    } else if (kind === 'content') this.purr(t);
    else if (kind === 'annoyed') this.hiss(t);
    else if (kind === 'yawn') this.yawn(t, p * 1.3);
    else if (kind !== 'alert') {
      const len = { happy: 0.25, greet: 0.3, excited: 0.55, beg: 0.75 }[kind] ?? 0.4;
      this.meow(t, len, p * (kind === 'happy' ? 1.2 : 1));
    }
  }

  env(t, attack, hold, release, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.master);
    return g;
  }

  noise(t, dur) {
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.start(t);
    return src;
  }

  bark(t, loud, p) {
    const ctx = this.ctx;
    const dur = 0.16;
    const out = this.env(t, 0.008, 0.03, dur, 0.55 * loud);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900 * p;
    filter.Q.value = 1.2;
    filter.connect(out);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420 * p, t);
    osc.frequency.exponentialRampToValueAtTime(260 * p, t + dur);
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    const n = this.noise(t, dur);
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    n.connect(ng).connect(filter);
  }

  whine(t, p) {
    const ctx = this.ctx;
    const out = this.env(t, 0.06, 0.45, 0.25, 0.18);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900 * p, t);
    osc.frequency.linearRampToValueAtTime(1250 * p, t + 0.35);
    osc.frequency.linearRampToValueAtTime(1000 * p, t + 0.75);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 7;
    lfoGain.gain.value = 25 * p;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(out);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.85);
    lfo.stop(t + 0.85);
  }

  meow(t, len, p) {
    const ctx = this.ctx;
    const out = this.env(t, 0.04, len * 0.5, len * 0.5, 0.3);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.Q.value = 3;
    formant.frequency.setValueAtTime(700 * p, t);
    formant.frequency.linearRampToValueAtTime(1600 * p, t + len * 0.45);
    formant.frequency.linearRampToValueAtTime(900 * p, t + len);
    formant.connect(out);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(480 * p, t);
    osc.frequency.linearRampToValueAtTime(700 * p, t + len * 0.4);
    osc.frequency.linearRampToValueAtTime(520 * p, t + len);
    osc.connect(formant);
    osc.start(t);
    osc.stop(t + len + 0.1);
  }

  purr(t) {
    const ctx = this.ctx;
    const out = this.env(t, 0.1, 1.1, 0.3, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 26;
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(am.gain);
    const n = this.noise(t, 1.6);
    n.connect(lp).connect(am).connect(out);
    lfo.start(t);
    lfo.stop(t + 1.6);
  }

  hiss(t) {
    const out = this.env(t, 0.02, 0.25, 0.2, 0.25);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    this.noise(t, 0.5).connect(hp).connect(out);
  }

  huff(t) {
    const out = this.env(t, 0.02, 0.05, 0.2, 0.25);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    this.noise(t, 0.3).connect(lp).connect(out);
  }

  yawn(t, p) {
    const out = this.env(t, 0.1, 0.4, 0.4, 0.12);
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500 * p, t);
    osc.frequency.linearRampToValueAtTime(260 * p, t + 0.9);
    osc.connect(out);
    osc.start(t);
    osc.stop(t + 1);
  }
}
