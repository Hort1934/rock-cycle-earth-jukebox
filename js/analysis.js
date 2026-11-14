// Reads frames of an EIC visualization and turns pixels into per-layer features.
// Each layer is a color rule taken from the visualization's color bar, e.g.
// "dust is magenta", "warm anomaly is red". For every frame we know, per column,
// how much of the layer is there, how high it sits and how strong its value is.

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x, a, b) => clamp01((x - a) / (b - a));

function hueDistance(h, center) {
  const d = Math.abs(h - center) % 360;
  return d > 180 ? 360 - d : d;
}

// Layer matchers: return a weight 0..1 for one pixel.
export const match = {
  hue: (center, width, sMin = 0.3, vMin = 0.25) => (h, s, v) =>
    clamp01(1 - hueDistance(h, center) / width) * smooth(s, sMin * 0.6, sMin) * smooth(v, vMin * 0.6, vMin),
  bright: (vMin = 0.6, sMax = 0.3) => (h, s, v) => smooth(v, vMin * 0.85, vMin) * (1 - smooth(s, sMax, sMax + 0.15)),
  colorful: (sMin = 0.35, vMin = 0.3) => (h, s, v) => smooth(s, sMin * 0.6, sMin) * smooth(v, vMin * 0.6, vMin),
  any: (...rules) => (h, s, v) => Math.max(...rules.map((f) => f(h, s, v))),
};

// Value extractors: return 0..1 for one pixel (the "data value" proxy).
export const value = {
  brightness: () => (h, s, v) => v,
  saturation: () => (h, s, v) => s,
  // Walks a rainbow color bar from cold hue (e.g. 240 blue) to warm hue (0 red).
  hueScale: (cold = 240, warm = 0) => (h) => {
    const hh = h > 300 ? h - 360 : h;
    return clamp01((cold - hh) / (cold - warm));
  },
};

export class FrameAnalyzer {
  constructor(width = 128) {
    this.width = width;
    this.height = 72;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.layers = [];
    this.source = null;
    this.lastUpdate = 0;
    this.motion = 0;
    this.brightness = 0;
    this.prevV = null;
    this.ready = false;
  }

  setSource(el, aspect, gridWidth) {
    this.source = el;
    // Keep ~72 rows for every shape, so ultra-wide EIC hyperwall frames get a wider grid.
    this.width = gridWidth ?? Math.max(128, Math.min(320, Math.round(72 * aspect)));
    this.height = Math.max(24, Math.round(this.width / aspect));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.prevV = null;
    this.ready = false;
    this.allocate();
  }

  setLayers(layers) {
    this.layers = layers.map((l) => ({ ...l, stats: null }));
    this.allocate();
  }

  allocate() {
    const W = this.width;
    for (const l of this.layers) {
      l.stats = {
        colW: new Float32Array(W),
        colY: new Float32Array(W),
        colVal: new Float32Array(W),
        colFlash: new Float32Array(W),
        prevColW: new Float32Array(W),
        coverage: 0,
        mean: 0,
        centroidX: 0.5,
        centroidY: 0.5,
      };
    }
  }

  // Returns false if the source is not drawable yet.
  update(now = performance.now(), minInterval = 50) {
    if (now - this.lastUpdate < minInterval && this.ready) return true;
    const src = this.source;
    if (!src) return false;
    if (src instanceof HTMLVideoElement && src.readyState < 2) return false;
    if (src instanceof HTMLImageElement && !src.complete) return false;
    this.lastUpdate = now;

    const { width: W, height: H, ctx } = this;
    this.drawAveraged(src, W, H);
    let data;
    try {
      data = ctx.getImageData(0, 0, W, H).data;
    } catch {
      return false; // cross-origin source
    }

    const n = W * H;
    const v = new Float32Array(n);
    const hArr = new Float32Array(n);
    const sArr = new Float32Array(n);
    let sumV = 0;
    let sumDiff = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const [hh, ss, vv] = rgbToHsv(data[p], data[p + 1], data[p + 2]);
      hArr[i] = hh; sArr[i] = ss; v[i] = vv;
      sumV += vv;
      if (this.prevV) sumDiff += Math.abs(vv - this.prevV[i]);
    }
    this.brightness = sumV / n;
    this.motion = this.prevV ? Math.min(1, (sumDiff / n) * 12) : 0;
    this.prevV = v;

    for (const layer of this.layers) {
      const st = layer.stats;
      st.prevColW.set(st.colW);
      st.colW.fill(0); st.colY.fill(0); st.colVal.fill(0);
      let total = 0, totalVal = 0, cx = 0, cy = 0;
      for (let y = 0; y < H; y++) {
        const fy = y / (H - 1);
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const w = layer.match(hArr[i], sArr[i], v[i]);
          if (w <= 0.02) continue;
          const val = layer.value(hArr[i], sArr[i], v[i]);
          st.colW[x] += w;
          st.colY[x] += w * fy;
          st.colVal[x] += w * val;
          total += w; totalVal += w * val; cx += w * (x / (W - 1)); cy += w * fy;
        }
      }
      let peak = 0;
      st.peakX = 0.5; st.peakY = 0.5;
      for (let x = 0; x < W; x++) {
        const w = st.colW[x];
        if (w > 0) { st.colY[x] /= w; st.colVal[x] /= w; }
        st.colW[x] = w / H;
        st.colFlash[x] = this.ready ? Math.max(0, st.colW[x] - st.prevColW[x]) : 0;
      }
      // Strongest region: best 8-column window, so descriptions name a place, not the map center.
      for (let x = 0; x + 8 <= W; x++) {
        let w = 0, y = 0;
        for (let k = x; k < x + 8; k++) { w += st.colW[k]; y += st.colW[k] * st.colY[k]; }
        if (w > peak) { peak = w; st.peakX = (x + 4) / (W - 1); st.peakY = y / w; }
      }
      st.coverage = total / n;
      st.mean = total > 0 ? totalVal / total : 0;
      if (total > 0) { st.centroidX = cx / total; st.centroidY = cy / total; }
    }
    this.ready = true;
    return true;
  }

  // One big drawImage samples bilinearly and drops tiny features (lightning flashes,
  // city lights). Halving step by step averages 2×2 blocks, like an area filter.
  drawAveraged(src, W, H) {
    const srcW = src.videoWidth || src.naturalWidth || W;
    let levels = 0;
    while (W << (levels + 1) <= srcW) levels++;
    if (!this.mips || this.mips.length !== levels || this.mipsFor !== W) {
      this.mipsFor = W;
      this.mips = Array.from({ length: levels }, (_, i) => {
        const c = document.createElement('canvas');
        c.width = W << (levels - i);
        c.height = H << (levels - i);
        return c.getContext('2d');
      });
    }
    let prev = src;
    for (const m of this.mips) {
      m.imageSmoothingQuality = 'high';
      m.drawImage(prev, 0, 0, m.canvas.width, m.canvas.height);
      prev = m.canvas;
    }
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(prev, 0, 0, W, H);
  }

  // Aggregates columns [x0, x1) of a layer, x in 0..1.
  column(layer, x0, x1) {
    const st = layer.stats;
    const W = this.width;
    const a = Math.max(0, Math.floor(x0 * W));
    const b = Math.min(W, Math.max(a + 1, Math.floor(x1 * W)));
    let w = 0, y = 0, val = 0, flash = 0;
    for (let x = a; x < b; x++) {
      const cw = st.colW[x];
      w += cw; y += cw * st.colY[x]; val += cw * st.colVal[x];
      flash = Math.max(flash, st.colFlash[x]);
    }
    const span = b - a;
    return {
      weight: w / span,
      y: w > 0 ? y / w : 0.5,
      value: w > 0 ? val / w : 0,
      flash,
    };
  }
}
