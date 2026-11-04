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

test("guessStore: erste Wortzeile ohne Preis", () => {
  assert.equal(guessStore("\n  REWE   Markt GmbH \nMILCH 1,09\n"), "REWE Markt GmbH");
  assert.equal(guessStore("12.11.2026\nDM drogerie markt\nZahnpasta 1,45"), "DM drogerie markt");
  assert.equal(guessStore("MILCH 1,09\nSUMME 1,09"), "");
});

test("parser: leer / Müll -> keine Posten", () => {
  assert.deepEqual(parseReceiptItems(""), []);
  assert.deepEqual(parseReceiptItems("nur text ohne preise\nnoch eine zeile"), []);
});
