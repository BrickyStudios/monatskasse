// Renders the README/website screenshots from the web app with made-up demo data (tools/demo-data.mjs).
// Run: python3 -m http.server 8471 -d www &  then  node tools/screenshots.mjs <receipt.jpg> <out-dir>
// Needs playwright-core and a Chromium; paths via PLAYWRIGHT_CORE and CHROMIUM.
import { createRequire } from "module";
import { expenses, settings } from "./demo-data.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const [receipt, out] = process.argv.slice(2);
const URL = "http://127.0.0.1:8471/";

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || "/usr/bin/chromium" });
async function phone(scheme) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "de-DE", colorScheme: scheme, serviceWorkers: "block" });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date("2026-10-21T17:30:00"));
  await p.addInitScript(([e, s]) => {
    if (!localStorage.getItem("monatskasse.expenses")) {
      localStorage.setItem("monatskasse.expenses", JSON.stringify(e));
      localStorage.setItem("monatskasse.settings", JSON.stringify(s));
    }
  }, [expenses, settings]);
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(900);
  return p;
}
const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png` });

const p = await phone("light");
await shot(p, "1-monat");
await p.tap('.tab[data-view="history"]'); await p.waitForTimeout(500);
await shot(p, "2-verlauf");
await p.tap('.tab[data-view="overview"]'); await p.waitForTimeout(400);
await p.tap("#fab"); await p.waitForTimeout(700);
await p.fill("#exp-amount", "9,65"); await p.fill("#exp-text", "Frischmarkt"); await p.fill("#exp-cat", "Essen");
await p.setInputFiles("#exp-photo", receipt); await p.waitForTimeout(800);
await p.locator("#exp-amount").blur(); await p.waitForTimeout(300);
await shot(p, "3-ausgabe");
await p.tap("#ocr-btn");
await p.waitForSelector("#sheet-ocr.is-open, #sheet-ocr.open", { timeout: 90_000 }).catch(() => {});
await p.waitForTimeout(1500);
await shot(p, "4-kassenbon");

const d = await phone("dark");
await shot(d, "5-monat-dunkel");
await b.close();
console.log("done");
