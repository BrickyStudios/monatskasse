/**
 * Schwarz/weiß mit lokaler Schwelle (Mittelwert im Fenster win×win, Pixel um c dunkler = Schrift).
 * Tesseracts globale Schwelle kippt bei Handschatten und blassem Thermopapier; dann fehlt v. a. das
 * kleine Komma ("12595" statt "12,95"). rgba = ImageData.data, wird überschrieben.
 */
export function binarize(rgba, w, h, win, c = 20) {
  const W = w + 1, sum = new Uint32Array(W * (h + 1)), g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, v = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
      g[y * w + x] = v; row += v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const r = win >> 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), n = (x1 - x0) * (y1 - y0);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = g[y * w + x] * n < s - c * n ? 0 : 255;
    }
  }
  return rgba;
}
