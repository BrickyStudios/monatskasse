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
  "bargeld", "zurück", "zurueck", "maestro", "vpay", "v pay", "amex", "contactless", "rabatt",
];
// Nur ganze Wörter: sonst fliegen "Becher" (ec), "Speck" (ec), "Barilla" (bar) raus.
const STOP_RE = new RegExp(
  `(?<!\\p{L})(?:${STOPWORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?!\\p{L})`,
  "iu",
);

// Preis am Zeilenende: 1,99 | 12,50 | 1.234,56 ; danach bis zu zwei Anhängsel: Steuerklasse (A/B/E/V),
// Menge ("12,95 1" bei dm), EUR, *, €: "76,64 EUR*".
// OCR liest die Steuerklasse oft als Ziffer (B -> 8, A -> 4) und klebt sie an: "1,738", "3,17 8";
// das kleine Komma auf Thermopapier kommt manchmal als Bindestrich an: "1-79" (aber nicht "387-407").
const PRICE_END = /(-?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}|-\d{2}(?!\d)))\d?(?:\s*(?:[*%€]|eur|[a-z\d])(?![a-z])){0,2}\s*$/i;

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
    const cents = parseEuroToCents(m[1].replace(/(\d)-(?=\d{2}$)/, "$1,"));
    if (cents == null || cents <= 0) continue;
    let name = trimmed.slice(0, m.index).trim();
    // MwSt-Tabelle: "A 7% 0,53 7,51 8,04", "1=19,00% 12 950788 2,07", ohne %: "1319,00 12,95 10,88 2,07".
    // Fettgehalt ("MILCH 3,5%", "CREME FRAICHE 30%") bleibt.
    if (/%.*\d[.,]\d{2}/.test(name) || /(^|[^\d.,])(5|7|16|19)([.,]0+)?\s*%/.test(name)) continue;
    if ((name.match(/\d[.,]\d{2}(?!\d)/g) || []).length >= 2) continue;
    if (/(^|[^\p{L}])[xX*]$/u.test(name)) continue; // "0,720 KG x 11,49", "0,682 KG.x": Kilopreis, Posten steht darunter
    name = name.replace(/^[^\p{L}\d]+/u, "");      // OCR-Krümel vorn: "* ", "| ", "; "
    name = name.replace(/^\d{7,}\s+/, "");          // EAN/Artikelnummer vorn
    // Mengen-Präfixe wie "2 x" oder "1x" am Anfang wegräumen.
    name = name.replace(/^\d+\s*[xX*]\s*/, "").trim();
    name = name.replace(/[.\-–·:€*\s]+$/, "").trim();
    if (name.length < 2) continue;      // reine Zahlenzeile / Rest
    if (/^\d+$/.test(name)) continue;
    if (isStopword(name)) {
      // Nach der Endsumme kommen nur Zahlung, Steuer und Fußzeile (Telefon, Kassen-Nr.): hier ist Schluss.
      if (/summe|zahlen|total|gesamt/i.test(name) && !/zw|sub|netto|mwst/i.test(name)) break;
      continue;
    }
    out.push({ name, cents });
  }
  return out;
}
