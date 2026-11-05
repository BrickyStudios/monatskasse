import { test } from "node:test";
import assert from "node:assert/strict";
import { textIsSideways } from "../www/orient.js";

// Mini-"Bon": Textzeilen aus zufälligen Tintenpunkten, dazwischen leere Papierstreifen.
function bon(w, h, sideways) {
  const px = new Uint8ClampedArray(w * h * 4).fill(230);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [along, across] = sideways ? [y, x] : [x, y];
    const ink = across % 12 < 8 && along > 10 && along < (sideways ? h : w) - 10 && rnd() < 0.45;
    if (ink) px.fill(40, (y * w + x) * 4, (y * w + x) * 4 + 3);
  }
  return px;
}

test("orient: gerader Bon bleibt, quer liegender wird erkannt", () => {
  assert.equal(textIsSideways(bon(120, 200, false), 120, 200), false);
  assert.equal(textIsSideways(bon(200, 120, true), 200, 120), true);
});

test("orient: leeres Bild dreht nicht", () => {
  assert.equal(textIsSideways(new Uint8ClampedArray(50 * 50 * 4).fill(200), 50, 50), false);
});
