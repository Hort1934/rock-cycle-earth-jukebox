// Voice-guided mode: a black screen that talks to the visitor and listens to answers.
// Speech output: Web Speech synthesis. Speech input: SpeechRecognition where the
// browser has it (Chrome, Edge, Safari); every question can also be answered with keys.

const NUMBER_WORDS = {
  one: 1, first: 1, won: 1, two: 2, second: 2, to: 2, too: 2, three: 3, third: 3, four: 4, for: 4, fourth: 4,
  five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, eight: 8, nine: 9,
};

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function words(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function numberIn(text) {
  for (const w of words(text)) {
    if (/^\d+$/.test(w)) return Number(w);
    if (NUMBER_WORDS[w]) return NUMBER_WORDS[w];
  }
  return null;
}

const has = (text, ...keys) => {
  const t = ` ${words(text).join(' ')} `;
  return keys.some((k) => t.includes(` ${k} `));
};

export class VoiceGuide {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.prompt = root.querySelector('[data-voice-prompt]');
    this.options = root.querySelector('[data-voice-options]');
    this.heard = root.querySelector('[data-voice-heard]');
    this.mic = root.querySelector('[data-voice-mic]');
    this.active = false;
    this.listening = false;
    this.state = 'off';
    this.choices = [];
    this.onKey = (e) => this.handleKey(e);
    root.querySelector('[data-voice-exit]').addEventListener('click', () => this.exit());

    if (SR) {
      this.rec = new SR();
      this.rec.lang = 'en-US';
      this.rec.continuous = false;
      this.rec.interimResults = false;
      this.rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        this.heard.textContent = `You said: “${text}”`;
        this.handle(text);
      };
      this.rec.onend = () => {
        this.listening = false;
        this.updateMic();
        if (this.active && !this.speaking) setTimeout(() => this.listen(), 250);
      };
      this.rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.micBlocked = true;
          this.updateMic();
        }
      };
    }
  }

  get supported() { return { speak: 'speechSynthesis' in window, listen: !!SR }; }

  async enter() {
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
    speechSynthesis?.cancel();
    try { this.rec?.abort(); } catch { /* not listening */ }
    this.app.duck(false);
    this.app.focusMain();
  }

  updateMic() {
    if (!this.mic) return;
    let text;
    if (!SR) text = 'Voice answers are not supported in this browser. Use the number keys.';
    else if (this.micBlocked) text = 'Microphone blocked. Use the number keys, or allow the microphone and reload.';
    else text = this.listening ? 'Listening… speak now.' : this.speaking ? 'Speaking…' : 'Microphone ready.';
    this.mic.textContent = text;
    this.mic.dataset.state = this.listening ? 'listening' : 'idle';
  }

  speak(text) {
    this.prompt.textContent = text;
    if (!('speechSynthesis' in window)) return Promise.resolve();
    speechSynthesis.cancel();
    try { this.rec?.abort(); } catch { /* not listening */ }
    this.speaking = true;
    this.updateMic();
    this.app.duck(true);
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 1;
      const voice = speechSynthesis.getVoices().find((v) => v.lang === 'en-US' && /natural|google|samantha|aria|jenny/i.test(v.name));
      if (voice) u.voice = voice;
      const done = () => {
        this.speaking = false;
        this.app.duck(false);
        this.updateMic();
        resolve();
        if (this.active) this.listen();
      };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }

  listen() {
    if (!this.rec || this.listening || this.speaking || this.micBlocked || !this.active) return;
    try {
      this.rec.start();
      this.listening = true;
    } catch { /* already started */ }
    this.updateMic();
  }

  showChoices(choices) {
    this.choices = choices;
    this.options.innerHTML = '';
    choices.forEach((c, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${i + 1}. ${c.label}`;
      b.addEventListener('click', () => this.choose(i));
      li.append(b);
      this.options.append(li);
    });
  }

  async ask(state, extra) {
    this.state = state;
    const app = this.app;
    switch (state) {
      case 'welcome':
        this.showChoices([{ label: 'Yes, first time', id: 'yes' }, { label: 'No, I have been here', id: 'no' }]);
        return this.speak('Hello! This is Earth Jukebox. You can hear NASA Earth Information Center visualizations as music. Is this your first time here? Say yes or no, or press 1 or 2.');
      case 'intro':
        await this.speak('Here is how it works. Each NASA visualization is scanned from left to right, like a record. Colors from the scientific color scale become instruments. Higher values play higher notes, and more of something on the map plays louder. You can say pause, describe, what do I hear, faster, slower, next, or change genre, at any time. Say help to hear the commands again, and exit to leave voice mode.');
        return this.ask('theme');
      case 'theme': {
        const themes = app.themes.filter((t) => app.tracks(t.id).length);
        this.showChoices(themes.map((t) => ({ label: t.label, id: t.id })));
        const list = themes.map((t, i) => `${i + 1}, ${t.label}`).join('. ');
        return this.speak(`Which part of Earth would you like to hear? ${list}. Or say surprise me.`);
      }
      case 'track': {
        const tracks = app.tracks(extra);
        this.themeId = extra;
        this.showChoices(tracks.map((t) => ({ label: t.title, id: t.id })));
        const list = tracks.map((t, i) => `${i + 1}, ${t.short}`).join('. ');
        return this.speak(`${tracks.length === 1 ? 'There is one recording' : `There are ${tracks.length} recordings`}. ${list}. Which one?`);
      }
      case 'confirm': {
        const t = app.select(extra);
        this.showChoices([{ label: 'Play', id: 'play' }, { label: 'Tell me more first', id: 'more' }, { label: 'Choose another', id: 'back' }]);
        return this.speak(`${t.title}. ${t.short}. Say play to start, more to hear a description, or back to choose another.`);
      }
      case 'more': {
        const t = app.current();
        this.showChoices([{ label: 'Play', id: 'play' }, { label: 'Choose another', id: 'back' }]);
        return this.speak(`What you would see: ${t.see} What you will hear: ${t.hear} Say play when you are ready.`);
      }
      case 'playing': {
        this.showChoices([
          { label: 'Pause / play', id: 'toggle' }, { label: 'Describe what is happening', id: 'describe' },
          { label: 'What do I hear?', id: 'hear' }, { label: 'Next recording', id: 'next' },
          { label: 'Change genre', id: 'genre' }, { label: 'Main menu', id: 'menu' },
        ]);
        if (!app.isPlaying()) await app.play();
        return this.speak(`Playing ${app.current().title}, in ${app.genreLabel()} style. Say describe at any time.`);
      }
      case 'genre': {
        const genres = app.genres();
        this.showChoices(genres.map((g) => ({ label: g.label, id: g.id })));
        return this.speak(`Pick a style. The data stays the same; only the instruments change. ${genres.map((g, i) => `${i + 1}, ${g.label}`).join('. ')}.`);
      }
      default:
    }
  }

  choose(i) {
    const c = this.choices[i];
    if (!c) return;
    this.heard.textContent = `You chose: ${c.label}`;
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
    }
  }

  async command(id) {
    const app = this.app;
    switch (id) {
      case 'toggle':
        if (app.isPlaying()) { app.pause(); return this.speak('Paused. Say play to continue.'); }
        await app.play();
        return this.speak('Playing.');
      case 'describe': return this.speak(app.describeNow());
      case 'hear': return this.speak(`${app.current().hear} ${app.mappingText()}`);
      case 'next': app.next(); return this.ask('playing');
      case 'previous': app.previous(); return this.ask('playing');
      case 'genre': return this.ask('genre');
      case 'menu': app.pause(); return this.ask('theme');
      case 'faster': app.faster(); return this.speak('Faster.');
      case 'slower': app.slower(); return this.speak('Slower.');
      default:
    }
  }

  handle(text) {
    const app = this.app;
    // Commands that work everywhere.
    if (has(text, 'exit', 'leave', 'quit', 'close')) return this.exit();
    if (has(text, 'help', 'commands')) {
      return this.speak('You can say: play, pause, describe, what do I hear, next, previous, faster, slower, genre, menu, or exit.');
    }
    if (has(text, 'repeat', 'again')) return this.speak(this.prompt.textContent);
    if (has(text, 'menu', 'home', 'start over')) { app.pause(); return this.ask('theme'); }

    const genre = app.genres().find((g) => has(text, ...words(g.label), g.id));
    if (genre && (this.state === 'genre' || this.state === 'playing' || has(text, 'genre', 'style'))) {
      app.setGenre(genre.id);
      return this.ask('playing');
    }

    if (this.state === 'playing' || app.current()) {
      if (has(text, 'pause', 'stop', 'wait', 'quiet')) { app.pause(); return this.speak('Paused. Say play to continue.'); }
      if (this.state === 'playing') {
        if (has(text, 'play', 'resume', 'continue', 'go')) return this.command(app.isPlaying() ? 'describe' : 'toggle');
        if (has(text, 'describe', 'happening', 'see', 'where', 'show')) return this.command('describe');
        if (has(text, 'hear', 'explain', 'mean', 'meaning', 'sound')) return this.command('hear');
        if (has(text, 'next', 'skip')) return this.command('next');
        if (has(text, 'previous', 'last', 'before')) return this.command('previous');
        if (has(text, 'faster', 'speed', 'quicker')) return this.command('faster');
        if (has(text, 'slower', 'slow')) return this.command('slower');
        if (has(text, 'genre', 'style', 'change', 'music')) return this.command('genre');
      }
    }

    if (this.state === 'welcome') {
      if (has(text, 'yes', 'yeah', 'yep', 'first', 'sure')) return this.route('yes');
      if (has(text, 'no', 'nope', 'not', 'before')) return this.route('no');
    }
    if (this.state === 'theme') {
      if (has(text, 'surprise', 'random', 'anything', 'any')) {
        const all = app.tracks();
        return this.ask('confirm', all[Math.floor(Math.random() * all.length)].id);
      }
      const theme = app.themes.find((t) => has(text, ...t.words, t.id));
      if (theme && app.tracks(theme.id).length) return this.ask('track', theme.id);
    }
    if (this.state === 'track') {
      const tracks = app.tracks(this.themeId);
      const byWords = tracks.find((t) => words(t.title).some((w) => w.length > 4 && has(text, w)));
      if (byWords) return this.ask('confirm', byWords.id);
    }
    if (this.state === 'confirm' || this.state === 'more') {
      if (has(text, 'play', 'yes', 'start', 'go', 'listen')) return this.route('play');
      if (has(text, 'more', 'describe', 'tell', 'what')) return this.route('more');
      if (has(text, 'back', 'another', 'no', 'other')) return this.route('back');
    }

    const n = numberIn(text);
    if (n && this.choices[n - 1]) return this.choose(n - 1);
    return this.speak('Sorry, I did not catch that. Say help to hear the commands, or press a number key.');
  }

  handleKey(e) {
    if (!this.active) return;
    const k = e.key.toLowerCase();
    if (/^[1-9]$/.test(k)) { e.preventDefault(); this.choose(Number(k) - 1); return; }
    const map = { y: 'yes', n: 'no', ' ': 'pause', d: 'describe', h: 'help', m: 'menu', g: 'genre', r: 'repeat', arrowright: 'next', arrowleft: 'previous' };
    if (k === 'escape') { e.preventDefault(); this.exit(); return; }
    if (map[k] && !(k === ' ' && document.activeElement?.tagName === 'BUTTON')) {
      e.preventDefault();
      if (k === ' ') { this.command('toggle'); return; }
      this.handle(map[k]);
    }
  }
}
