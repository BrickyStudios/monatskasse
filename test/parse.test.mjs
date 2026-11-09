import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReceiptItems, parseReceipt, betterRead, readFits, guessStore } from "../www/parse.js";
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

test("parser: Total/Bar im Produktnamen sind Posten, Abbruch nur am Zeilenanfang", () => {
  const r = parseReceipt([
    "COLGATE TOTAL 2,95",
    "PROTEIN BAR 1,49",
    "Netto-Summe 4,44",          // kein Abbruch
    "MwSt gesamt 0,81",          // kein Abbruch
    "BALEA DUSCHE 0,95",
    "SUMME EUR 5,39",
    "BAR 10,00",
    "BROT 2,49",                 // nach der Summe: Fußzeile
  ].join("\n"));
  assert.deepEqual(r.items.map((i) => i.name), ["COLGATE TOTAL", "PROTEIN BAR", "BALEA DUSCHE"]);
  assert.equal(r.total, 539);
  for (const t of ["Zu zahlen 5,54", "Gesamtsumme 5,54", "Endsumme 5,54", "Total : CHF 5.54", "y ZU ZAHLEN EURO 5,54"])
    assert.deepEqual(parseReceiptItems(`${t}\nBROT 2,49`), [], t);
});

test("parser: Mengen- und MwSt-Regeln treffen keine Produkte", () => {
  assert.deepEqual(parseReceiptItems([
    "ARIEL 3X 5,99", "Duplo 10x 2,99", "Milch * 1,09", "QUARK 5% 0,79 A", "FRISCHKAESE 16% 1,29 A", "PILS 5% 0,89",
    "0,720 KG x 11,49", "2 x 0,49", "2 BE X 0,99 EP", "0,682 KG.x 2,49",
    "*C 7,00% 18,3E 1,28", "KA 1=19,00% 12 950788 2,07",
  ].join("\n")).map((i) => [i.name, i.cents]), [
    ["ARIEL 3X", 599], ["Duplo 10x", 299], ["Milch", 109], ["QUARK 5%", 79], ["FRISCHKAESE 16%", 129], ["PILS 5%", 89],
  ]);
});

test("parser: verlesene Summe (= Summe der Posten davor) wird kein Posten", () => {
  const r = parseReceipt("BROT 2,49\nMILCH 1,19\nSUMNE 3,68\nBAR 5,00");
  assert.deepEqual(r.items.map((i) => i.cents), [249, 119]);
  assert.equal(r.total, 368);
});

test("betterRead: Posten = Bon-Summe schlägt mehr Posten, sonst Anzahl, dann Konfidenz", () => {
  const read = (text, confidence) => ({ ...parseReceipt(text), confidence });
  const fits = read("BROT 2,49\nMILCH 1,19\nSUMME 3,68", 40);
  const more = read("BROT 2,49\nMILCH 1,19\nKAESE 3,99\nSUMME 9,99", 90);
  assert.equal(readFits(fits), true);
  assert.equal(readFits(more), false);
  assert.equal(betterRead(more, fits), fits);
  assert.equal(betterRead(read("BROT 2,49", 90), read("BROT 2,49\nMILCH 1,19", 30)).items.length, 2);
  assert.equal(betterRead(read("BROT 2,49", 50), read("BROT 2,49", 70)).confidence, 70);
});

test("parser: Zufallstreffer = Summe davor bleibt Posten, verlesene Summe nicht (Review Pass 2)", () => {
  // echte Posten, deren Preis zufällig die Summe davor ist
  for (const bon of [
    "BUTTER 1,99\nMILCH 1,00\nBROT 2,99\nKAESE 3,49\nSUMME 9,47",
    "BROT 1,00\nMILCH 1,00\nKAESE 2,00\nSUMME 4,00",
    "Brötchen 0,40\nBrötchen 0,40\nBrezel 0,80\nMilch 1,09\nSUMME 2,69",
  ]) {
    const r = parseReceipt(bon);
    assert.equal(r.items.length, bon.split("\n").length - 1, bon);
    assert.ok(readFits(r), bon);
  }
  assert.equal(parseReceiptItems("BROT 2,49\nBROT 2,49\nMILCH 1,19").length, 3);
  // verlesene Summenzeile mit summenähnlichem Namen: kein Posten
  assert.deepEqual(parseReceipt("BROT 2,49\nMILCH 1,19\n5UMME 3,68\nKARTE 3,68").items.length, 2);
  // ganz unleserliche Summenzeile am Ende: bleibt sichtbar, aber nicht angehakt
  const u = parseReceipt("BROT 2,49\nMILCH 1,19\nKAESE 2,00\nXq#v 5,68");
  assert.deepEqual(u.items.map((i) => [i.cents, !!i.unsure]), [[249, false], [119, false], [200, false], [568, true]]);
});

test("parser: ZW SUMME, Summe Netto/Rabatt/Leergut, TOTAL WASCHMITTEL brechen nicht ab", () => {
  const r = parseReceipt([
    "BROT 2,49", "ZW SUMME 2,49", "Summe netto 2,09", "Summe Leergut 0,25", "BAR 10,00",
    "TOTAL WASCHMITTEL 4,99", "Gesamtrabatt 0,50", "MILCH 1,19", "SUMME 8,67",
  ].join("\n"));
  assert.deepEqual(r.items.map((i) => i.name), ["BROT", "TOTAL WASCHMITTEL", "MILCH"]);
  assert.equal(r.total, 867);
});

test("parser: Prozent vorn ist Fettgehalt, Rabatt/Pfand zählen bei der Bon-Summe mit", () => {
  assert.deepEqual(parseReceiptItems("3,5% VOLLMILCH 1,09\n1,5% H-MILCH 0,99\n15% SCHMAND 0,89").map((i) => i.cents), [109, 99, 89]);
  assert.ok(readFits(parseReceipt("Kaese 2,49\nRabatt -0,50\nBrot 1,29\nPFAND RUECKGABE -0,25\nSUMME 3,03")));
});

test("parser: Review Pass 3 — SUB TOTAL, Geg. Bar, Produkte mit Summenwort/Prozent vorn", () => {
  const r = parseReceipt("MILCH 1,19\nBROT 2,49\nSUB TOTAL 3,68\nGRAND TOTAL 3,68\nTOTAL 3,68\nGeg. Bar 5,00\nZahlung bar 5,00");
  assert.deepEqual(r.items.map((i) => i.name), ["MILCH", "BROT"]);
  assert.equal(r.total, 368);
  assert.deepEqual(parseReceiptItems("MILCH 1,19\nBROT 2,49\nGeg. Bar 5,00\nZahlung bar 5,00").map((i) => i.name), ["MILCH", "BROT"]);
  for (const p of ["TOTAL WASCHMITTEL", "SUMMER ROLLS"]) {
    const q = parseReceipt(`BROT 2,49\nMILCH 2,50\n${p} 4,99\nKAESE 1,00\nSUMME 10,98`);
    assert.deepEqual(q.items.map((i) => i.name), ["BROT", "MILCH", p, "KAESE"], p);
    assert.equal(q.total, 1098);
  }
  assert.deepEqual(parseReceiptItems("5% FETT QUARK 0,99\n* 7% Joghurt 0,99\nB 19 % 1,59").map((i) => i.cents), [99, 99]);
  assert.equal(parseReceipt("BROT 2,49\nSumme (2 Artikel) 3,68").total, 368);
});

test("parser: Minus nur als Rabatt, wenn es danach aussieht; Datum ist kein Preis", () => {
  const r = parseReceipt("Datum 09-11-26\nBon 4711 09.11.2026\nKAFFEE-4,99\nLeergut 0,25-\nRabatt -0,50\nSUMME 4,24");
  assert.deepEqual(r.items.map((i) => [i.name, i.cents]), [["KAFFEE", 499]]);
  assert.equal(r.adjust, -75);
  assert.ok(readFits(r));
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
