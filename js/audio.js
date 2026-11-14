/* global Tone */
// Sonification engine. The data decides WHICH notes play, WHEN and HOW LOUD
// (pitch, rhythm, loudness, stereo position). The genre only decides the
// instruments, the room and an optional accompaniment groove that is not data.

const KEYS = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

export const STEPS_PER_SWEEP = 32;

export const GENRES = {
  science: { label: 'Pure data', note: 'Clean sine tones, almost no reverb: the most literal listening.', reverb: 0.06, swing: 0, every: 2, sevenths: false },
  ambient: { label: 'Ambient', note: 'Soft bells and wide pads in a big space.', reverb: 0.5, swing: 0, every: 2, sevenths: false },
  orchestral: { label: 'Orchestral', note: 'Marimba, strings, timpani and a concert hall.', reverb: 0.35, swing: 0, every: 2, sevenths: false },
  electronic: { label: 'Electronic', note: 'Synth arps and supersaw pads over a steady beat.', reverb: 0.25, swing: 0, every: 1, sevenths: false, groove: 'electronic' },
  jazz: { label: 'Jazz', note: 'Electric piano, seventh chords, upright bass and a swung ride.', reverb: 0.22, swing: 0.33, every: 2, sevenths: true, groove: 'jazz' },
  lofi: { label: 'Lo-fi', note: 'Warm, crunchy keys over a lazy boom-bap and vinyl crackle.', reverb: 0.2, swing: 0.18, every: 2, sevenths: true, groove: 'lofi' },
};

function makeVoices(genre) {
  const v = {};
  switch (genre) {
    case 'science':
      v.melody = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.25 } });
      v.pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.2, decay: 0.4, sustain: 0.6, release: 1 } });
      v.bass = new Tone.MonoSynth({ oscillator: { type: 'sine' }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.4 }, filterEnvelope: { baseFrequency: 300, octaves: 0.5 } });
      v.perc = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 1.5, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } });
      v.noise = 'white';
      break;
    case 'orchestral':
      v.melody = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 3.01, modulationIndex: 4, oscillator: { type: 'sine' }, envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.4 }, modulation: { type: 'sine' }, modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.1 } });
      v.pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', spread: 18, count: 3 }, envelope: { attack: 0.8, decay: 0.5, sustain: 0.7, release: 2.5 } });
      v.padFilter = 1400;
      v.bass = new Tone.MonoSynth({ oscillator: { type: 'sawtooth' }, envelope: { attack: 0.08, decay: 0.4, sustain: 0.6, release: 1 }, filterEnvelope: { baseFrequency: 120, octaves: 2.5, attack: 0.1 } });
      v.perc = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, envelope: { attack: 0.002, decay: 0.8, sustain: 0, release: 0.6 } });
      v.noise = 'pink';
      break;
    case 'electronic':
      v.melody = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'pulse', width: 0.35 }, envelope: { attack: 0.003, decay: 0.12, sustain: 0.15, release: 0.12 } });
      v.pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', spread: 40, count: 3 }, envelope: { attack: 0.3, decay: 0.3, sustain: 0.6, release: 1.2 } });
      v.padFilter = 2200;
      v.bass = new Tone.MonoSynth({ oscillator: { type: 'square' }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.2 }, filterEnvelope: { baseFrequency: 90, octaves: 3.5, attack: 0.005, decay: 0.15 } });
      v.perc = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } });
      v.noise = 'white';
      break;
    case 'jazz':
      v.melody = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 1, modulationIndex: 3.5, oscillator: { type: 'sine' }, envelope: { attack: 0.004, decay: 0.7, sustain: 0.15, release: 0.6 }, modulation: { type: 'triangle' }, modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.1, release: 0.4 } });
      v.pad = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 2, modulationIndex: 1.2, envelope: { attack: 0.02, decay: 1, sustain: 0.35, release: 1.2 } });
      v.padFilter = 2600;
      v.bass = new Tone.MonoSynth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.35, sustain: 0.2, release: 0.3 }, filterEnvelope: { baseFrequency: 180, octaves: 1.5, decay: 0.2 } });
      v.perc = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.25, sustain: 0 } });
      v.noise = 'brown';
      break;
    case 'lofi':
      v.melody = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.4, sustain: 0.2, release: 0.6 } });
      v.pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fattriangle', spread: 12, count: 2 }, envelope: { attack: 0.15, decay: 0.6, sustain: 0.5, release: 1.4 } });
      v.padFilter = 1200;
      v.bass = new Tone.MonoSynth({ oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.4, sustain: 0.4, release: 0.4 }, filterEnvelope: { baseFrequency: 150, octaves: 1 } });
      v.perc = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 3, envelope: { attack: 0.001, decay: 0.35, sustain: 0 } });
      v.noise = 'brown';
      v.crush = 6;
      break;
    default: // ambient
      v.melody = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 5.1, modulationIndex: 2, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 1.2, sustain: 0, release: 1.5 }, modulationEnvelope: { attack: 0.01, decay: 0.6, sustain: 0, release: 0.5 } });
      v.pad = new Tone.PolySynth(Tone.AMSynth, { harmonicity: 1.5, envelope: { attack: 1.2, decay: 0.5, sustain: 0.8, release: 3 } });
      v.padFilter = 1800;
      v.bass = new Tone.MonoSynth({ oscillator: { type: 'sine' }, envelope: { attack: 0.3, decay: 0.5, sustain: 0.7, release: 1.5 }, filterEnvelope: { baseFrequency: 200, octaves: 1 } });
      v.perc = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 2.5, envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.8 } });
      v.noise = 'pink';
  }
  v.melody.maxPolyphony = 12;
  v.pad.maxPolyphony = 10;
  return v;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Monophonic Tone.js voices throw if two notes start at the same time
// (it can happen right after pause/resume or a style change), so nudge them apart.
function after(synth, time) {
  const t = Math.max(time, (synth._ejLast ?? 0) + 0.001);
  synth._ejLast = t;
  return t;
}

export class SoundEngine {
  constructor() {
    this.built = false;
    this.genre = 'ambient';
    this.track = null;
    this.analyzer = null;
    this.enabled = {};
    this.levels = {};
    this.step = -1;
    this.listeners = { step: [], hit: [] };
    this.groove = true;
    this.lastMelodyNote = {};
  }

  on(event, fn) { this.listeners[event].push(fn); }
  emit(event, ...args) { for (const fn of this.listeners[event]) fn(...args); }

  async start() {
    await Tone.start();
    if (!this.built) this.build();
  }

  build() {
    this.built = true;
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Volume(-4).connect(this.limiter);
    this.comp = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.02, release: 0.25 }).connect(this.master);
    this.reverb = new Tone.Reverb({ decay: 5, preDelay: 0.03, wet: 0.4 }).connect(this.comp);
    this.recorder = new Tone.Recorder();
    this.master.connect(this.recorder);

    // Low drone: the overall state of the scene. Tension makes it brighter and more unstable.
    this.droneFilter = new Tone.Filter(300, 'lowpass').connect(this.reverb);
    this.droneGain = new Tone.Gain(0).connect(this.droneFilter);
    this.tremolo = new Tone.Tremolo(0.3, 0.3).start().connect(this.droneGain);
    this.drone = new Tone.FatOscillator('C2', 'sawtooth', 14).connect(this.tremolo);
    this.drone.volume.value = -18;
    this.drone.start();

    Tone.Transport.bpm.value = 96;
    Tone.Transport.scheduleRepeat((time) => this.tick(time), '16n');
    this.setGenre(this.genre);
  }

  setGenre(genre) {
    this.genre = GENRES[genre] ? genre : 'ambient';
    if (!this.built) return;
    const g = GENRES[this.genre];
    if (this.voices) this.disposeVoices();
    const v = makeVoices(this.genre);

    const chain = (synth, vol) => {
      const panner = new Tone.Panner(0);
      const volume = new Tone.Volume(vol);
      synth.connect(panner);
      panner.connect(volume);
      if (v.crush) {
        const crusher = new Tone.BitCrusher(v.crush);
        volume.connect(crusher);
        crusher.connect(this.reverb);
        return { synth, panner, volume, extra: [crusher] };
      }
      volume.connect(this.reverb);
      return { synth, panner, volume, extra: [] };
    };

    const padFilter = new Tone.Filter(v.padFilter ?? 1600, 'lowpass');
    v.pad.connect(padFilter);
    this.voices = {
      melody: chain(v.melody, -8),
      pad: chain(padFilter, -16),
      bass: chain(v.bass, -10),
      perc: chain(v.perc, -10),
    };
    this.voices.pad.source = v.pad;

    this.noise = new Tone.Noise(v.noise).start();
    this.noiseFilter = new Tone.Filter(800, 'bandpass');
    this.noiseFilter.Q.value = 0.8;
    this.noiseGain = new Tone.Gain(0);
    this.noisePan = new Tone.Panner(0);
    this.noise.chain(this.noiseFilter, this.noiseGain, this.noisePan, this.reverb);

    this.reverb.wet.rampTo(g.reverb, 0.5);
    Tone.Transport.swing = g.swing;
    Tone.Transport.swingSubdivision = '8n';
    this.buildGroove(g.groove);
  }

  buildGroove(kind) {
    this.grooveKind = kind || null;
    if (!kind) return;
    const out = new Tone.Volume(-20).connect(this.comp);
    this.grooveOut = out;
    this.kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 5, envelope: { attack: 0.001, decay: 0.35, sustain: 0 } }).connect(out);
    this.hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: kind === 'jazz' ? 0.18 : 0.05, sustain: 0 } });
    this.hatFilter = new Tone.Filter(kind === 'jazz' ? 6000 : 8000, 'highpass').connect(out);
    this.hat.connect(this.hatFilter);
    this.snare = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }).connect(out);
    if (kind === 'lofi') {
      this.crackle = new Tone.Noise('brown').start();
      this.crackleGain = new Tone.Gain(0.025);
      this.crackle.chain(new Tone.Filter(2500, 'highpass'), this.crackleGain, out);
    }
  }

  disposeVoices() {
    for (const ch of Object.values(this.voices)) {
      ch.synth.dispose();
      ch.source?.dispose();
      ch.panner.dispose();
      ch.volume.dispose();
      ch.extra.forEach((n) => n.dispose());
    }
    [this.noise, this.noiseFilter, this.noiseGain, this.noisePan, this.kick, this.hat, this.hatFilter, this.snare, this.crackle, this.crackleGain, this.grooveOut]
      .forEach((n) => n?.dispose());
    this.kick = this.hat = this.snare = this.crackle = this.grooveOut = null;
  }

  setTrack(track, analyzer) {
    this.track = track;
    this.analyzer = analyzer;
    this.enabled = Object.fromEntries(track.layers.map((l) => [l.id, true]));
    this.levels = Object.fromEntries(track.layers.map((l) => [l.id, 0]));
    const root = KEYS[track.key] ?? 0;
    const mode = MODES[track.mode] ?? MODES.ionian;
    this.rootMidi = 36 + root;
    // Melody scale across ~2.5 octaves starting at octave 4.
    this.scale = [];
    for (let oct = 0; oct < 4; oct++) for (const s of mode) this.scale.push(60 + root + oct * 12 + s);
    this.scale = this.scale.slice(0, Math.round(mode.length * 2.5) + 1);
    this.mode = mode;
    this.step = -1;
    if (this.built) this.drone.frequency.rampTo(Tone.Frequency(this.rootMidi, 'midi').toFrequency(), 0.5);
  }

  setTempo(bpm) { if (this.built) Tone.Transport.bpm.rampTo(bpm, 0.2); }
  setLayer(id, on) { this.enabled[id] = on; }

  play() { Tone.Transport.start('+0.05'); this.droneGain.gain.rampTo(1, 1); }
  pause() { Tone.Transport.pause(); this.droneGain?.gain.rampTo(0, 0.3); this.noiseGain?.gain.rampTo(0, 0.2); }
  get playing() { return this.built && Tone.Transport.state === 'started'; }

  duck(on) { if (this.built) this.master.volume.rampTo(on ? -18 : -4, 0.3); }
  setVolume(db) { if (this.built) Tone.Destination.volume.rampTo(db, 0.1); }

  startRecording() { this.recorder.start(); }
  async stopRecording() { return this.recorder.stop(); }

  midiToNote(m) { return Tone.Frequency(m, 'midi').toNote(); }

  chordFor(degree, octaveMidi, sevenths) {
    const m = this.mode;
    const pick = (i) => {
      const idx = degree + i;
      return octaveMidi + m[idx % m.length] + 12 * Math.floor(idx / m.length);
    };
    const notes = [pick(0), pick(2), pick(4)];
    if (sevenths && m.length === 7) notes.push(pick(6));
    return notes.map((n) => this.midiToNote(n));
  }

  tick(time) {
    const a = this.analyzer;
    const track = this.track;
    if (!a || !track || !this.voices) return;
    this.step = (this.step + 1) % STEPS_PER_SWEEP;
    const step = this.step;
    a.update(performance.now(), 40);
    const g = GENRES[this.genre];
    const x0 = step / STEPS_PER_SWEEP;
    const x1 = (step + 1) / STEPS_PER_SWEEP;
    const pan = x0 * 1.6 - 0.8;
    const layers = a.layers;

    for (const layer of layers) {
      const on = this.enabled[layer.id];
      const lvl = this.levels;
      lvl[layer.id] *= 0.8;
      if (!on || !layer.stats) continue;
      const col = a.column(layer, x0, x1);
      const st = layer.stats;

      switch (layer.role) {
        case 'melody': {
          const minW = layer.minWeight ?? 0.025;
          if (step % g.every !== 0 || col.weight < minW) break;
          const v = layer.pitchFrom === 'height' ? 1 - col.y : col.value;
          const idx = Math.round(clamp01(v) * (this.scale.length - 1));
          const midi = this.scale[idx];
          const vel = 0.18 + 0.62 * clamp01((col.weight / minW) * 0.055);
          if (this.lastMelodyNote[layer.id] === midi && col.weight < 0.12 && step % 4 !== 0) break;
          this.lastMelodyNote[layer.id] = midi;
          const ch = this.voices.melody;
          ch.panner.pan.setValueAtTime(pan, time);
          ch.synth.triggerAttackRelease(this.midiToNote(midi), g.every === 1 ? '16n' : '8n', time, vel);
          lvl[layer.id] = vel;
          break;
        }
        case 'pad': {
          if (step % 16 !== 0 || st.coverage < 0.004) break;
          const degree = Math.round(clamp01(st.mean) * (this.mode.length - 1));
          const chord = this.chordFor(degree, 48 + (this.rootMidi % 12), g.sevenths);
          const vel = 0.12 + 0.5 * clamp01(st.coverage * 5);
          const ch = this.voices.pad;
          ch.panner.pan.setValueAtTime((st.centroidX - 0.5) * 1.2, time);
          ch.source.triggerAttackRelease(chord, '1m', time, vel);
          lvl[layer.id] = vel;
          break;
        }
        case 'bass': {
          if (step % 8 !== 0 || st.coverage < 0.003) break;
          const degree = Math.round(clamp01(st.mean) * (this.mode.length - 1));
          const midi = this.rootMidi - 12 + this.mode[degree] + (degree % 2 ? 12 : 0);
          const vel = 0.25 + 0.6 * clamp01(st.coverage * 8);
          const ch = this.voices.bass;
          ch.synth.triggerAttackRelease(this.midiToNote(midi), '4n', after(ch.synth, time), vel);
          lvl[layer.id] = vel;
          break;
        }
        case 'perc': {
          const strength = clamp01(col.flash * (layer.sensitivity ?? 18));
          if (strength < 0.12) break;
          const midi = 36 + Math.round((1 - col.y) * 14);
          const ch = this.voices.perc;
          ch.panner.pan.setValueAtTime(pan, time);
          ch.synth.triggerAttackRelease(this.midiToNote(midi), '16n', after(ch.synth, time), 0.25 + 0.7 * strength);
          lvl[layer.id] = strength;
          Tone.Draw.schedule(() => this.emit('hit', strength), time);
          break;
        }
        case 'texture': {
          const level = clamp01(col.weight * 2.5) * 0.35;
          this.noiseGain.gain.rampTo(level, 0.06, time);
          this.noiseFilter.frequency.rampTo(300 + col.value * 3500, 0.08, time);
          this.noisePan.pan.setValueAtTime(pan, time);
          lvl[layer.id] = Math.max(lvl[layer.id], level * 2.5);
          break;
        }
        default:
      }
    }

    // Drone follows the whole scene: brightness → filter, motion → tremolo, tension → detune.
    const tension = track.tension ? track.tension(layers) : clamp01(0.15 + a.motion * 0.8);
    this.droneFilter.frequency.rampTo(160 + a.brightness * 500 + tension * 1400, 0.3, time);
    this.tremolo.frequency.rampTo(0.2 + a.motion * 6 + tension * 3, 0.3, time);
    this.drone.spread = 10 + tension * 50;
    this.tension = tension;

    if (this.groove && this.grooveKind) this.playGroove(step, time);
    Tone.Draw.schedule(() => this.emit('step', step), time);
  }

  playGroove(step, time) {
    const s = step % 16;
    if (this.grooveKind === 'electronic') {
      if (s % 4 === 0) this.kick.triggerAttackRelease('C1', '8n', after(this.kick, time), 0.8);
      if (s % 4 === 2) this.hat.triggerAttackRelease('32n', after(this.hat, time), 0.4);
      if (s === 4 || s === 12) this.snare.triggerAttackRelease('16n', after(this.snare, time), 0.35);
    } else if (this.grooveKind === 'jazz') {
      if (s % 4 === 0 || s % 8 === 6) this.hat.triggerAttackRelease('16n', after(this.hat, time), 0.25);
      if (s === 0) this.kick.triggerAttackRelease('C1', '8n', after(this.kick, time), 0.25);
    } else if (this.grooveKind === 'lofi') {
      if (s === 0 || s === 10) this.kick.triggerAttackRelease('C1', '8n', after(this.kick, time), 0.7);
      if (s === 4 || s === 12) this.snare.triggerAttackRelease('16n', after(this.snare, time), 0.45);
      if (s % 2 === 0) this.hat.triggerAttackRelease('32n', after(this.hat, time), 0.12);
    }
  }
}
