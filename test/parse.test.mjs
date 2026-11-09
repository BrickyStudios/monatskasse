import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReceiptItems, guessStore } from "../www/parse.js";
import { parseEuroToCents, formatCents, formatEuro } from "../www/money.js";

test("money: deutsches Format -> Cent", () => {
  assert.equal(parseEuroToCents("12,50"), 1250);
  assert.equal(parseEuroToCents("1.234,56"), 123456);
  assert.equal(parseEuroToCents("12.50"), 1250);   // Punkt als Dezimal ohne Komma
  assert.equal(parseEuroToCents("7"), 700);
  assert.equal(parseEuroToCents("3,99 €"), 399);
  assert.equal(parseEuroToCents(""), null);
  assert.equal(parseEuroToCents("abc"), null);
});

test("money: Cent -> Anzeige", () => {
  assert.equal(formatCents(1250), "12,50");
  assert.equal(formatCents(-500), "-5,00");
  assert.equal(formatEuro(399), "3,99 €");
});

test("parser: echter dm/rewe-artiger Bon", () => {
  const bon = [
    "REWE Markt GmbH",
    "Bahnhofstr. 1",
    "",
    "MILCH 3.5%        1,09 A",
    "BIO BROT          2,49 A",
    "2 x NUDELN        0,99",
    "COLA ZERO 1,5L    1,79 B",
    "------------------------",
    "SUMME             6,36",
    "BAR               10,00",
    "RÜCKGELD          3,64",
    "MwSt A 7%         0,41",
  ].join("\n");

  const items = parseReceiptItems(bon);
  const names = items.map((i) => i.name);

  assert.ok(names.includes("MILCH 3.5%"), "Milch erkannt");
  assert.ok(names.includes("BIO BROT"), "Brot erkannt");
  assert.ok(names.includes("NUDELN"), "Mengen-Präfix '2 x' entfernt");
  assert.ok(names.includes("COLA ZERO 1,5L"), "Cola erkannt");
  // Summe/Zahlung/Steuer dürfen NICHT als Posten auftauchen.
  assert.ok(!names.some((n) => /summe|bar|rückgeld|mwst/i.test(n)), "keine Nicht-Posten");

  const nudeln = items.find((i) => i.name === "NUDELN");
  assert.equal(nudeln.cents, 99);
});

test("parser: Stoppwörter nur als ganze Wörter", () => {
  const items = parseReceiptItems([
    "JOGHURT BECHER   0,79",
    "SPECK WÜRFEL     1,99",
    "BARILLA SPAGH.   1,49",
    "POSTKARTE        0,95",
    "EC-Cash          5,22",
    "Gesamtbetrag     5,22",
    "RÜCKGELD         0,00",
  ].join("\n"));
  assert.deepEqual(items.map((i) => i.name), ["JOGHURT BECHER", "SPECK WÜRFEL", "BARILLA SPAGH", "POSTKARTE"]);
});

test("parser: Steuerklasse als Ziffer verlesen (echte OCR-Ausgabe)", () => {
  const items = parseReceiptItems([
    "CHIPS PAPRIKA 1,738",      // "1,73 B", Leerzeichen verschluckt, B -> 8
    "KAFFEE GEMAHLEN 3,17 8",   // B -> 8
    "PAPRIKA ROT 0,774",        // A -> 4
    "MILCH 3,5% 1,099 A",
    "COLA ZERO 1,5L 1-79 B",    // Komma als Bindestrich
    "PFAND RUECKGABE -0,25",
    "SUMME EUR 34,06",
    "12.11.2026 14:32",
    "Datum 2026-11-05",
  ].join("\n"));
  assert.deepEqual(items.map((i) => [i.name, i.cents]), [
    ["CHIPS PAPRIKA", 173], ["KAFFEE GEMAHLEN", 317], ["PAPRIKA ROT", 77], ["MILCH 3,5%", 109], ["COLA ZERO 1,5L", 179],
  ]);
});

test("parser: Zeilen aus echten Bon-Fotos (Wikimedia Commons + dm)", () => {
  const items = parseReceiptItems([
    "Subbelratherstraße 387-407",           // Hausnummer, kein Preis
    "Nø tan today Sunless Self Tan 12,95 1", // dm: Menge hinten
    "4015400835974 PAMPERS PP GR2 MIDI €7,85 A", // Rossmann: EAN vorn, € vor dem Preis
    "*Diesel SB A 76,64 EUR*",               // Tankstelle
    "0,720 KG x 11,49",                      // Gewicht x Kilopreis, Posten folgt darunter
    "RI GULASCH A.D.KEU 8,27 E",
    "2xLatte Macchiato à 4.50 CHF 9.00",
    "1=19,00% 12,95 10,88 2,07",             // MwSt-Tabelle
    "A 7% 0,53 7,51 8,04",
    "E 7,0% 0,82 11,68 12,50",
    "E 1319,00 12,95 1068 2,07",             // dieselbe Zeile, % verschluckt (echte OCR vom dm-Bon)
    "BARGELD 50,00",
    "ZURÜCK 24,26",
    "Maestro Chip €7,85",
    "haben Sie einen Rabatt in Höhe von 2,53",
  ].join("\n"));
  assert.deepEqual(items.map((i) => [i.name, i.cents]), [
    ["Nø tan today Sunless Self Tan", 1295], ["PAMPERS PP GR2 MIDI", 785], ["Diesel SB A", 7664],
    ["RI GULASCH A.D.KEU", 827], ["Latte Macchiato à 4.50 CHF", 900],
  ]);
});

test("parser: nach der Endsumme ist Schluss, Zwischensumme zählt nicht", () => {
  const items = parseReceiptItems([
    "GESCHIRRSPÜLTABS 2,85 D",
    "ZWI.SUMME 2,85",
    "0,682 KG.x 2,49",
    "KARTOFFELN LOSE 1,70 E",
    "1=19,00% 12 950788 2,07",   // echte OCR der dm-MwSt-Zeile
    "CREME FRAICHE 30% 0,99 E",
    "SUMME EUR 5,54",
    "02021 2956 79,73",          // Telefonnummer in der Fußzeile
    "13(3&006 1145 ) 14:12 04 5,20",
  ].join("\n"));
  assert.deepEqual(items.map((i) => [i.name, i.cents]), [
    ["GESCHIRRSPÜLTABS", 285], ["KARTOFFELN LOSE", 170], ["CREME FRAICHE 30%", 99],
  ]);
});

test("guessStore: erste Wortzeile ohne Preis", () => {
  assert.equal(guessStore("\n  REWE   Markt GmbH \nMILCH 1,09\n"), "REWE Markt GmbH");
  assert.equal(guessStore("12.11.2026\nDM drogerie markt\nZahnpasta 1,45"), "DM drogerie markt");
  assert.equal(guessStore("MILCH 1,09\nSUMME 1,09"), "");
});

test("parser: leer / Müll -> keine Posten", () => {
  assert.deepEqual(parseReceiptItems(""), []);
  assert.deepEqual(parseReceiptItems("nur text ohne preise\nnoch eine zeile"), []);
});
