import type { Biome } from './world';

type SoundEvent = 'hit' | 'break' | 'thunder' | 'shift' | 'squelch' | 'hurt' | 'heartbeat' | 'gust' | 'bubble' | 'whisper' | 'thud' | 'pew' | 'overheat';
type Ambient = { drone: number; overtone: number; wind: number; cutoff: number; pulse: number };

// Subtle, distinct textures for each region; levels are relative to the master gain.
const AMBIENCE: Record<Biome, Ambient> = {
  overcast:  { drone: 52, overtone: 78,  wind: .055, cutoff: 550,  pulse: .26 },
  storm:     { drone: 43, overtone: 65,  wind: .12,  cutoff: 850,  pulse: .18 },
  glitch:    { drone: 61, overtone: 123, wind: .055, cutoff: 1500, pulse: 1.1 },
  psychosis: { drone: 47, overtone: 71,  wind: .045, cutoff: 700,  pulse: .72 },
  maw:       { drone: 35, overtone: 53,  wind: .085, cutoff: 380,  pulse: .48 },
  catacombs: { drone: 39, overtone: 59,  wind: .035, cutoff: 300,  pulse: .16 },
  veins:     { drone: 32, overtone: 48,  wind: .07,  cutoff: 240,  pulse: .55 },
  sky:       { drone: 65, overtone: 98,  wind: .09,  cutoff: 1200, pulse: .12 },
};

interface Effect {
  duration: number;
  frequency: number;
  endFrequency: number;
  tone: number;
  noise: number;
  filter: number;
  wave: OscillatorType;
}
const EFFECTS: Record<SoundEvent, Effect> = {
  hit:     { duration: .14, frequency: 145, endFrequency: 65,  tone: .28, noise: .18, filter: 1100, wave: 'triangle' },
  break:   { duration: .32, frequency: 180, endFrequency: 48,  tone: .2,  noise: .34, filter: 2300, wave: 'triangle' },
  thunder: { duration: 2.4, frequency: 78,  endFrequency: 27,  tone: .32, noise: .32, filter: 350,  wave: 'sine' },
  shift:   { duration: .65, frequency: 520, endFrequency: 92,  tone: .21, noise: .14, filter: 1600, wave: 'sawtooth' },
  squelch: { duration: .24, frequency: 185, endFrequency: 70,  tone: .18, noise: .25, filter: 550,  wave: 'sine' },
  hurt:    { duration: .4,  frequency: 220, endFrequency: 55,  tone: .26, noise: .15, filter: 800,  wave: 'sawtooth' },
  heartbeat:{ duration: .5, frequency: 62,  endFrequency: 38,  tone: .34, noise: .06, filter: 260,  wave: 'sine' },
  gust:    { duration: 1.1, frequency: 320, endFrequency: 120, tone: .06, noise: .30, filter: 1900, wave: 'sawtooth' },
  bubble:  { duration: .22, frequency: 420, endFrequency: 900, tone: .10, noise: .10, filter: 2600, wave: 'sine' },
  whisper: { duration: .85, frequency: 260, endFrequency: 210, tone: .02, noise: .5,  filter: 3600, wave: 'sine' },
  thud:    { duration: .8,  frequency: 95,  endFrequency: 30,  tone: .3,  noise: .38, filter: 350,  wave: 'sine' },
  pew:     { duration: .12, frequency: 880, endFrequency: 320, tone: .22, noise: .06, filter: 2400, wave: 'square' },
  overheat:{ duration: .5,  frequency: 240, endFrequency: 110, tone: .18, noise: .3,  filter: 700,  wave: 'sawtooth' },
};

/** Lazy Web Audio: call start() in a user gesture, and again if autoplay was blocked. */
export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private drone: OscillatorNode | null = null;
  private overtone: OscillatorNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private region: Biome = 'overcast';
  private time = 0;

  constructor() {}

  start(): void {
    if (this.context?.state === 'closed') this.context = null;
    if (!this.context) {
      if (typeof window === 'undefined') return;
      const AudioContextClass = window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      let context: AudioContext | null = null;
      try {
        context = new AudioContextClass();
        const master = context.createGain();
        master.gain.value = .25;
        master.connect(context.destination);

        // One reusable random-noise buffer supplies wind and all noise effects.
        const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const wind = context.createBufferSource();
        wind.buffer = buffer;
        wind.loop = true;
        const windFilter = context.createBiquadFilter();
        windFilter.type = 'lowpass';
        const windGain = context.createGain();
        wind.connect(windFilter).connect(windGain).connect(master);

        const drone = context.createOscillator();
        drone.type = 'sine';
        const overtone = context.createOscillator();
        overtone.type = 'triangle';
        const droneGain = context.createGain();
        drone.connect(droneGain);
        const overtoneGain = context.createGain();
        overtoneGain.gain.value = .022;
        overtone.connect(overtoneGain).connect(master);
        droneGain.connect(master);
        const initial = AMBIENCE[this.region];
        drone.frequency.value = initial.drone;
        overtone.frequency.value = initial.overtone;
        droneGain.gain.value = .075;
        windFilter.frequency.value = initial.cutoff;
        windGain.gain.value = initial.wind;
        wind.start();
        drone.start();
        overtone.start();
        this.context = context;
        this.master = master;
        this.buffer = buffer;
        this.drone = drone;
        this.overtone = overtone;
        this.windFilter = windFilter;
        this.windGain = windGain;
        this.droneGain = droneGain;
      } catch {
        if (context && context.state !== 'closed') void context.close().catch(() => {});
        return;
      }
    }
    // Resume must be called synchronously within the gesture; a rejection is normal
    // under autoplay policy. Another gesture can safely call start() again.
    if (this.context.state === 'suspended') {
      try { void this.context.resume().catch(() => {}); } catch { /* Unsupported or blocked. */ }
    }
  }

  /** Master volume in [0,1]. Scales the whole mix. */
  setVolume(value: number): void {
    const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.25;
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(v, this.context.currentTime, .05);
  }

  biome(b: Biome): void {
    if (this.region === b) return;
    this.region = b;
    const context = this.context;
    const config = AMBIENCE[b];
    if (!context || !config) return;
    const now = context.currentTime;
    this.drone?.frequency.setTargetAtTime(config.drone, now, 1.2);
    this.overtone?.frequency.setTargetAtTime(config.overtone, now, 1.2);
    this.windFilter?.frequency.setTargetAtTime(config.cutoff, now, 1.2);
    this.windGain?.gain.setTargetAtTime(config.wind, now, 1.2);
  }

  event(name: SoundEvent): void {
    const context = this.context, master = this.master, buffer = this.buffer;
    // Never queue transient effects while autoplay is blocked or the page is suspended.
    if (!context || context.state !== 'running' || !master || !buffer) return;
    const effect = EFFECTS[name];
    if (!effect) return;
    const now = context.currentTime, end = now + effect.duration;
    const envelope = (gain: GainNode, level: number) => {
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.linearRampToValueAtTime(level, now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, end);
    };

    const oscillator = context.createOscillator();
    oscillator.type = effect.wave;
    oscillator.frequency.setValueAtTime(effect.frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(effect.endFrequency, end);
    const toneGain = context.createGain();
    envelope(toneGain, effect.tone);
    oscillator.connect(toneGain).connect(master);
    oscillator.onended = () => { oscillator.disconnect(); toneGain.disconnect(); };
    oscillator.start(now);
    oscillator.stop(end);

    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = effect.duration > buffer.duration;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = effect.filter;
    const noiseGain = context.createGain();
    envelope(noiseGain, effect.noise);
    noise.connect(filter).connect(noiseGain).connect(master);
    noise.onended = () => { noise.disconnect(); filter.disconnect(); noiseGain.disconnect(); };
    noise.start(now);
    noise.stop(end);
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || !this.context || this.context.state !== 'running') return;
    this.time = (this.time + Math.min(dt, 1)) % 10000;
    const config = AMBIENCE[this.region];
    if (!config) return;
    const now = this.context.currentTime;
    const pulse = .5 + .5 * Math.sin(this.time * config.pulse * Math.PI * 2);
    this.droneGain?.gain.setTargetAtTime(.055 + pulse * .035, now, .15);
    this.windGain?.gain.setTargetAtTime(config.wind * (.8 + pulse * .4), now, .3);
  }
}
