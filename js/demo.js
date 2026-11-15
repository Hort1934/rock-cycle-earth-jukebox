// 30-second guided demo for the submission video: open the site with ?demo,
// start a screen recording, press "Start". Captions are on screen in English.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function layer(cls, html) {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  document.body.append(d);
  return d;
}

async function seek(video, t) {
  if (video.readyState < 1) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  video.currentTime = t;
  await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
}

export function runDemo(api) {
  const { selectTrack, play, pause, setGenre, setTempo, voice, video } = api;
  const start = layer('demo-start', '<button type="button" class="btn play">Start 30-second demo</button><p>Start your screen recording first (with sound), then press the button.</p>');
  const caption = layer('demo-caption', '');
  caption.hidden = true;

  const say = async (text, ms) => {
    caption.textContent = text;
    caption.hidden = false;
    await sleep(ms);
  };

  start.querySelector('button').addEventListener('click', async () => {
    start.remove();
    window.scrollTo(0, 0);

    // 0:00 — who and what
    const title = layer('demo-card', `
      <p class="label-line">Team Rock Cycle · NASA Space Apps 2026</p>
      <h2>Earth Jukebox</h2>
      <p>The Earth Information Jukebox challenge</p>
      <p class="demo-names">Ihor Marchenko · Catalina Bratu</p>`);
    await sleep(2600);
    title.remove();

    // 0:03 — the idea, on the record that tells the clearest story
    selectTrack('temperature');
    setGenre('orchestral');
    setTempo(132);
    await seek(video, 14);
    await play();
    await say('NASA’s Earth science is visual. We made it something you can hear.', 3300);
    await say('Every color on the map becomes an instrument, read live from the frames.', 3500);
    await say('1880 → 2023: as warming spreads, the music turns tense.', 3500);

    // 0:13 — events become rhythm
    selectTrack('lightning');
    await seek(video, 38);
    await play();
    await say('Lightning seen from the ISS: every flash is a drum hit.', 4300);

    // 0:17 — styles
    setGenre('jazz');
    await say('Same NASA data. Your style.', 3300);

    // 0:21 — accessibility
    caption.classList.add('on-voice');
    voice.enter();
    await say('Blind and low-vision listeners explore it all by voice.', 4600);
    voice.exit();
    caption.classList.remove('on-voice');
    caption.hidden = true;
    pause();

    // 0:26 — close
    layer('demo-card', `
      <p class="label-line">NASA Earth Information Center · 10 visualizations</p>
      <h2>Hear our planet change.</h2>
      <p>hort1934.github.io/rock-cycle-earth-jukebox</p>
      <p class="demo-names">Team Rock Cycle</p>`);
  });
}
