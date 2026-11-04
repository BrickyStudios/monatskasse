import { parseEuroToCents } from "./money.js";

// Zeilen, die KEIN Einkaufsposten sind (Summen, Zahlung, Steuer, Kopf/Fuß).
const STOPWORDS = [
  "summe", "gesamt", "total", "zwischensumme", "zu zahlen", "zu zahlende",
  "bar", "gegeben", "rückgeld", "ruckgeld", "rueckgeld", "wechselgeld",
  "mwst", "ust", "steuer", "netto", "brutto", "eur", "euro",
  "karte", "kartenzahlung", "ec", "ec-cash", "girocard", "visa", "mastercard",
  "kontaktlos", "beleg", "danke", "vielen dank", "kundenbeleg",
  "datum", "uhrzeit", "terminal", "trace", "pos", "steuernr", "ust-id",
  "betrag", "gesamtbetrag", "endbetrag", "zahlbetrag", "posten",
  "kreditkarte", "debitkarte", "bankkarte",
];
// Nur ganze Wörter: sonst fliegen "Becher" (ec), "Speck" (ec), "Barilla" (bar) raus.
const STOP_RE = new RegExp(
  `(?<!\\p{L})(?:${STOPWORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?!\\p{L})`,
  "iu",
);

// Preis am Zeilenende: 1,99 | 12,50 | 1.234,56 ; optional nachgestellte Steuerklasse (A/B) und Zeichen.
const PRICE_END = /(-?\d{1,3}(?:[.\s]\d{3})*[.,]\d{2})\s*(?:[*%]|[a-dA-D]|eur|€)?\s*$/;

function isStopword(name) {
  return STOP_RE.test(name);
}

/** Erste Zeile mit echtem Wort und ohne Preis = vermutlich der Laden ("REWE Markt"). */
export function guessStore(rawText) {
  for (const line of String(rawText || "").split(/\r?\n/)) {
    const t = line.trim();
    if ((t.match(/\p{L}/gu) || []).length < 3) continue;
    if (PRICE_END.test(t) || isStopword(t)) continue;
    return t.replace(/\s+/g, " ").slice(0, 32);
  }
  return "";
}

/**
 * OCR-Rohtext -> Kandidaten-Posten.
 * @returns {{name: string, cents: number}[]}
 * Heuristik, bewusst großzügig: lieber einen Treffer zu viel (abwählbar/editierbar)
 * als einen zu wenig. Qualität hängt am OCR — Netz ist die editierbare Liste in der UI.
 */
export function parseReceiptItems(rawText) {
  if (!rawText) return [];
  const out = [];
  for (const line of String(rawText).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length < 3) continue;
    const m = trimmed.match(PRICE_END);
    if (!m) continue;
    const cents = parseEuroToCents(m[1]);
    if (cents == null || cents <= 0) continue;
    let name = trimmed.slice(0, m.index).trim();
    // Mengen-Präfixe wie "2 x" oder "1x" am Anfang wegräumen.
    name = name.replace(/^\d+\s*[xX*]\s*/, "").trim();
    name = name.replace(/[.\-–·:]+$/, "").trim();
    if (name.length < 2) continue;      // reine Zahlenzeile / Rest
    if (/^\d+$/.test(name)) continue;
    if (isStopword(name)) continue;
    out.push({ name, cents });
  }
  return out;
}
