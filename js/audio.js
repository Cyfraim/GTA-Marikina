/* Procedural sound design. Everything is synthesized with the Web Audio API, so
 * the game ships without a single audio file. Loaded before the world module. */
(function () {
  'use strict';
  const MG = window.MG = window.MG || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  MG.Audio = class Audio {
    constructor(game) {
      this.game = game;
      this.ctx = null;
      this.ready = false;
      this.volume = game && game.settings ? game.settings.volume : 0.45;
      this.muted = false;
      this.paused = false;
      this.engineSpeed = 0;
      this.sirenOn = false;
      this.step = 0;
    }
    /* Browsers only allow audio after a user gesture, so this runs on click. */
    start() {
      try {
        if (!this.ready) this.build();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        this.applyVolume();
      } catch (error) {
        console.warn('Audio unavailable:', error);
        this.ready = false;
      }
      return this;
    }
    noiseBuffer(seconds) {
      const length = Math.floor(this.ctx.sampleRate * seconds);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      return buffer;
    }
    build() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio API not supported');
      const ctx = this.ctx = new AudioContext();
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);
      this.layer('ambient', 'buffer', 420, 0.5);
      this.layer('engine', 'sawtooth', 620, 0, 90);
      this.layer('siren', 'square', 1800, 0, 620);
      this.ready = true;
    }
    /* One continuous voice: ambient traffic hum, engine, and police siren. */
    layer(name, type, cutoff, gainValue, frequency) {
      const ctx = this.ctx;
      let source;
      if (type === 'buffer') {
        source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(3);
        source.loop = true;
      } else {
        source = ctx.createOscillator();
        source.type = type;
        source.frequency.value = frequency;
      }
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const gain = ctx.createGain();
      gain.gain.value = gainValue;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      this[name] = source;
      this[name + 'Filter'] = filter;
      this[name + 'Gain'] = gain;
    }
    applyVolume() {
      if (!this.ready) return;
      const value = this.muted || this.paused ? 0 : this.volume;
      this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.08);
    }
    setVolume(value) {
      this.volume = clamp(Number(value) || 0, 0, 1);
      this.applyVolume();
    }
    setPaused(paused) {
      this.paused = !!paused;
      this.applyVolume();
    }
    /* Filtered noise burst: gunshots, footsteps and impacts. */
    burst(duration, filterType, frequency, gainValue) {
      if (!this.ready || this.paused || this.volume <= 0) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(Math.max(0.12, duration));
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(gainValue, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(now);
      source.stop(now + duration + 0.05);
    }
    tone(frequency, duration, type, gainValue, delay) {
      if (!this.ready || this.paused || this.volume <= 0) return;
      const ctx = this.ctx, now = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(frequency, now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(gainValue, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + duration + 0.05);
    }
    gunshot() {
      this.burst(0.22, 'bandpass', 1500, 0.5);
      this.tone(120, 0.12, 'square', 0.16);
    }
    /* Two-tone sarao horn. */
    horn() {
      this.tone(392, 0.26, 'square', 0.11);
      this.tone(523, 0.34, 'square', 0.11, 0.3);
    }
    scream() {
      if (!this.ready || this.paused) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.exponentialRampToValueAtTime(1180, now + 0.12);
      osc.frequency.exponentialRampToValueAtTime(430, now + 0.4);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.5);
    }
    footstep() {
      this.step = (this.step + 1) % 2;
      this.burst(0.1, 'lowpass', 340 + this.step * 90, 0.15);
    }
    impact() { this.burst(0.18, 'lowpass', 900, 0.28); }
    pickup() {
      this.tone(660, 0.1, 'triangle', 0.11);
      this.tone(990, 0.14, 'triangle', 0.09, 0.09);
    }
    update(dt) {
      if (!this.ready) return;
      const game = this.game;
      const now = this.ctx.currentTime;
      const vehicle = game.player && game.player.vehicle;
      const ratio = vehicle ? clamp(Math.abs(vehicle.speed) / (vehicle.maxSpeed || 60), 0, 1) : 0;
      this.engineSpeed += (ratio - this.engineSpeed) * Math.min(1, dt * 6);
      const drive = vehicle && !this.paused;
      this.engineGain.gain.setTargetAtTime(drive ? 0.045 + this.engineSpeed * 0.085 : 0, now, 0.12);
      this.engine.frequency.setTargetAtTime(100 + this.engineSpeed * 300 + (drive && vehicle.type === 'tricycle' ? 40 : 0), now, 0.1);
      const chasing = game.police && game.police.units.some(unit => unit.siren && unit.pursuitActive && !unit.destroyed);
      this.siren.frequency.setTargetAtTime(this.sirenOn ? 800 : 620, now, 0.02);
      this.sirenOn = !this.sirenOn;
      this.sirenGain.gain.setTargetAtTime(chasing && !this.paused ? 0.05 : 0, now, 0.25);
      this.ambientGain.gain.setTargetAtTime(this.paused ? 0.15 : 0.5, now, 0.5);
    }
  };
}());
