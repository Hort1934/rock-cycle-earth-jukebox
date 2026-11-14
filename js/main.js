import { TRACKS, THEMES, CUSTOM_TRACK, findTrack } from './catalog.js';
import { FrameAnalyzer } from './analysis.js';
import { SoundEngine, GENRES, STEPS_PER_SWEEP } from './audio.js';
import { Describer } from './describe.js';
import { VoiceGuide } from './voice.js';

const $ = (id) => document.getElementById(id);
const el = {
  video: $('video'), still: $('still'), overlay: $('overlay'), screen: document.querySelector('.screen'),
  empty: $('screen-empty'), title: $('now-title'), theme: $('now-theme'), short: $('now-short'),
  play: $('play-btn'), prev: $('prev-btn'), next: $('next-btn'), describe: $('describe-btn'), record: $('record-btn'),
  genre: $('genre'), genreNote: $('genre-note'), tempo: $('tempo'), tempoOut: $('tempo-out'), volume: $('volume'),
  groove: $('groove'), narrate: $('narrate'), haptics: $('haptics'), mixer: $('mixer'), live: $('live'),
  download: $('download'), see: $('see-text'), hear: $('hear-text'), credit: $('credit-text'),
  shelf: $('shelf'), upload: $('upload'), voiceBtn: $('voice-btn'), player: $('player'),
};

const analyzer = new FrameAnalyzer(128);
const engine = new SoundEngine();
const describer = new Describer();
let manifest = {};
let current = null;
let scanX = 0;
let customUrl = null;
let narrateTimer = null;
const BASE_BPM = 96;

const ROLE_LABEL = { melody: 'melody', pad: 'chords', bass: 'bass', perc: 'percussion', texture: 'texture' };

// ---------- shelf ----------
function renderShelf() {
  el.shelf.innerHTML = '';
  for (const theme of THEMES) {
    const tracks = TRACKS.filter((t) => t.theme === theme.id);
    if (!tracks.length) continue;
    const row = document.createElement('div');
    row.className = 'theme-row';
    row.innerHTML = `<h3>${theme.label}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'records';
    for (const t of tracks) {
      const m = manifest[t.id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'record';
      b.dataset.id = t.id;
      if (!m) b.dataset.missing = '';
      b.setAttribute('aria-label', `${t.title}. ${t.short}.${m ? '' : ' Media not available.'}`);
      b.innerHTML = `<span class="cover"${m ? ` style="background-image:url('${m.poster}')"` : ''}></span>
        <span class="meta"><span class="t">${t.title}</span><span class="s">${t.short}</span></span>`;
      b.addEventListener('click', () => m && selectTrack(t.id, { scroll: true }));
      grid.append(b);
    }
    row.append(grid);
    el.shelf.append(row);
  }
}

function markCurrent() {
  document.querySelectorAll('.record').forEach((r) => r.setAttribute('aria-current', String(r.dataset.id === current?.id)));
}

// ---------- track loading ----------
function setScreenShape(aspect) {
  el.screen.classList.toggle('wide', aspect > 3);
  el.screen.classList.toggle('half', aspect > 1.9 && aspect <= 3);
}

function selectTrack(id, { scroll = false, media = null } = {}) {
  const track = id === 'custom' ? CUSTOM_TRACK : findTrack(id);
  if (!track) return null;
  const wasPlaying = engine.playing;
  current = track;
  describer.reset();

  const src = media ?? manifest[id];
  const isImage = src?.kind === 'image';
  el.video.hidden = isImage;
  el.still.hidden = !isImage;
  el.empty.hidden = true;
  setScreenShape(track.aspect);

  analyzer.setLayers(track.layers);
  if (isImage) {
    el.video.pause();
    el.still.src = src.url;
    analyzer.setSource(el.still, track.aspect, track.grid);
  } else {
    el.video.src = src.url ?? src.video;
    el.video.poster = src.poster ?? '';
    el.video.playbackRate = Number(el.tempo.value) / BASE_BPM;
    analyzer.setSource(el.video, track.aspect, track.grid);
    if (wasPlaying) el.video.play().catch(() => {});
  }
  engine.setTrack(track, analyzer);

  el.title.textContent = track.title;
  el.theme.textContent = THEMES.find((t) => t.id === track.theme)?.label ?? 'Your file';
  el.short.textContent = track.short;
  el.see.textContent = track.see;
  el.hear.textContent = track.hear;
  el.credit.innerHTML = track.svs
    ? `${track.credit} <a href="https://svs.gsfc.nasa.gov/${track.svs}/" target="_blank" rel="noopener">SVS #${track.svs}</a>`
    : track.credit;
  el.play.disabled = false;
  renderMixer(track);
  markCurrent();
  el.live.textContent = `${track.title} loaded. ${describer.mapping(track)}`;
  if (id !== 'custom') history.replaceState(null, '', `#${id}`);
  if (scroll) el.player.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return track;
}

function renderMixer(track) {
  el.mixer.querySelectorAll('.layer').forEach((n) => n.remove());
  track.layers.forEach((l, i) => {
    const row = document.createElement('label');
    row.className = 'layer';
    row.style.setProperty('--swatch', l.color);
    row.innerHTML = `<input type="checkbox" checked data-layer="${l.id}" aria-keyshortcuts="${i + 1}">
      <span>${l.label}</span><span class="role">${ROLE_LABEL[l.role]}</span>
      <span class="meter" aria-hidden="true"><i data-meter="${l.id}"></i></span>`;
    row.querySelector('input').addEventListener('change', (e) => engine.setLayer(l.id, e.target.checked));
    el.mixer.append(row);
  });
}

// ---------- playback ----------
async function ensureAudio() {
  await engine.start();
  engine.setVolume(Number(el.volume.value));
  engine.groove = el.groove.checked;
}

async function play() {
  if (!current) selectTrack(TRACKS.find((t) => manifest[t.id])?.id);
  if (!current) return;
  await ensureAudio();
  engine.play();
  if (!el.video.hidden) await el.video.play().catch(() => {});
  setPlayingUi(true);
}

function pause() {
  engine.pause();
  el.video.pause();
  setPlayingUi(false);
}

function setPlayingUi(on) {
  document.body.classList.toggle('is-playing', on);
  el.play.textContent = on ? '⏸' : '▶';
  el.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
  clearInterval(narrateTimer);
  if (on && el.narrate.checked) narrateTimer = setInterval(narrate, 9000);
}

function describeNow(brief = false) {
  analyzer.update(performance.now(), 0);
  return describer.describe(current, analyzer, { brief });
}

function narrate() {
  el.live.textContent = describeNow(true);
}

function step(delta) {
  const available = TRACKS.filter((t) => manifest[t.id]);
  if (!available.length) return null;
  const i = available.findIndex((t) => t.id === current?.id);
  const next = available[(i + delta + available.length) % available.length];
  return selectTrack(next.id);
}

function setTempo(bpm) {
  bpm = Math.max(60, Math.min(150, bpm));
  el.tempo.value = bpm;
  el.tempoOut.textContent = bpm;
  engine.setTempo(bpm);
  el.video.playbackRate = Math.max(0.5, Math.min(2, bpm / BASE_BPM));
}

function setGenre(id) {
  el.genre.value = id;
  engine.setGenre(id);
  engine.groove = el.groove.checked;
  el.genreNote.textContent = GENRES[id].note;
  try { localStorage.setItem('ej-genre', id); } catch { /* storage blocked */ }
}

// ---------- recording ----------
let recording = false;
async function toggleRecord() {
  await ensureAudio();
  if (!recording) {
    engine.startRecording();
    recording = true;
    el.record.setAttribute('aria-pressed', 'true');
    el.record.textContent = '■ Stop recording';
    if (!engine.playing) play();
    return;
  }
  recording = false;
  el.record.setAttribute('aria-pressed', 'false');
  el.record.textContent = '● Record';
  const blob = await engine.stopRecording();
  const url = URL.createObjectURL(blob);
  const name = `earth-jukebox-${current?.id ?? 'track'}-${engine.genre}.webm`;
  el.download.hidden = false;
  el.download.innerHTML = `Your recording is ready: <a href="${url}" download="${name}">download ${name}</a>`;
}

// ---------- overlay ----------
function drawOverlay() {
  const c = el.overlay;
  const r = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (current && analyzer.ready) {
    const x = scanX * c.width;
    const grad = ctx.createLinearGradient(x - 60 * dpr, 0, x, 0);
    grad.addColorStop(0, 'rgba(255,209,102,0)');
    grad.addColorStop(1, 'rgba(255,209,102,0.22)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 60 * dpr, 0, 60 * dpr, c.height);
    ctx.fillStyle = 'rgba(255,209,102,0.9)';
    ctx.fillRect(x - dpr, 0, 2 * dpr, c.height);

    const x0 = scanX;
    const x1 = scanX + 1 / STEPS_PER_SWEEP;
    for (const layer of analyzer.layers) {
      if (!engine.enabled[layer.id]) continue;
      const col = analyzer.column(layer, x0, x1);
      if (col.weight < 0.02) continue;
      const level = engine.levels[layer.id] ?? 0;
      ctx.beginPath();
      ctx.arc(x, col.y * c.height, (4 + level * 14) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = layer.color;
      ctx.globalAlpha = 0.35 + level * 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  for (const [id, lvl] of Object.entries(engine.levels)) {
    const m = el.mixer.querySelector(`[data-meter="${id}"]`);
    if (m) m.style.width = `${Math.round(Math.min(1, lvl) * 100)}%`;
  }
  requestAnimationFrame(drawOverlay);
}

// ---------- custom files ----------
function loadCustom(file) {
  if (!file) return;
  if (customUrl) URL.revokeObjectURL(customUrl);
  customUrl = URL.createObjectURL(file);
  const kind = file.type.startsWith('image/') ? 'image' : 'video';
  const probe = kind === 'image' ? new Image() : document.createElement('video');
  const ready = () => {
    const w = probe.naturalWidth || probe.videoWidth || 16;
    const h = probe.naturalHeight || probe.videoHeight || 9;
    CUSTOM_TRACK.aspect = w / h;
    CUSTOM_TRACK.title = file.name;
    selectTrack('custom', { media: { kind, url: customUrl }, scroll: true });
  };
  if (kind === 'image') { probe.onload = ready; probe.src = customUrl; } else { probe.onloadedmetadata = ready; probe.src = customUrl; }
}

// ---------- voice mode API ----------
const app = {
  themes: THEMES,
  tracks: (theme) => TRACKS.filter((t) => manifest[t.id] && (!theme || t.theme === theme)),
  select: (id) => selectTrack(id),
  current: () => current,
  play, pause,
  isPlaying: () => engine.playing,
  describeNow: () => describeNow(),
  mappingText: () => describer.mapping(current),
  genres: () => Object.entries(GENRES).map(([id, g]) => ({ id, label: g.label })),
  genreLabel: () => GENRES[engine.genre].label,
  setGenre,
  next: () => step(1),
  previous: () => step(-1),
  faster: () => setTempo(Number(el.tempo.value) + 12),
  slower: () => setTempo(Number(el.tempo.value) - 12),
  duck: (on) => engine.duck(on),
  ensureAudio,
  focusMain: () => el.voiceBtn.focus(),
};
const voice = new VoiceGuide(app, $('voice'));

// ---------- events ----------
function bind() {
  el.play.addEventListener('click', () => (engine.playing ? pause() : play()));
  el.prev.addEventListener('click', () => step(-1));
  el.next.addEventListener('click', () => step(1));
  el.describe.addEventListener('click', () => {
    const text = describeNow();
    el.live.textContent = text;
  });
  el.record.addEventListener('click', toggleRecord);
  el.genre.addEventListener('change', () => setGenre(el.genre.value));
  el.tempo.addEventListener('input', () => setTempo(Number(el.tempo.value)));
  el.volume.addEventListener('input', () => engine.setVolume(Number(el.volume.value)));
  el.groove.addEventListener('change', () => { engine.groove = el.groove.checked; });
  el.narrate.addEventListener('change', () => setPlayingUi(engine.playing));
  el.upload.addEventListener('change', () => loadCustom(el.upload.files[0]));
  el.voiceBtn.addEventListener('click', () => voice.enter());

  engine.on('step', (s) => { scanX = s / STEPS_PER_SWEEP; });
  engine.on('hit', (strength) => {
    if (el.haptics.checked && navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) {
      navigator.vibrate(Math.round(15 + strength * 45));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (voice.active || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === ' ' && tag !== 'BUTTON') { e.preventDefault(); engine.playing ? pause() : play(); }
    else if (k === 'arrowright') step(1);
    else if (k === 'arrowleft') step(-1);
    else if (k === 'arrowup') { e.preventDefault(); setTempo(Number(el.tempo.value) + 6); }
    else if (k === 'arrowdown') { e.preventDefault(); setTempo(Number(el.tempo.value) - 6); }
    else if (k === 'd') el.describe.click();
    else if (k === 'v') voice.enter();
    else if (k === 'g') {
      const ids = Object.keys(GENRES);
      setGenre(ids[(ids.indexOf(engine.genre) + 1) % ids.length]);
    } else if (/^[1-9]$/.test(k)) {
      const box = el.mixer.querySelectorAll('input[data-layer]')[Number(k) - 1];
      if (box) { box.checked = !box.checked; box.dispatchEvent(new Event('change')); }
    }
  });
}

async function init() {
  for (const [id, g] of Object.entries(GENRES)) {
    const o = document.createElement('option');
    o.value = id; o.textContent = g.label;
    el.genre.append(o);
  }
  let saved = 'ambient';
  try { saved = localStorage.getItem('ej-genre') || saved; } catch { /* storage blocked */ }
  setGenre(GENRES[saved] ? saved : 'ambient');

  try {
    manifest = await (await fetch('media/manifest.json', { cache: 'no-cache' })).json();
  } catch {
    manifest = {};
    el.live.textContent = 'Media manifest not found. Run tools/build_media.py to create the clips.';
  }
  renderShelf();
  bind();
  const fromHash = location.hash.slice(1);
  const first = (manifest[fromHash] && fromHash) || TRACKS.find((t) => manifest[t.id])?.id;
  if (first) selectTrack(first);
  requestAnimationFrame(drawOverlay);
}

init();
