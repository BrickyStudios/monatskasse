// Geld wird intern immer in Cent (Ganzzahl) gespeichert — keine Float-Rundungsfehler.

/** "12,50" | "12.50" | "1.234,56" | "12" -> Cent (Integer) oder null bei Unsinn. */
export function parseEuroToCents(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === "") return null;
  s = s.replace(/[€\s]/g, "");
  // Tausenderpunkte raus, Komma = Dezimaltrenner (deutsches Format bevorzugt).
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const euros = Number(s);
  if (!Number.isFinite(euros)) return null;
  return Math.round(euros * 100);
}

/** Cent -> "12,50" (ohne Währungszeichen). */
export function formatCents(cents) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = (abs / 100).toFixed(2).replace(".", ",");
  return (neg ? "-" : "") + s;
}

/** Cent -> "12,50 €". */
export function formatEuro(cents) {
  return formatCents(cents) + " €";
}
