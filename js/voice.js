// Voice-guided mode: a black screen that talks to the visitor and listens to answers.
//
// Design rules for blind listeners:
// - every question has the same shape: short question, numbered options, one hint;
// - a rising beep means "speak now", a low beep means "I did not understand";
// - speech is spoken sentence by sentence (Chrome silently stops long utterances);
// - while music plays the microphone is off (it would hear the music): press Enter
//   or tap the screen, then speak a command;
// - every action also works with keys, and any key interrupts the voice.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const NUMBERS = {
  one: 1, won: 1, first: 1, two: 2, to: 2, too: 2, second: 2, three: 3, tree: 3, third: 3,
  four: 4, for: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7,
  eight: 8, ate: 8, eighth: 8, nine: 9, ninth: 9, ten: 10,
};

// Extra words people naturally use for each record.
const RECORD_WORDS = {
  'sea-surface': ['sea surface', 'temperature', 'warm water', 'ocean temperature', 'sea'],
  'ocean-currents': ['currents', 'current', 'perpetual', 'flow', 'gulf stream'],
  'night-lights': ['night', 'lights', 'light', 'cities', 'city', 'black marble'],
  aerosols: ['aerosols', 'aerosol', 'smoke', 'dust', 'salt', 'particles'],
  'air-quality': ['air quality', 'pollution', 'pollutants', 'ozone', 'nitrogen', 'monoxide'],
  'carbon-dioxide': ['carbon', 'dioxide', 'co2', 'co 2', 'greenhouse'],
  lightning: ['lightning', 'lighting', 'flashes', 'thunder', 'storms', 'storm'],
  'atmospheric-river': ['atmospheric', 'river', 'vapor', 'vapour', 'rain', 'pineapple'],
  'forest-height': ['forest', 'forests', 'trees', 'tree height', 'gedi', 'canopy'],
  temperature: ['warming', 'global temperature', 'anomalies', 'anomaly', 'climate', 'heat'],
};

const COMMANDS = [
  ['exit', ['exit', 'leave', 'quit', 'close voice', 'stop voice mode', 'goodbye']],
  ['help', ['help', 'commands', 'what can i say', 'options']],
  ['repeat', ['repeat', 'again', 'say that again', 'pardon']],
  ['menu', ['menu', 'main menu', 'home', 'start over', 'go back', 'back to menu']],
  ['pause', ['pause', 'stop', 'wait', 'quiet', 'silence', 'hold on']],
  ['play', ['play', 'resume', 'continue', 'start playing', 'listen']],
  ['describe', ['describe', 'what is happening', "what's happening", 'what do i see', 'where', 'tell me what']],
  ['hear', ['what do i hear', 'explain', 'what does it mean', 'meaning', 'what am i hearing', 'explain sound']],
  ['next', ['next', 'skip', 'another one', 'next one']],
  ['previous', ['previous', 'last one', 'go back one', 'before']],
  ['faster', ['faster', 'speed up', 'quicker']],
  ['slower', ['slower', 'slow down']],
  ['genre', ['genre', 'style', 'change music', 'change style', 'music style']],
  ['yes', ['yes', 'yeah', 'yep', 'sure', 'of course', 'okay', 'ok']],
  ['no', ['no', 'nope', 'not really']],
];

function normalize(text) {
  return ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

const includesPhrase = (norm, phrase) => norm.includes(` ${phrase} `);

function numberIn(norm) {
  for (const w of norm.trim().split(' ')) {
    if (/^\d+$/.test(w)) return Number(w);
    if (NUMBERS[w]) return NUMBERS[w];
  }
  return null;
}

function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
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
    this.silences = 0;
    this.recState = 'idle'; // idle | listening | stopping
    this.wantListen = false;
    this.speechToken = 0;
    this.onKey = (e) => this.handleKey(e);

    root.querySelector('[data-voice-exit]').addEventListener('click', () => this.exit());
    root.querySelector('[data-voice-talk]').addEventListener('click', () => this.talk());

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
      const alts = [...e.results[0]].map((a) => a.transcript);
      this.heardEl.textContent = `You said: “${alts[0]}”`;
      this.handle(alts);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        this.micBlocked = true;
      }
    };
    rec.onend = () => {
      const heard = this.heard;
      this.recState = 'idle';
      this.updateMic();
      if (!this.active) return;
      if (this.wantListen) { this.wantListen = false; this.listen(); return; }
      if (!heard && !this.micBlocked && !this.speaking) this.onSilence();
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
    this.root.querySelector('[data-voice-talk]').focus();
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
      g.gain.setValueAtTime(0.0001, t0 + i * 0.11);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.11 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.11 + 0.1);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + i * 0.11);
      o.stop(t0 + i * 0.11 + 0.12);
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

  // Speaks sentence by sentence; resolves true if finished, false if interrupted.
  async speak(text, { show = true } = {}) {
    this.stopListening();
    this.stopSpeaking();
    if (show) this.promptEl.textContent = text;
    this.lastSpoken = text;
    if (!('speechSynthesis' in window)) return true;
    const token = this.speechToken;
    this.speaking = true;
    this.updateMic();
    this.app.duck(true);
    const voice = speechSynthesis.getVoices().find((v) => v.lang === 'en-US' && /natural|google|samantha|aria|jenny|zira/i.test(v.name))
      ?? speechSynthesis.getVoices().find((v) => v.lang?.startsWith('en'));
    for (const sentence of splitSentences(text)) {
      if (token !== this.speechToken) return false;
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(sentence);
        u.lang = 'en-US';
        u.rate = 0.95;
        if (voice) u.voice = voice;
        // Watchdog: some engines never fire onend.
        const timer = setTimeout(resolve, 1500 + sentence.length * 90);
        u.onend = u.onerror = () => { clearTimeout(timer); resolve(); };
        speechSynthesis.speak(u);
      });
    }
    if (token !== this.speechToken) return false;
    this.speaking = false;
    this.app.duck(false);
    this.updateMic();
    return true;
  }

  // ---------- speech in ----------
  get canListen() { return !!this.rec && !this.micBlocked; }

  listen() {
    if (!this.active || !this.canListen || this.speaking) return;
    if (this.recState === 'listening') return;
    if (this.recState === 'stopping') { this.wantListen = true; return; }
    try {
      this.beep('listen');
      this.recState = 'listening';
      this.rec.start();
    } catch {
      this.recState = 'idle';
    }
    this.updateMic();
  }

  stopListening() {
    this.wantListen = false;
    if (this.rec && this.recState === 'listening') {
      this.recState = 'stopping';
      try { this.rec.abort(); } catch { this.recState = 'idle'; }
    }
  }

  // Push-to-talk: Enter key or the Talk button.
  talk() {
    this.stopSpeaking();
    if (!this.canListen) {
      this.speak(this.micBlocked
        ? 'The microphone is not available. Please use the number keys.'
        : 'This browser cannot listen. Please use the number keys, or open the page in Chrome or Edge.');
      return;
    }
    this.app.duck(true);
    this.listen();
  }

  onSilence() {
    if (this.state === 'playing') { this.app.duck(false); return; }
    this.silences++;
    if (this.silences === 1) {
      const n = this.choices.length;
      this.speak(`I am listening. Say ${n === 1 ? 'one' : `a number from 1 to ${n}`}, or press it on the keyboard.`, { show: false })
        .then((done) => done && this.listen());
    } else {
      this.speak('Press Enter or tap the screen when you are ready to speak.', { show: false });
    }
  }

  updateMic() {
    let text;
    if (!SR) text = 'This browser cannot listen. Use the number keys.';
    else if (this.micBlocked) text = 'Microphone blocked. Use the number keys.';
    else if (this.speaking) text = 'Speaking… (press any key to skip)';
    else if (this.recState === 'listening') text = '● Listening — speak now';
    else text = 'Press Enter or tap “Talk” to speak.';
    this.micEl.textContent = text;
    this.micEl.dataset.state = this.recState === 'listening' ? 'listening' : 'idle';
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

  // One shape for every question: question, numbered options, one hint, then listen.
  async menu(state, question, choices, { hint = 'Say the number or the name.', listen = true } = {}) {
    this.state = state;
    this.misses = 0;
    this.silences = 0;
    this.showChoices(choices);
    const options = choices.map((c, i) => `Option ${i + 1}: ${c.spoken ?? c.label}.`).join(' ');
    const done = await this.speak(`${question} ${options} ${hint}`);
    if (done && listen) this.listen();
  }

  async ask(state, extra) {
    const app = this.app;
    switch (state) {
      case 'welcome':
        return this.menu('welcome',
          'Welcome to Earth Jukebox. Here you can listen to NASA pictures of our planet, turned into music. Is this your first time here?',
          [{ label: 'Yes, first time', id: 'yes', spoken: 'yes' }, { label: 'No, I have been here', id: 'no', spoken: 'no' }],
          { hint: 'Say yes or no. After each question you will hear a beep. Then speak.' });
      case 'intro': {
        this.state = 'intro';
        this.choices = [];
        await this.speak('Here is how it works. You choose a NASA picture of Earth. The picture is read from left to right, like a record. Each color becomes an instrument. Higher values play higher notes. More of something plays louder. While the music plays, press Enter or tap the screen, and say a command, like describe, pause, or next.');
        if (this.state === 'intro') return this.ask('theme');
        return null;
      }
      case 'theme': {
        const themes = app.themes.filter((t) => app.tracks(t.id).length);
        return this.menu('theme', 'Which part of Earth would you like to hear?',
          themes.map((t) => ({ label: t.label, id: t.id, spoken: t.label.replace('&', 'and') })),
          { hint: 'Say the number or the name. Or say surprise me.' });
      }
      case 'track': {
        this.themeId = extra;
        const tracks = app.tracks(extra);
        return this.menu('track', tracks.length === 1 ? 'There is one recording.' : `There are ${tracks.length} recordings.`,
          tracks.map((t) => ({ label: t.title, id: t.id, spoken: t.short })));
      }
      case 'confirm': {
        const t = app.select(extra);
        return this.menu('confirm', `${t.title}. ${t.short}.`,
          [{ label: 'Play', id: 'play' }, { label: 'Tell me more first', id: 'more', spoken: 'tell me more' }, { label: 'Choose another', id: 'back', spoken: 'choose another' }]);
      }
      case 'more': {
        const t = app.current();
        return this.menu('more', `What the picture shows. ${t.see} What you will hear. ${t.hear}`,
          [{ label: 'Play', id: 'play' }, { label: 'Choose another', id: 'back', spoken: 'choose another' }]);
      }
      case 'genre': {
        const genres = app.genres();
        return this.menu('genre', 'Choose a music style. The data stays the same. Only the instruments change.',
          genres.map((g) => ({ label: g.label, id: g.id })));
      }
      case 'playing': {
        this.state = 'playing';
        this.showChoices([
          { label: 'Pause or play', id: 'toggle' }, { label: 'Describe what is happening', id: 'describe' },
          { label: 'What do I hear?', id: 'hear' }, { label: 'Next recording', id: 'next' },
          { label: 'Change music style', id: 'genre' }, { label: 'Main menu', id: 'menu' },
        ]);
        if (!app.isPlaying()) await app.play();
        await this.speak(`Now playing: ${app.current().title}, in ${app.genreLabel()} style. To give a command, press Enter or tap the screen, then speak. For example: describe, pause, next, or help.`);
        return null;
      }
      default:
        return null;
    }
  }

  choose(i) {
    const c = this.choices[i];
    if (!c) {
      this.beep('miss');
      this.speak(`There is no option ${i + 1}. Choose from 1 to ${this.choices.length}.`, { show: false });
      return;
    }
    this.beep('ok');
    this.heardEl.textContent = `You chose: ${c.label}`;
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
        if (app.isPlaying()) { app.pause(); return this.speak('Paused. Press space or say play to continue.'); }
        await app.play();
        return this.speak('Playing.');
      case 'pause': app.pause(); return this.speak('Paused. Press space or say play to continue.');
      case 'play': await app.play(); return this.speak('Playing.');
      case 'describe': return this.speak(app.describeNow());
      case 'hear': return this.speak(`${app.current().hear} ${app.mappingText()}`);
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
    switch (this.state) {
      case 'playing':
        return 'While the music plays, press Enter or tap the screen, then say: describe, what do I hear, pause, play, next, previous, faster, slower, style, menu, or exit. Without speaking: space pauses, D describes, the arrow keys change the recording.';
      case 'genre': case 'theme': case 'track': case 'confirm': case 'more': case 'welcome':
        return `Say the number of an option, from 1 to ${this.choices.length}, or press it on the keyboard. Say repeat to hear the options again, menu to start over, or exit to leave voice mode.`;
      default:
        return 'Say a number, or say menu, repeat, or exit.';
    }
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
      const words = [c.label, c.spoken, c.id, ...(RECORD_WORDS[c.id] ?? []),
        ...(this.app.themes.find((t) => t.id === c.id)?.words ?? [])]
        .filter(Boolean).map((w) => w.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim());
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
      if (cmd === 'help') { this.beep('ok'); return this.speak(this.helpText()).then((d) => d && this.state !== 'playing' && this.listen()); }
      if (cmd === 'repeat') { this.beep('ok'); return this.speak(this.lastSpoken).then((d) => d && this.state !== 'playing' && this.listen()); }
      if (cmd === 'menu') { this.beep('ok'); app.pause(); return this.ask('theme'); }

      if (this.state === 'welcome' && (cmd === 'yes' || cmd === 'no')) { this.beep('ok'); return this.route(cmd); }
      if (this.state === 'theme' && /\b(surprise|random|anything|any)\b/.test(norm)) {
        this.beep('ok');
        const all = app.tracks();
        return this.ask('confirm', all[Math.floor(Math.random() * all.length)].id);
      }
      if ((this.state === 'confirm' || this.state === 'more')) {
        if (cmd === 'play' || cmd === 'yes') { this.beep('ok'); return this.route('play'); }
        if (/\b(more|tell)\b/.test(norm)) { this.beep('ok'); return this.route('more'); }
        if (/\b(another|other|back)\b/.test(norm) || cmd === 'no') { this.beep('ok'); return this.route('back'); }
      }
      if (this.state === 'playing') {
        if (cmd === 'play' && !app.isPlaying()) { this.beep('ok'); return this.command('play'); }
        if (cmd === 'pause') { this.beep('ok'); return this.command('pause'); }
        if (cmd && ['describe', 'hear', 'next', 'previous', 'faster', 'slower', 'genre'].includes(cmd)) { this.beep('ok'); return this.command(cmd); }
        const g = app.genres().find((x) => includesPhrase(norm, x.label.toLowerCase()) || includesPhrase(norm, x.id));
        if (g) { this.beep('ok'); app.setGenre(g.id); return this.ask('playing'); }
      }

      const i = this.matchChoice(norm);
      if (i >= 0 && this.state !== 'playing') return this.choose(i);
    }
    return this.notUnderstood(alternatives[0]);
  }

  notUnderstood(text) {
    this.beep('miss');
    this.misses++;
    const n = this.choices.length;
    const range = n === 1 ? 'one' : n ? `a number from 1 to ${n}` : 'a command';
    let msg;
    if (this.state === 'playing') msg = `Sorry, I heard “${text}”. Say help to hear the commands.`;
    else if (this.misses === 1) msg = `Sorry, I heard “${text}”. Please say ${range}.`;
    else msg = `Let me read the options again. ${this.choices.map((c, i) => `Option ${i + 1}: ${c.spoken ?? c.label}.`).join(' ')} You can also press the number on the keyboard.`;
    this.speak(msg, { show: false }).then((d) => d && this.state !== 'playing' && this.listen());
  }

  // ---------- keyboard ----------
  handleKey(e) {
    if (!this.active || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'tab' || k === 'shift') return;
    const wasSpeaking = this.speaking;
    if (k === 'escape') { e.preventDefault(); this.exit(); return; }
    if (k === 'enter' && document.activeElement?.closest?.('[data-voice-options]')) return;
    e.preventDefault();
    if (this.state === 'intro') { this.stopSpeaking(); return; }
    if (/^[1-9]$/.test(k)) { this.stopSpeaking(); this.stopListening(); this.choose(Number(k) - 1); return; }
    switch (k) {
      case 'enter': this.talk(); return;
      case ' ': this.stopSpeaking(); if (this.state === 'playing') this.command('toggle'); return;
      case 'd': this.stopSpeaking(); this.command('describe'); return;
      case 'h': this.speak(this.helpText()); return;
      case 'r': this.speak(this.lastSpoken); return;
      case 'm': this.app.pause(); this.ask('theme'); return;
      case 'g': this.ask('genre'); return;
      case 'arrowright': this.command('next'); return;
      case 'arrowleft': this.command('previous'); return;
      case 'y': if (this.state === 'welcome') this.choose(0); return;
      case 'n': if (this.state === 'welcome') this.choose(1); return;
      default:
        if (wasSpeaking) this.stopSpeaking(); // any other key just skips the voice
    }
  }
}
