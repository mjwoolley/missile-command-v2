/**
 * src/audio.js — Web Audio API sound engine for Missile Command.
 * All sounds are synthesized procedurally (no audio file dependencies).
 * AudioContext is created lazily on first user gesture to comply with autoplay policies.
 */

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._muted = false;
    this._ambientOsc = null;
    this._ambientGain = null;
  }

  get isMuted() {
    return this._muted;
  }

  /** Lazily initialize AudioContext on first call (must be from user gesture). */
  _ensureContext() {
    if (this._ctx) return this._ctx;
    try {
      this._ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    } catch {
      // AudioContext not available (e.g. Node.js test environment)
      return null;
    }
    return this._ctx;
  }

  /** Short rising chirp for counter-missile launch. */
  playLaunch() {
    const ctx = this._ensureContext();
    if (!ctx || this._muted) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(1200, now + 0.12);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /** Burst/boom for fireball detonation. */
  playExplosion() {
    const ctx = this._ensureContext();
    if (!ctx || this._muted) return;
    const now = ctx.currentTime;

    // Noise burst via buffer
    const duration = 0.35;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * duration | 0, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.08));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    // Low rumble oscillator
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(gain);
    osc.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    osc.start(now);
    osc.stop(now + duration);
  }

  /** Low thud/crunch for city destruction. */
  playCityDestruction() {
    const ctx = this._ensureContext();
    if (!ctx || this._muted) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    // Crunch: short burst of square wave
    const sq = ctx.createOscillator();
    sq.type = 'square';
    sq.frequency.setValueAtTime(40, now);
    sq.frequency.linearRampToValueAtTime(15, now + 0.2);

    const sqGain = ctx.createGain();
    sqGain.gain.setValueAtTime(0.1, now);
    sqGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain).connect(ctx.destination);
    sq.connect(sqGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
    sq.start(now);
    sq.stop(now + 0.2);
  }

  /** Start a low periodic ambient warning tone. */
  startAmbient() {
    const ctx = this._ensureContext();
    if (!ctx || this._muted) return;
    if (this._ambientOsc) return; // already playing

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(55, ctx.currentTime);

    // LFO for periodic pulsing
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(1.5, ctx.currentTime);

    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0.03, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.04, ctx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(masterGain.gain);
    osc.connect(masterGain).connect(ctx.destination);

    lfo.start();
    osc.start();

    this._ambientOsc = osc;
    this._ambientLfo = lfo;
    this._ambientGain = masterGain;
  }

  /** Stop the ambient warning tone. */
  stopAmbient() {
    if (this._ambientOsc) {
      try {
        this._ambientOsc.stop();
        this._ambientLfo.stop();
      } catch { /* already stopped */ }
      this._ambientOsc = null;
      this._ambientLfo = null;
      this._ambientGain = null;
    }
  }

  mute() {
    this._muted = true;
    this.stopAmbient();
  }

  unmute() {
    this._muted = false;
  }
}
