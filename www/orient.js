/**
 * Liegt der Text quer? rgba = ImageData.data eines kleinen Vorschaubilds (~400 px).
 * Waagerechte Textzeilen: Kanten-Summen pro Pixelzeile springen (Text/Lücke/Text), pro Spalte kaum.
 * Gerade Bons liegen bei Verhältnis <= 0,6, quer liegende bei >= 1,7; dazwischen nichts drehen.
 */
export function textIsSideways(rgba, w, h) {
  const g = (i, j) => rgba[(j * w + i) * 4 + 1];
  const rows = new Float64Array(h), cols = new Float64Array(w);
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    rows[j] += Math.abs(g(i + 1, j) - g(i, j));
    cols[i] += Math.abs(g(i, j + 1) - g(i, j));
  }
  const jump = (a) => {
    let d = 0, q = 0;
    for (let i = 0; i < a.length - 2; i++) { d += (a[i + 1] - a[i]) ** 2; q += a[i] ** 2; }
    return q ? d / q : 0;
  };
  return jump(cols) > 1.3 * jump(rows);
}
