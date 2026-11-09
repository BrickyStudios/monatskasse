import { parseEuroToCents } from "./money.js";

// Zeilen, die KEIN Einkaufsposten sind (Summen, Zahlung, Steuer, Kopf/Fuß).
const STOPWORDS = [
  "summe", "gesamt", "zwischensumme", "zu zahlen", "zu zahlende", "endsumme", "gesamtsumme",
  "gegeben", "rückgeld", "ruckgeld", "rueckgeld", "wechselgeld",
  "mwst", "ust", "steuer", "netto", "brutto", "eur", "euro",
  "karte", "kartenzahlung", "ec", "ec-cash", "girocard", "visa", "mastercard",
  "kontaktlos", "beleg", "danke", "vielen dank", "kundenbeleg",
  "datum", "uhrzeit", "terminal", "trace", "pos", "steuernr", "ust-id",
  "betrag", "gesamtbetrag", "endbetrag", "zahlbetrag", "posten",
  "kreditkarte", "debitkarte", "bankkarte",
  "bargeld", "zurück", "zurueck", "maestro", "vpay", "v pay", "amex", "contactless", "rabatt",
  "subtotal", "sub total", "sub-total", "grand total", "zahlung",
];
// Nur ganze Wörter: sonst fliegen "Becher" (ec), "Speck" (ec) raus. "Bar" und "Total" zählen nur am
// Zeilenanfang (BAR_START, TOTAL_START): "PROTEIN BAR", "COLGATE TOTAL" sind Produkte.
const STOP_RE = new RegExp(
  `(?<!\\p{L})(?:${STOPWORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?!\\p{L})`,
  "iu",
);

// Preis am Zeilenende: 1,99 | 12,50 | 1.234,56 ; danach bis zu zwei Anhängsel: Steuerklasse (A/B/E/V),
// Menge ("12,95 1" bei dm), EUR, *, €: "76,64 EUR*".
// OCR liest die Steuerklasse oft als Ziffer (B -> 8, A -> 4) und klebt sie an: "1,738", "3,17 8";
// das kleine Komma auf Thermopapier kommt manchmal als Bindestrich an: "1-79" (aber nicht "387-407").
const PRICE_END = /(-?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2}|-\d{2}(?!\d)))\d?(?:\s*(?:[*%€-]|eur|[a-z\d])(?![a-z])){0,2}\s*$/i;

// Endsumme am Zeilenanfang (OCR klebt oft 1–2 Krümel davor: "y ZU ZAHLEN"): danach kommen nur Zahlung, Steuer
// und Fußzeile (Telefon, Kassen-Nr.). Dahinter höchstens EUR/CHF: "Summe netto", "TOTAL WASCHMITTEL" sind keine.
const TOTAL_START = /^(?:\S{1,2}\s+)?(summe|zu zahlen\p{L}*|total|gesamt|gesamtsumme|gesamtbetrag|endsumme|endbetrag|zahlbetrag)(?!\p{L})/iu;
const BAR_START = /^(?:geg\.?\s*)?bar(?!\p{L})/iu;
// Verlesene Summenzeile: "SUMNE", "5UMME", "T0TAL", "6ESAMT", "ZU ZAHLFN".
const TOTAL_MISREAD = /^(?:\S{1,2}\s+)?([s5][uüv][mnhw]{1,2}[eo]|t[o0]ta[l1]|[g6]esam|zu\s*z?ahl)/iu;

// Nach dem Summenwort darf kein Produktwort mehr kommen ("SUMME EUR", "Summe (2 Artikel)" ja, "SUMMER ROLLS" nein).
function totalTail(name, m) {
  const rest = name.slice(m[0].length).replace(/(?<!\p{L})(euro?|chf|summe|betrag|artikel|posten)(?!\p{L})/giu, "");
  return !/\p{L}{4,}/u.test(rest);
}
function isTotalLine(name) {
  const m = name.match(TOTAL_START);
  return !!m && !/zw|sub/i.test(name) && totalTail(name, m); // "ZW SUMME", "Subtotal": Zwischensumme
}
function isMisreadTotal(name) {
  const m = name.match(TOTAL_MISREAD);
  return !!m && totalTail(name, m);
}

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
 * OCR-Rohtext -> Kandidaten-Posten und Endsumme laut Bon (Cent, null wenn keine gefunden).
 * adjust: Summe der Minus-Zeilen (Rabatt, Pfand-Rückgabe), unsure: letzter Betrag könnte die verlesene Summe sein.
 * @returns {{items: {name: string, cents: number, unsure?: boolean}[], total: number|null, adjust: number}}
 * Heuristik, bewusst großzügig: lieber einen Treffer zu viel (abwählbar/editierbar)
 * als einen zu wenig. Qualität hängt am OCR — Netz ist die editierbare Liste in der UI.
 */
export function parseReceipt(rawText) {
  const out = [];
  let total = null, sum = 0, adjust = 0; // adjust: Rabatt, Pfand-Rückgabe (negativ), zählt zur Bon-Summe
  if (!rawText) return { items: out, total, adjust };
  for (const line of String(rawText).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length < 3) continue;
    const m = trimmed.match(PRICE_END);
    if (!m) continue;
    const before = trimmed.slice(0, m.index);
    if (/\d[.\-/]?$/.test(before)) continue; // Teil eines Datums oder einer Nummer: "09.11.2026", "09-11-26"
    const cents = parseEuroToCents(m[1].replace(/^-/, "").replace(/(\d)-(?=\d{2}$)/, "$1,"));
    if (!cents) continue;
    // Rabatt/Pfand: "-0,50" nach Leerzeichen oder "0,25-" hinten. "KAFFEE-4,99" (Leerzeichen verschluckt) ist ein Posten.
    if ((m[1].startsWith("-") && !/\p{L}$/u.test(before)) || m[0].slice(m[1].length).includes("-")) { adjust -= cents; continue; }
    let name = before.trim();
    // MwSt-Tabelle: "A 7% 0,53 7,51 8,04", "1=19,00% 12 950788 2,07", ohne %: "1319,00 12,95 10,88 2,07".
    // Der Satz steht vorn oder nach "="; Fettgehalt ("QUARK 5%", "MILCH 3,5%", "CREME FRAICHE 30%") bleibt.
    if (/%.*\d[.,]\d{2}/.test(name)) continue;
    if (/(^\W*(?:[a-z\d]\W+)?|=\s*)(?<!\d[.,])(5|7|16|19)([.,]0+)?\s*%/i.test(name) && !/\p{L}{3,}/u.test(name)) continue;
    if ((name.match(/\d[.,]\d{2}(?!\d)/g) || []).length >= 2) continue;
    name = name.replace(/^[^\p{L}\d]+/u, "");      // OCR-Krümel vorn: "* ", "| ", "; "
    // "0,720 KG x 11,49", "0,682 KG.x", "2 x 0,49": Kilo-/Stückpreis, der Posten steht darunter ("ARIEL 3X" bleibt).
    if (/^\d+([.,]\d+)?\s*(kg|g|stk|st|be)?\.?\s*[x*]$/i.test(name)) continue;
    name = name.replace(/^\d{7,}\s+/, "");          // EAN/Artikelnummer vorn
    // Mengen-Präfixe wie "2 x" oder "1x" am Anfang wegräumen.
    name = name.replace(/^\d+\s*[xX*]\s*/, "").trim();
    name = name.replace(/[.\-–·:€*\s]+$/, "").trim();
    if (name.length < 2) continue;      // reine Zahlenzeile / Rest
    if (/^\d+$/.test(name)) continue;
    if (isTotalLine(name)) { total = cents; break; }
    if (BAR_START.test(name) || isStopword(name) || /rabatt|ersparnis/i.test(name)) continue;
    // Verlesene Summenzeile ("SUMNE 3,68"): Name ähnelt SUMME und der Betrag ist genau die Summe davor.
    if (out.length >= 2 && cents === sum + adjust && isMisreadTotal(name)) { total = cents; break; }
    out.push({ name, cents });
    sum += cents;
  }
  // Ganz unleserliche Summenzeile: letzter Betrag = Summe aller davor. Bleibt sichtbar, aber nicht angehakt,
  // denn genauso gut kann es ein echter Posten sein ("Brezel 0,80" nach 2× 0,40).
  const last = out[out.length - 1];
  if (total == null && out.length >= 3 && last.cents === sum - last.cents + adjust) last.unsure = true;
  return { items: out, total, adjust };
}

export function parseReceiptItems(rawText) {
  return parseReceipt(rawText).items;
}

/** Ergeben die Posten genau die Endsumme des Bons? Dann ist der Durchgang sehr wahrscheinlich richtig. */
export function readFits(r) {
  return r.total != null && r.items.length > 0 && r.items.reduce((s, i) => s + i.cents, 0) + (r.adjust || 0) === r.total;
}

/** Besserer von zwei OCR-Durchgängen ({items, total, confidence}): passt zur Bon-Summe, dann mehr Posten, dann Konfidenz. */
export function betterRead(a, b) {
  if (readFits(a) !== readFits(b)) return readFits(a) ? a : b;
  if (a.items.length !== b.items.length) return a.items.length > b.items.length ? a : b;
  return b.confidence > a.confidence ? b : a;
}
