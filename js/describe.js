// Turns analyzer features into short sentences for screen readers and voice mode.

const REGIONS = [
  [-180, -30, 'the Americas and eastern Pacific'],
  [-30, 60, 'the Atlantic, Europe and Africa'],
  [60, 150, 'Asia and the Indian Ocean'],
  [150, 181, 'the western Pacific'],
];

function where(track, x, y) {
  // The EIC night-lights frame shows the world map twice side by side.
  if (track.projection === 'equirect-double') x = (x * 2) % 1;
  if (track.projection === 'equirect' || track.projection === 'equirect-double') {
    const lon = -180 + x * 360;
    const lat = 90 - y * 180;
    const region = REGIONS.find(([a, b]) => lon >= a && lon < b)?.[2] ?? 'the Pacific';
    const band = lat > 30 ? 'northern' : lat < -30 ? 'southern' : 'tropical';
    return `${band} latitudes over ${region}`;
  }
  if (track.projection === 'panels') {
    const panel = Math.min(3, Math.floor(x * 4));
    return `panel ${panel + 1} of 4`;
  }
  const h = x < 0.36 ? 'left' : x > 0.64 ? 'right' : 'center';
  const v = y < 0.36 ? 'upper' : y > 0.64 ? 'lower' : 'middle';
  return h === 'center' && v === 'middle' ? 'the center of the view' : `the ${v} ${h} of the view`;
}

function amount(c) {
  if (c > 0.25) return 'very strong';
  if (c > 0.1) return 'strong';
  if (c > 0.03) return 'moderate';
  return 'faint';
}

export class Describer {
  constructor() { this.history = new Map(); }

  reset() { this.history.clear(); }

  describe(track, analyzer, { brief = false } = {}) {
    if (!analyzer?.ready) return 'The visualization is still loading.';
    const parts = [];
    const ranked = [...analyzer.layers]
      .filter((l) => l.stats && l.stats.coverage > 0.004)
      .sort((a, b) => b.stats.coverage - a.stats.coverage);

    for (const l of ranked.slice(0, brief ? 2 : 3)) {
      const st = l.stats;
      const prev = this.history.get(l.id);
      let trend = '';
      if (prev !== undefined) {
        const d = st.coverage - prev;
        if (d > Math.max(0.01, prev * 0.25)) trend = ', growing';
        else if (d < -Math.max(0.01, prev * 0.25)) trend = ', fading';
      }
      this.history.set(l.id, st.coverage);
      parts.push(`${l.label}: ${amount(st.coverage)}, strongest in ${where(track, st.peakX, st.peakY)}${trend}`);
    }

    if (!parts.length) return 'The scene is quiet right now: almost none of the mapped colors are on screen.';
    let text = parts.join('. ') + '.';
    if (!brief && analyzer.motion > 0.35) text += ' The picture is changing fast.';
    return text;
  }

  mapping(track) {
    const roles = {
      melody: 'melody (one note per scan step)',
      pad: 'chords (once per bar)',
      bass: 'bass line',
      perc: 'percussion (hits when it suddenly appears)',
      texture: 'noise texture',
    };
    return track.layers.map((l) => {
      const pitch = l.role === 'melody'
        ? (l.pitchFrom === 'height' ? ' Higher on screen means a higher note.' : ' A stronger value means a higher note.')
        : '';
      return `${l.label} plays the ${roles[l.role]}.${pitch}`;
    }).join(' ');
  }
}
