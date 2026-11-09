import { test } from "node:test";
import assert from "node:assert/strict";
import { binarize } from "../www/binarize.js";

test("binarize: Schrift bleibt schwarz, Schatten wird weiß", () => {
  // Papier wird nach rechts dunkler (Handschatten 230 -> 90), Schrift ist 60 dunkler als ihr Umfeld.
  const w = 80, h = 20, px = new Uint8ClampedArray(w * h * 4);
  const paper = (x) => 230 - (140 * x) / w;
  const ink = (x, y) => y >= 8 && y < 12 && x % 10 < 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = paper(x) - (ink(x, y) ? 60 : 0);
    px.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
  }
  binarize(px, w, h, 15);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    assert.equal(px[(y * w + x) * 4], ink(x, y) ? 0 : 255, `Pixel ${x},${y}`);
});
