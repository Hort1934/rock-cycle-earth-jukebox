// Voice-guided mode for people who cannot see the screen.
//
// One simple rule: the site speaks, beeps once, then listens — always, everywhere,
// also while music plays. You never have to press anything.
// - Questions are short and name their options in words; numbers are a fallback.
// - While music plays, anything that is not a known command is ignored silently
//   (the microphone also hears the music, so it must not answer noise).
// - Sentences are spoken one by one (Chrome silently drops long utterances).
// - Keys still work for everything, and any key interrupts the voice.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const NUMBERS = {
  one: 1, won: 1, first: 1, two: 2, to: 2, too: 2, second: 2, three: 3, tree: 3, third: 3,
  four: 4, for: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, eight: 8, nine: 9,
};

// Extra words people naturally use for each record.
const RECORD_WORDS = {
  'sea-surface': ['sea surface', 'temperature', 'warm water', 'ocean temperature', 'sea'],
  'ocean-currents': ['currents', 'current', 'perpetual', 'flow', 'gulf stream'],
  'night-lights': ['night', 'lights', 'light', 'cities', 'city'],
  aerosols: ['aerosols', 'aerosol', 'smoke', 'dust', 'salt', 'particles'],
  'air-quality': ['air quality', 'pollution', 'pollutants', 'ozone', 'nitrogen', 'monoxide'],
  'carbon-dioxide': ['carbon', 'dioxide', 'co2', 'greenhouse'],
  lightning: ['lightning', 'lighting', 'flashes', 'thunder', 'storms', 'storm'],
  'atmospheric-river': ['atmospheric', 'river', 'vapor', 'vapour', 'rain'],
  'forest-height': ['forest', 'forests', 'trees', 'canopy'],
  temperature: ['warming', 'global temperature', 'anomalies', 'climate', 'heat'],
};

const COMMANDS = [
  ['exit', ['exit', 'leave', 'quit', 'close voice', 'stop voice mode', 'goodbye']],
  ['help', ['help', 'commands', 'what can i say']],
  ['repeat', ['repeat', 'again', 'say that again', 'pardon']],
  ['menu', ['menu', 'main menu', 'home', 'start over', 'back to menu', 'go back to menu']],
  ['pause', ['pause', 'stop', 'wait', 'quiet', 'silence', 'hold on']],
  ['play', ['play', 'resume', 'continue', 'start playing', 'listen']],
  ['describe', ['describe', 'what is happening', "what's happening", 'what is going on', "what's going on", 'what do i see', 'where', 'what is on screen', 'tell me what you see']],
  ['hear', ['what do i hear', 'explain', 'what does it mean', 'what am i hearing', 'meaning']],
  ['next', ['next', 'skip', 'another one', 'next one', 'something else', 'something another', 'different one', 'other recording', 'another recording']],
  ['previous', ['previous', 'last one', 'go back one']],
  ['faster', ['faster', 'speed up', 'quicker']],
  ['slower', ['slower', 'slow down']],
  ['genre', ['genre', 'style', 'change music', 'change style', 'music style']],
  ['more', ['more', 'tell me more', 'tell me about it', 'about it']],
  ['back', ['back', 'choose another', 'another', 'other one', 'something else']],
  ['yes', ['yes', 'yeah', 'yep', 'sure', 'of course', 'okay', 'ok']],
  ['no', ['no', 'nope', 'not really', 'no thanks']],
];

// Loose understanding for free speech ("have you got something else?", "what's going on there?"):
// count intent words in the phrase; used only when no exact command matched.
const INTENT_WORDS = {
  describe: ['describe', 'scribe', 'happening', 'going', 'see', 'show', 'showing', 'picture', 'screen', 'where', 'look', 'looks', 'looking', 'map', 'image', 'view'],
  hear: ['hear', 'hearing', 'sound', 'sounds', 'mean', 'means', 'explain', 'notes', 'instrument', 'instruments', 'why'],
  next: ['next', 'another', 'other', 'else', 'different', 'skip', 'new', 'something', 'change'],
  previous: ['previous', 'before', 'last', 'earlier'],
  pause: ['pause', 'stop', 'wait', 'quiet', 'silence', 'enough', 'mute'],
  play: ['play', 'resume', 'continue', 'unpause'],
  faster: ['faster', 'quicker', 'speed'],
  slower: ['slower', 'slow'],
  genre: ['style', 'genre', 'jazz', 'electronic', 'ambient', 'orchestral', 'lofi'],
  menu: ['menu', 'home', 'topics', 'categories', 'start', 'beginning', 'main'],
  help: ['help', 'how', 'commands', 'options'],
};

function guessIntent(norm, allowed) {
  const list = norm.trim().split(' ');
  if (list.length < 2) return null; // single words during music are usually noise
  const words = new Set(list);
  let best = null;
  let bestHits = 0;
  let tie = false;
  for (const intent of allowed) {
    const hits = (INTENT_WORDS[intent] ?? []).filter((w) => words.has(w)).length;
    if (hits > bestHits) { best = intent; bestHits = hits; tie = false; } else if (hits && hits === bestHits) tie = true;
  }
  return bestHits && !tie ? best : null;
}

const normalize = (text) => ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
const includesPhrase = (norm, phrase) => norm.includes(` ${phrase} `);

function numberIn(norm) {
  for (const w of norm.trim().split(' ')) {
    if (/^\d+$/.test(w)) return Number(w);
    if (NUMBERS[w]) return NUMBERS[w];
  }
  return null;
}

const splitSentences = (text) => text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];

// "Ocean, Air and Weather" — how a person would list things.
function spokenList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

export class VoiceGuide {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.promptEl = root.querySelector('[data-voice-prompt]');
    this.optionsEl = root.querySelector('[data-voice-options]');
    this.heardEl = root.querySelector('[data-voice-heard]');
    this.micEl = root.querySelector('[data-voice-mic]');
    this.active = false;
    this.state = 'off';
    this.choices = [];
    this.lastSpoken = '';
    this.misses = 0;
    this.quietRounds = 0;
    this.recState = 'idle'; // idle | listening | stopping
    this.speechToken = 0;
    this.onKey = (e) => this.handleKey(e);

    root.querySelector('[data-voice-exit]').addEventListener('click', () => this.exit());
    root.querySelector('[data-voice-talk]').addEventListener('click', () => { this.stopSpeaking(); this.listen(true); });

    if (SR) this.setupRecognition();
  }

  setupRecognition() {
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 4;
    rec.onstart = () => { this.recState = 'listening'; this.heard = false; this.updateMic(); };
    rec.onresult = (e) => {
      this.heard = true;
      this.quietRounds = 0;
      const alts = [...e.results[0]].map((a) => a.transcript);
      this.heardEl.textContent = `Heard: “${alts[0]}”`;
      this.handle(alts);
    };
    rec.onerror = (e) => {
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) this.micBlocked = true;
    };
    rec.onend = () => {
      this.recState = 'idle';
      this.updateMic();
      if (!this.active || this.speaking || this.micBlocked) return;
      if (!this.heard) this.onQuiet();
      // Keep listening: the visitor never has to press anything.
      setTimeout(() => this.listen(), 200);
    };
    this.rec = rec;
  }

  // ---------- lifecycle ----------
  async enter() {
    if (this.active) return;
    this.active = true;
    this.root.hidden = false;
    document.body.classList.add('voice-on');
    document.addEventListener('keydown', this.onKey, true);
    this.root.querySelector('[data-voice-exit]').focus();
    await this.app.ensureAudio();
    this.ask('welcome');
  }

  exit() {
    this.active = false;
    this.root.hidden = true;
    document.body.classList.remove('voice-on');
    document.removeEventListener('keydown', this.onKey, true);
    this.stopSpeaking();
    this.stopListening();
    this.app.duck(false);
    this.app.focusMain();
  }

  // ---------- sounds ----------
  beep(kind) {
    const ctx = this.app.audioContext?.();
    if (!ctx) return;
    const notes = { listen: [660, 990], ok: [880, 1320], miss: [330, 220] }[kind];
    const t0 = ctx.currentTime + 0.01;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = t0 + i * 0.11;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.12);
    });
  }

  // ---------- speech out ----------
  stopSpeaking() {
    this.speechToken++;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.speaking) {
      this.speaking = false;
      this.app.duck(false);
      this.updateMic();
    }
  }

  // Speaks sentence by sentence, then beeps and listens. Resolves false if interrupted.
  async speak(text, { show = true, then = 'listen' } = {}) {
    this.stopListening();
    this.stopSpeaking();
    if (show) this.promptEl.textContent = text;
    this.lastSpoken = text;
    const token = this.speechToken;
    if ('speechSynthesis' in window) {
      this.speaking = true;
      this.updateMic();
      this.app.duck(true);
      const voices = speechSynthesis.getVoices();
      const voice = voices.find((v) => v.lang === 'en-US' && /natural|google|samantha|aria|jenny|zira/i.test(v.name))
        ?? voices.find((v) => v.lang?.startsWith('en'));
      for (const sentence of splitSentences(text)) {
        if (token !== this.speechToken) return false;
        await new Promise((resolve) => {
          const u = new SpeechSynthesisUtterance(sentence);
          u.lang = 'en-US';
          u.rate = 0.95;
          if (voice) u.voice = voice;
          const timer = setTimeout(resolve, 1500 + sentence.length * 90); // some engines never fire onend
          u.onend = u.onerror = () => { clearTimeout(timer); resolve(); };
          speechSynthesis.speak(u);
        });
      }
      if (token !== this.speechToken) return false;
      this.speaking = false;
      this.app.duck(false);
    }
    this.updateMic();
    if (then === 'listen') this.listen(true);
    return true;
  }

  // ---------- speech in ----------
  get canListen() { return !!this.rec && !this.micBlocked; }

  listen(withBeep = false) {
    if (!this.active || !this.canListen || this.speaking || this.recState !== 'idle') return;
    if (withBeep) this.beep('listen');
    try {
      this.recState = 'listening';
      this.rec.start();
    } catch {
      this.recState = 'idle';
    }
    this.updateMic();
  }

  stopListening() {
    if (this.rec && this.recState === 'listening') {
      this.recState = 'stopping';
      try { this.rec.abort(); } catch { this.recState = 'idle'; }
    }
  }

  // Nothing was said for a while: one short, friendly reminder in menus, never during music.
  onQuiet() {
    if (this.state === 'playing' || this.state === 'intro') return;
    this.quietRounds++;
    if (this.quietRounds === 2) {
      this.speak(`I'm listening. ${this.choiceHint()}`, { show: false });
    }
  }

  updateMic() {
    let text;
    let state = 'idle';
    if (!SR) text = 'This browser cannot listen. Use the number keys, or open the page in Chrome or Edge.';
    else if (this.micBlocked) text = 'Microphone blocked. Allow it in the address bar, or use the number keys.';
    else if (this.speaking) { text = 'Speaking…'; state = 'speaking'; }
    else if (this.recState === 'listening') { text = 'Your turn — I’m listening'; state = 'listening'; }
    else text = 'One moment…';
    this.micEl.textContent = text;
    this.micEl.dataset.state = state;
  }

  // ---------- menus ----------
  showChoices(choices) {
    this.choices = choices;
    this.optionsEl.innerHTML = '';
    choices.forEach((c, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${i + 1}. ${c.label}`;
      b.addEventListener('click', () => this.choose(i));
      li.append(b);
      this.optionsEl.append(li);
    });
  }

  choiceHint() {
    const names = this.choices.map((c) => c.say ?? c.label);
    if (this.state === 'welcome') return 'Just say yes, or no.';
    return `You can say ${spokenList(names)}.`;
  }

  async ask(state, extra) {
    const app = this.app;
    this.misses = 0;
    this.quietRounds = 0;
    switch (state) {
      case 'welcome':
        this.state = 'welcome';
        this.showChoices([{ label: 'Yes, first time', id: 'yes', say: 'yes' }, { label: 'No, I have been here', id: 'no', say: 'no' }]);
        return this.speak('Welcome to Earth Jukebox. You will hear NASA pictures of our planet as music. I will ask you simple questions. Answer after the beep. Is this your first time here?');

      case 'intro':
        this.state = 'intro';
        this.choices = [];
        await this.speak('Here is how it works. Each picture is read from left to right, like a record. Every color becomes an instrument. Higher values play higher notes, and more of something plays louder. While the music plays, I keep listening. You can say describe, what do I hear, pause, next, or menu at any time.', { then: 'none' });
        if (this.state === 'intro') return this.ask('theme');
        return null;

      case 'theme': {
        this.state = 'theme';
        const themes = app.themes.filter((t) => app.tracks(t.id).length);
        this.showChoices(themes.map((t) => ({ label: t.label, id: t.id, say: t.label.replace('&', 'and') })));
        return this.speak(`Which part of Earth would you like to hear? ${spokenList(themes.map((t) => t.label.replace('&', 'and')))}. Or say surprise me.`);
      }

      case 'track': {
        this.state = 'track';
        this.themeId = extra;
        const tracks = app.tracks(extra);
        const theme = app.themes.find((t) => t.id === extra)?.label.replace('&', 'and') ?? '';
        this.showChoices(tracks.map((t) => ({ label: t.title, id: t.id, say: t.short })));
        if (tracks.length === 1) {
          return this.speak(`In ${theme}, there is one recording: ${tracks[0].short}. Say play to start, or more to hear about it.`);
        }
        const list = tracks.map((t, i) => `Number ${i + 1}: ${t.short}.`).join(' ');
        return this.speak(`In ${theme}, there are ${tracks.length} recordings. ${list} Which one?`);
      }

      case 'confirm': {
        this.state = 'confirm';
        const t = app.select(extra);
        this.showChoices([{ label: 'Play', id: 'play', say: 'play' }, { label: 'Tell me more', id: 'more', say: 'more' }, { label: 'Choose another', id: 'back', say: 'back' }]);
        return this.speak(`${t.title}. Say play to start, more to hear about it, or back.`);
      }

      case 'more': {
        this.state = 'more';
        const t = app.current();
        this.showChoices([{ label: 'Play', id: 'play', say: 'play' }, { label: 'Choose another', id: 'back', say: 'back' }]);
        return this.speak(`${t.see} ${t.hear} Say play when you are ready, or back.`);
      }

      case 'genre': {
        this.state = 'genre';
        const genres = app.genres();
        this.showChoices(genres.map((g) => ({ label: g.label, id: g.id })));
        return this.speak(`Which music style? ${spokenList(genres.map((g) => g.label))}. The data stays the same, only the instruments change.`);
      }

      case 'playing': {
        this.state = 'playing';
        this.showChoices([
          { label: 'Describe what is happening', id: 'describe' }, { label: 'What do I hear?', id: 'hear' },
          { label: 'Pause or play', id: 'toggle' }, { label: 'Next recording', id: 'next' },
          { label: 'Change music style', id: 'genre' }, { label: 'Main menu', id: 'menu' },
        ]);
        if (!app.isPlaying()) await app.play();
        return this.speak(`Now playing: ${app.current().title}. I'm still listening. Say describe, pause, next, or menu whenever you like.`);
      }
      default:
        return null;
    }
  }

  choose(i) {
    const c = this.choices[i];
    if (!c) {
      this.beep('miss');
      this.speak(this.choices.length ? `Please choose 1 to ${this.choices.length}.` : 'One moment, please.', { show: false });
      return;
    }
    this.beep('ok');
    this.heardEl.textContent = `Chosen: ${c.label}`;
    this.route(c.id);
  }

  route(id) {
    const app = this.app;
    switch (this.state) {
      case 'welcome': return this.ask(id === 'yes' ? 'intro' : 'theme');
      case 'theme': return this.ask('track', id);
      case 'track': return this.ask('confirm', id);
      case 'confirm':
      case 'more':
        if (id === 'play') return this.ask('playing');
        if (id === 'more') return this.ask('more');
        return this.ask('track', this.themeId ?? app.current().theme);
      case 'genre':
        app.setGenre(id);
        return this.ask('playing');
      case 'playing':
        return this.command(id);
      default:
        return null;
    }
  }

  async command(id) {
    const app = this.app;
    switch (id) {
      case 'toggle':
        if (app.isPlaying()) return this.command('pause');
        return this.command('play');
      case 'pause': app.pause(); return this.speak('Paused. Say play to continue.');
      case 'play': await app.play(); return this.speak('Playing.');
      case 'describe': return this.speak(app.describeNow());
      case 'hear': return this.speak(app.current().hear);
      case 'next': app.next(); return this.ask('playing');
      case 'previous': app.previous(); return this.ask('playing');
      case 'genre': return this.ask('genre');
      case 'menu': app.pause(); return this.ask('theme');
      case 'faster': app.faster(); return this.speak('Faster.');
      case 'slower': app.slower(); return this.speak('Slower.');
      default: return null;
    }
  }

  helpText() {
    if (this.state === 'playing') {
      return 'You can say: describe, what do I hear, pause, play, next, previous, faster, slower, style, menu, or exit.';
    }
    return `${this.choiceHint()} You can also say a number, repeat, menu, or exit.`;
  }

  // ---------- understanding ----------
  findCommand(norm) {
    for (const [id, phrases] of COMMANDS) if (phrases.some((p) => includesPhrase(norm, p))) return id;
    return null;
  }

  matchChoice(norm) {
    const n = numberIn(norm);
    if (n && this.choices[n - 1]) return n - 1;
    let best = -1;
    let bestScore = 0;
    this.choices.forEach((c, i) => {
      const words = [c.label, c.say, c.id, ...(RECORD_WORDS[c.id] ?? []), ...(this.app.themes.find((t) => t.id === c.id)?.words ?? [])]
        .filter(Boolean).map((w) => normalize(w).trim());
      let score = 0;
      for (const w of words) {
        if (w && includesPhrase(norm, w)) score = Math.max(score, w.length + 10);
        else for (const part of w.split(' ')) if (part.length > 3 && includesPhrase(norm, part)) score = Math.max(score, part.length);
      }
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  handle(alternatives) {
    const app = this.app;
    for (const alt of alternatives) {
      const norm = normalize(alt);
      const cmd = this.findCommand(norm);

      if (cmd === 'exit') return this.exit();
      if (cmd === 'help') { this.beep('ok'); return this.speak(this.helpText(), { show: false }); }
      if (cmd === 'repeat') { this.beep('ok'); return this.speak(this.lastSpoken); }
      if (cmd === 'menu') { this.beep('ok'); app.pause(); return this.ask('theme'); }

      switch (this.state) {
        case 'welcome':
          if (cmd === 'yes' || cmd === 'no') { this.beep('ok'); return this.route(cmd); }
          break;
        case 'theme':
          if (/ (surprise|random|anything|any) /.test(norm)) {
            this.beep('ok');
            const all = app.tracks();
            return this.ask('confirm', all[Math.floor(Math.random() * all.length)].id);
          }
          break;
        case 'track':
          // With a single recording, "play" and "more" work straight away.
          if (this.choices.length === 1 && (cmd === 'play' || cmd === 'yes')) { this.beep('ok'); app.select(this.choices[0].id); return this.ask('playing'); }
          if (this.choices.length === 1 && cmd === 'more') { this.beep('ok'); app.select(this.choices[0].id); return this.ask('more'); }
          if (cmd === 'back') { this.beep('ok'); return this.ask('theme'); }
          break;
        case 'confirm':
        case 'more':
          if (cmd === 'play' || cmd === 'yes') { this.beep('ok'); return this.route('play'); }
          if (cmd === 'more') { this.beep('ok'); return this.route('more'); }
          if (cmd === 'back' || cmd === 'no') { this.beep('ok'); return this.route('back'); }
          break;
        case 'genre':
          if (cmd === 'back' || cmd === 'no') { this.beep('ok'); return this.ask('playing'); }
          break;
        case 'playing': {
          const g = app.genres().find((x) => includesPhrase(norm, x.label.toLowerCase()) || includesPhrase(norm, x.id));
          if (g) { this.beep('ok'); app.setGenre(g.id); return this.ask('playing'); }
          if (cmd === 'play') { if (app.isPlaying()) break; this.beep('ok'); return this.command('play'); }
          if (cmd && ['pause', 'describe', 'hear', 'next', 'previous', 'faster', 'slower', 'genre'].includes(cmd)) { this.beep('ok'); return this.command(cmd); }
          if (cmd === 'back') { this.beep('ok'); return this.command('next'); }
          const guess = guessIntent(norm, ['describe', 'hear', 'next', 'previous', 'pause', 'play', 'faster', 'slower', 'genre', 'menu', 'help']);
          if (guess === 'menu') { this.beep('ok'); app.pause(); return this.ask('theme'); }
          if (guess === 'help') { this.beep('ok'); return this.speak(this.helpText(), { show: false }); }
          if (guess === 'play' && app.isPlaying()) break;
          if (guess) { this.beep('ok'); return this.command(guess); }
          break;
        }
        default:
      }

      if (this.state !== 'playing') {
        const i = this.matchChoice(norm);
        if (i >= 0) return this.choose(i);
      }
    }
    return this.notUnderstood();
  }

  notUnderstood() {
    // During music the microphone also hears the music: ignore anything that is not a command.
    if (this.state === 'playing' || this.state === 'intro') return;
    this.beep('miss');
    this.misses++;
    const msg = this.misses === 1 ? `Sorry, I didn't get that. ${this.choiceHint()}` : `Sorry. ${this.choiceHint()} Or press a number key from 1 to ${this.choices.length}.`;
    this.speak(msg, { show: false });
  }

  // ---------- keyboard ----------
  handleKey(e) {
    if (!this.active || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'tab' || k === 'shift') return;
    if (k === 'escape') { e.preventDefault(); this.exit(); return; }
    if (k === 'enter' && document.activeElement?.closest?.('[data-voice-options], .voice-actions')) return;
    e.preventDefault();
    if (this.state === 'intro') { this.stopSpeaking(); return; }
    if (/^[1-9]$/.test(k)) { this.stopSpeaking(); this.stopListening(); this.choose(Number(k) - 1); return; }
    switch (k) {
      case 'enter': this.stopSpeaking(); this.listen(true); return;
      case ' ': this.stopSpeaking(); if (this.state === 'playing') this.command('toggle'); return;
      case 'd': this.stopSpeaking(); if (this.state === 'playing') this.command('describe'); return;
      case 'h': this.speak(this.helpText(), { show: false }); return;
      case 'r': this.speak(this.lastSpoken); return;
      case 'm': this.app.pause(); this.ask('theme'); return;
      case 'g': this.ask('genre'); return;
      case 'arrowright': if (this.state === 'playing') this.command('next'); return;
      case 'arrowleft': if (this.state === 'playing') this.command('previous'); return;
      case 'y': if (this.state === 'welcome') this.choose(0); return;
      case 'n': if (this.state === 'welcome') this.choose(1); return;
      default: this.stopSpeaking(); this.listen(true);
    }
  }
}
