// Made-up demo month for screenshots (README, website). Never real expenses.
const rows = [
  // [date, euro, text, category]
  ["2026-10-02", 4.5, "Döner mit Lea", "Essen"],
  ["2026-10-03", 12.99, "Spotify + iCloud", "Handy & Abos"],
  ["2026-10-05", 2.2, "Club-Mate", "Getränke"],
  ["2026-10-07", 9.5, "Kino", "Freizeit"],
  ["2026-10-09", 3.8, "Bäcker", "Essen"],
  ["2026-10-11", 24.95, "Hoodie (Second Hand)", "Kleidung"],
  ["2026-10-14", 6.4, "Collegeblock + Stifte", "Schule"],
  ["2026-10-16", 5.9, "Pizza-Ecke", "Essen"],
  ["2026-10-18", 1.8, "Eistee", "Getränke"],
  ["2026-10-19", 7.0, "Bowling", "Freizeit"],
  ["2026-10-20", 3.49, "Duschgel", "Pflege"],
  ["2026-10-21", 4.2, "Mensa", "Essen"],
];
let n = 0;
const ex = (date, euro, text, cat) => ({ id: "demo" + n++, cents: Math.round(euro * 100), text, cat, date, receiptId: null, createdAt: 0 });
export const expenses = [
  ...rows.map((r) => ex(...r)),
  // earlier months for the history tab
  ...[["2026-09", 118.4], ["2026-08", 131.2], ["2026-07", 96.75], ["2026-06", 109.9]].flatMap(([m, total]) => [
    ex(`${m}-05`, total * 0.45, "Essen unterwegs", "Essen"),
    ex(`${m}-12`, total * 0.3, "Freizeit", "Freizeit"),
    ex(`${m}-20`, total * 0.25, "Kleidung", "Kleidung"),
  ]),
];
export const settings = { allowanceCents: 12000, name: "", allowanceHist: {} };
