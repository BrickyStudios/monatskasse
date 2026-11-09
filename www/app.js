import { parseEuroToCents, formatEuro, formatCents } from "./money.js";
import { parseReceiptItems, guessStore } from "./parse.js";
import { textIsSideways as isSideways } from "./orient.js";
import { binarize } from "./binarize.js";

const VERSION = "1.2.2";
const $ = (id) => document.getElementById(id);
const Cap = window.Capacitor;
const isNative = !!Cap?.isNativePlatform?.();
const P = Cap?.Plugins ?? {};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const DEFAULT_CATS = ["Essen", "Getränke", "Freizeit", "Kleidung", "Schule", "Geschenke"];
// Rot zuletzt: Rot bedeutet in der App schon "überzogen".
const PALETTE = [[0,122,255],[52,199,89],[255,149,0],[175,82,222],[48,176,199],[88,86,214],[214,160,0],[255,45,85],[162,132,94],[255,59,48]];
const GRAY = [142,142,147];       // "Sonstiges"
const GRAY_LIGHT = [199,199,204]; // "Weitere" — muss sich von Sonstiges abheben

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------- Haptik: nur bei echten Momenten (Sichern, Löschen, Wegwischen) ----------
function haptic(kind = "light") {
  const H = P.Haptics;
  if (isNative && H) {
    const call = kind === "success" ? H.notification({ type: "SUCCESS" })
      : kind === "warning" ? H.notification({ type: "WARNING" })
      : H.impact({ style: kind === "medium" ? "MEDIUM" : "LIGHT" });
    Promise.resolve(call).catch(() => {});
  } else navigator.vibrate?.(kind === "light" ? 8 : 14);
}

// ---------- Daten ----------
const LS_SET = "monatskasse.settings";
const LS_EXP = "monatskasse.expenses";
let settings = { allowanceCents: 22500, name: "", allowanceHist: {} };
let expenses = []; // {id, cents, text, cat, date "YYYY-MM-DD", receiptId|null, createdAt}
let viewMonth = currentMonth();
let firstRun = false; // nothing saved yet: the overview asks for the monthly budget instead of assuming 225 €
let view = "overview";

function sanitizeSettings(s) {
  const out = { allowanceCents: 22500, name: "", allowanceHist: {} };
  if (Number.isInteger(s?.allowanceCents) && s.allowanceCents >= 0) out.allowanceCents = s.allowanceCents;
  if (typeof s?.name === "string") out.name = s.name.slice(0, 40);
  if (s?.allowanceHist && typeof s.allowanceHist === "object")
    for (const [k, v] of Object.entries(s.allowanceHist))
      if (/^\d{4}-\d{2}$/.test(k) && Number.isInteger(v) && v >= 0) out.allowanceHist[k] = v;
  return out;
}
function sanitizeExpense(e) {
  if (!e || typeof e !== "object") return null;
  if (!Number.isInteger(e.cents) || e.cents <= 0 || e.cents >= 1e8) return null;
  if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
  return {
    id: typeof e.id === "string" && e.id ? e.id : uid(),
    cents: e.cents,
    text: String(e.text ?? "").slice(0, 80),
    cat: String(e.cat ?? "").slice(0, 30),
    date: e.date,
    receiptId: typeof e.receiptId === "string" && e.receiptId ? e.receiptId : null,
    createdAt: Number(e.createdAt) || 0,
  };
}
function loadState() {
  firstRun = localStorage.getItem(LS_SET) == null && localStorage.getItem(LS_EXP) == null;
  try { const s = JSON.parse(localStorage.getItem(LS_SET)); if (s) settings = sanitizeSettings(s); } catch {}
  try { const e = JSON.parse(localStorage.getItem(LS_EXP)); if (Array.isArray(e)) expenses = e.map(sanitizeExpense).filter(Boolean); } catch {}
}
function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { toast("Speichern fehlgeschlagen – Speicher voll?"); return false; }
}
const saveSettings = () => { firstRun = false; return persist(LS_SET, settings); };
const saveExpenses = () => persist(LS_EXP, expenses);

// Belegfotos in IndexedDB (localStorage wäre zu klein).
let dbPromise;
function idb() {
  return (dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open("monatskasse", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("receipts");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function idbReq(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("receipts", mode);
    const req = fn(tx.objectStore("receipts"));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}
const idbPut = (id, v) => idbReq("readwrite", (s) => s.put(v, id));
const idbGet = (id) => idbReq("readonly", (s) => s.get(id)).then((v) => v ?? null);
const idbDel = (id) => idbReq("readwrite", (s) => s.delete(id));
const idbKeys = () => idbReq("readonly", (s) => s.getAllKeys());
const idbClear = () => idbReq("readwrite", (s) => s.clear());

const thumbCache = new Map();
async function loadPhoto(id) {
  if (!id) return null;
  if (thumbCache.has(id)) return thumbCache.get(id);
  const d = await idbGet(id).catch(() => null);
  if (d) thumbCache.set(id, d);
  return d;
}
function gcReceipt(id) {
  if (!id || expenses.some((e) => e.receiptId === id)) return;
  thumbCache.delete(id);
  idbDel(id).catch(() => {});
}
async function sweepReceipts() {
  try {
    const used = new Set(expenses.map((e) => e.receiptId));
    for (const k of await idbKeys()) if (!used.has(k)) await idbDel(k);
  } catch {}
}

// ---------- Datum & Budget ----------
function pad(n) { return String(n).padStart(2, "0"); }
function monthKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function currentMonth() { return monthKey(new Date()); }
function todayISO() { const d = new Date(); return `${monthKey(d)}-${pad(d.getDate())}`; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
const monthName = (k) => MONTHS[+k.slice(5, 7) - 1];
const monthLabel = (k) => `${monthName(k)} ${k.slice(0, 4)}`;
const expMonth = (e) => e.date.slice(0, 7);
const validDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todayISO());
function shiftMonth(k, d) { const [y, m] = k.split("-").map(Number); return monthKey(new Date(y, m - 1 + d, 1)); }
function daysInMonth(k) { const [y, m] = k.split("-").map(Number); return new Date(y, m, 0).getDate(); }
const byNewest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt);
const monthExpenses = (k) => expenses.filter((e) => expMonth(e) === k).sort(byNewest);

/** Budget, das in Monat k galt — Änderungen wirken erst ab ihrem Monat. */
function allowanceFor(k) {
  const keys = Object.keys(settings.allowanceHist).filter((m) => m <= k).sort();
  return keys.length ? settings.allowanceHist[keys.at(-1)] : settings.allowanceCents;
}
function setAllowance(cents) {
  const h = settings.allowanceHist;
  if (!Object.keys(h).length) h["0000-00"] = settings.allowanceCents; // bisheriges Budget für alle alten Monate festhalten
  h[currentMonth()] = cents;
  settings.allowanceCents = cents;
  saveSettings();
}

const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const dayFmtShort = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });
function dayLabel(iso, short = false) {
  if (iso === todayISO()) return "Heute";
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === `${monthKey(y)}-${pad(y.getDate())}`) return "Gestern";
  const [Y, M, D] = iso.split("-").map(Number);
  const label = (short ? dayFmtShort : dayFmt).format(new Date(Y, M - 1, D));
  return Y === new Date().getFullYear() ? label : `${label} ${Y}`;
}
// Farben nach Reihenfolge der ersten Nutzung: bis 10 Kategorien nie doppelt, und stabil.
let catOrder = new Map();
function rebuildCatOrder() {
  catOrder = new Map();
  for (const e of [...expenses].sort((a, b) => byNewest(b, a)))
    if (e.cat && !catOrder.has(e.cat.toLowerCase())) catOrder.set(e.cat.toLowerCase(), catOrder.size);
}
function catColor(name) {
  return PALETTE[(catOrder.get(name.toLowerCase()) ?? 0) % PALETTE.length];
}
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------- Federphysik (Apple: Dämpfung + Response statt Dauer) ----------
function spring({ from, to, velocity = 0, response = 0.4, damping = 1, onUpdate, onComplete }) {
  const w = (2 * Math.PI) / response, k = w * w, c = 2 * damping * w;
  let x = from, v = velocity, last = performance.now(), raf = 0, alive = true;
  const step = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
    last = now;
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) { v += (-k * (x - to) - c * v) * h; x += v * h; }
    if (Math.abs(x - to) < 0.4 && Math.abs(v) < 8) { alive = false; onUpdate(to); onComplete?.(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => { alive = false; cancelAnimationFrame(raf); };
}
// Apples Projektion: wohin würde der Wisch auslaufen?
const project = (v, d = 0.998) => ((v / 1000) * d) / (1 - d);
const rubberband = (o, dim, c = 0.55) => (o * dim * c) / (dim + c * Math.abs(o));
function releaseVelocity(hist) {
  const last = hist.at(-1);
  let first = hist[0];
  for (const p of hist) if (last.t - p.t <= 100) { first = p; break; }
  const dt = (last.t - first.t) / 1000;
  return dt > 0.008 ? (last.y - first.y) / dt : 0;
}

// ---------- Ebenen: Zurück-Taste schließt immer das Oberste ----------
const layers = []; // [{name, dismiss}]
const pushLayer = (name, dismiss) => layers.push({ name, dismiss });
function dropLayer(name) { const i = layers.findLastIndex((l) => l.name === name); if (i >= 0) layers.splice(i, 1); }
function dismissTop() { const top = layers.at(-1); if (!top) return false; top.dismiss(); return true; }

// ---------- Sheet: 1:1 ziehen, mit Schwung wegwischen, jederzeit unterbrechbar ----------
function makeSheet(sheet, { onDismiss, top = false } = {}) {
  const scrim = el("div", "scrim" + (top ? " top" : ""));
  sheet.before(scrim);
  let y = 0, h = 0, open = false, stop = null, press = null;

  const set = (v) => {
    y = v;
    sheet.style.transform = `translate3d(0,${v}px,0)`;
    scrim.style.opacity = h ? String(Math.min(1, Math.max(0, 1 - v / h))) : "0";
  };
  const run = (to, velocity, response, damping, done) => {
    stop?.(); stop = null;
    if (reduceMotion.matches) { set(to); done?.(); return; }
    stop = spring({ from: y, to, velocity, response, damping, onUpdate: set, onComplete: () => { stop = null; done?.(); } });
  };

  scrim.addEventListener("click", () => onDismiss?.(0));
  for (const zone of sheet.querySelectorAll("[data-drag]")) {
    zone.addEventListener("pointerdown", (e) => {
      if (!open || (e.pointerType === "mouse" && e.button !== 0)) return;
      press = { id: e.pointerId, y0: e.clientY, base: y, dragging: false, hist: [{ y: e.clientY, t: e.timeStamp }], zone };
    });
    zone.addEventListener("pointermove", (e) => {
      if (!press || e.pointerId !== press.id) return;
      const dy = e.clientY - press.y0;
      if (!press.dragging) {
        if (Math.abs(dy) < 8) return; // Hysterese: erst ab 8 px ist es ein Zug, sonst ein Tipp
        press.dragging = true;
        stop?.(); stop = null;        // laufende Animation greifen — ab dem aktuellen Wert
        press.base = y;
        h = sheet.offsetHeight;
        try { zone.setPointerCapture(e.pointerId); } catch {}
      }
      let next = press.base + dy;
      if (next < 0) next = -rubberband(-next, h); // nach oben: weicher Widerstand statt harter Kante
      set(next);
      press.hist.push({ y: e.clientY, t: e.timeStamp });
      if (press.hist.length > 10) press.hist.shift();
    });
    const end = (e) => {
      if (!press || e.pointerId !== press.id) return;
      const p = press; press = null;
      if (!p.dragging) return;
      const v = e.type === "pointercancel" ? 0 : releaseVelocity(p.hist);
      if (y + project(v) > h * 0.42) onDismiss?.(v);
      else run(0, v, 0.32, v < -400 ? 0.8 : 1); // Federung nur, wenn Schwung im Spiel war
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  return {
    get isOpen() { return open; },
    open() {
      if (open) return;
      open = true;
      sheet.classList.add("is-open"); scrim.classList.add("is-open");
      h = sheet.offsetHeight;
      if (!stop) set(h + 24); // frisch: von unten; unterbrochenes Schließen: ab aktueller Position
      run(0, 0, 0.42, 1);
    },
    close(velocity = 0) {
      if (!open) return;
      open = false;
      h = sheet.offsetHeight;
      if (sheet.contains(document.activeElement)) document.activeElement.blur(); // Tastatur weg
      run(h + 24, Math.max(0, velocity), 0.34, 1, () => {
        sheet.classList.remove("is-open"); scrim.classList.remove("is-open");
        sheet.style.transform = "";
      });
    },
  };
}

const sheetExpense = makeSheet($("sheet-expense"), { onDismiss: (v) => { haptic("light"); closeExpense(v); } });
const sheetOcr = makeSheet($("sheet-ocr"), { onDismiss: (v) => { haptic("light"); closeOcr(v); }, top: true });
let lightboxOpen = false;
function syncLock() {
  document.documentElement.classList.toggle("locked", sheetExpense.isOpen || sheetOcr.isOpen || lightboxOpen);
}

// ---------- Toast (mit Rückgängig) ----------
let toastTimer = 0, toastExpire = null;
function flushToast() { const f = toastExpire; toastExpire = null; f?.(); }
function hideToast() { clearTimeout(toastTimer); $("toast").classList.remove("show"); }
function toast(text, { action, onAction, onExpire } = {}) {
  flushToast();
  const box = $("toast"), btn = $("toast-action");
  $("toast-text").textContent = text;
  btn.textContent = action || "";
  btn.classList.toggle("hidden", !action);
  box.classList.toggle("no-action", !action);
  btn.onclick = action ? () => { toastExpire = null; hideToast(); onAction?.(); } : null;
  toastExpire = onExpire || null;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { hideToast(); flushToast(); }, action ? 5000 : 2400);
}

// ---------- Übersicht ----------
let shownBalance = null; // {month, cents} für die Zähl-Animation
let balanceAnim = null;

function renderBalanceNumber(cents) {
  const bal = $("balance");
  bal.replaceChildren(document.createTextNode(formatCents(Math.abs(cents))), el("span", "cur", "€"));
}
function animateBalance(from, to) {
  balanceAnim?.();
  if (reduceMotion.matches || from === to) { renderBalanceNumber(to); return; }
  let alive = true; const t0 = performance.now(), dur = 520;
  const tick = (now) => {
    if (!alive) return;
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    renderBalanceNumber(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(tick); else balanceAnim = null;
  };
  requestAnimationFrame(tick);
  balanceAnim = () => { alive = false; };
}

function monthBounds() {
  const cur = currentMonth();
  let min = cur, max = cur;
  for (const e of expenses) { const m = expMonth(e); if (m < min) min = m; if (m > max) max = m; }
  return { min, max };
}

function renderOverview(dir = 0) {
  rebuildCatOrder();
  const cur = currentMonth();
  const list = monthExpenses(viewMonth);
  const allowance = allowanceFor(viewMonth);
  const spent = list.reduce((s, e) => s + e.cents, 0);
  const left = allowance - spent;
  const isCur = viewMonth === cur, isPast = viewMonth < cur;

  $("month-name").textContent = monthName(viewMonth);
  $("month-year").textContent = viewMonth.slice(0, 4);
  const { min, max } = monthBounds();
  $("prev-month").disabled = viewMonth <= min;
  $("next-month").disabled = viewMonth >= max;
  const back = $("back-current");
  back.classList.toggle("hidden", isCur);
  back.textContent = `Zurück zu ${monthName(cur)}`;

  $("hero-label").textContent = left < 0 ? "Überzogen um" : isPast ? "Übrig geblieben" : "Noch übrig";
  if (shownBalance?.month === viewMonth) animateBalance(shownBalance.cents, left);
  else { balanceAnim?.(); renderBalanceNumber(left); }
  shownBalance = { month: viewMonth, cents: firstRun ? 0 : left }; // after the welcome, the budget counts up from 0
  $("balance").classList.toggle("over", left < 0);
  document.querySelector("#view-overview .hero").classList.toggle("hidden", firstRun);

  const share = allowance > 0 ? Math.max(0, Math.min(1, left / allowance)) : 0;
  const fill = $("meter-fill");
  fill.style.width = (left < 0 ? 100 : share * 100) + "%";
  fill.classList.toggle("over", left < 0);
  fill.classList.toggle("warn", left >= 0 && share < 0.2);
  $("meter").setAttribute("aria-valuenow", String(Math.round(share * 100)));

  const spentEl = $("spent");
  spentEl.replaceChildren(el("b", null, formatEuro(spent)), document.createTextNode(` von ${formatEuro(allowance)} ausgegeben`));

  // Tempo-Hinweis: wie viel pro Tag noch drin ist
  const pace = $("pace");
  pace.className = "pace";
  let paceText = "";
  if (isCur) {
    const days = daysInMonth(viewMonth) - new Date().getDate() + 1;
    if (left > 0) {
      paceText = days === 1 ? `Letzter Tag im Monat · ${formatEuro(left)} frei` : `Noch ${days} Tage · etwa ${formatEuro(Math.floor(left / days))} pro Tag`;
      pace.classList.add("good");
    } else if (left === 0) paceText = "Budget genau aufgebraucht";
    else { paceText = days === 1 ? "Morgen gibt es neues Budget" : `Noch ${days} Tage bis zum neuen Budget`; pace.classList.add("bad"); }
  } else if (!isPast) paceText = `Beginnt am 1. ${monthName(viewMonth)}`;
  pace.textContent = paceText;
  pace.classList.toggle("hidden", !paceText);

  renderCategories(list);
  renderDays(list, { isCur, isPast, allowance });

  if (dir && !reduceMotion.matches) {
    for (const n of document.querySelectorAll("#view-overview .hero, #cat-section, #days, #empty")) {
      n.animate([{ opacity: 0, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: "none" }],
        { duration: 280, easing: "cubic-bezier(.22,1,.36,1)" });
    }
  }
}

function renderCategories(list) {
  const section = $("cat-section");
  const hasCat = list.some((e) => e.cat);
  section.classList.toggle("hidden", !hasCat);
  if (!hasCat) return;
  const sums = new Map();
  for (const e of list) sums.set(e.cat, (sums.get(e.cat) || 0) + e.cents);
  let entries = [...sums].sort((a, b) => b[1] - a[1]);
  if (entries.length > 6) entries = [...entries.slice(0, 5), [null, entries.slice(5).reduce((s, [, c]) => s + c, 0)]];
  const stack = $("cat-stack"), legend = $("cat-legend");
  stack.replaceChildren(); legend.replaceChildren();
  for (const [cat, cents] of entries) {
    const color = cat ? catColor(cat) : cat === null ? GRAY_LIGHT : GRAY;
    const seg = el("span"); seg.style.flex = String(cents); seg.style.background = rgba(color);
    stack.append(seg);
    const item = el("li");
    const dot = el("span", "dot"); dot.style.background = rgba(color);
    item.append(dot, el("span", "name", cat === null ? "Weitere" : cat || "Sonstiges"), el("span", "amt", formatEuro(cents)));
    legend.append(item);
  }
}

function renderDays(list, { isCur, isPast, allowance }) {
  const days = $("days");
  days.replaceChildren();
  for (let i = 0; i < list.length;) {
    const d = list[i].date, group = [];
    while (i < list.length && list[i].date === d) group.push(list[i++]);
    const head = el("div", "day-head");
    head.append(el("span", null, dayLabel(d)), el("span", null, formatEuro(group.reduce((s, e) => s + e.cents, 0))));
    const box = el("div", "group-box"), ul = el("ul", "list");
    for (const e of group) ul.append(expenseRow(e));
    box.append(ul);
    days.append(head, box);
  }
  $("count-meta").textContent = list.length ? `${list.length} ${list.length === 1 ? "Ausgabe" : "Ausgaben"}` : "";
  $("empty").classList.toggle("hidden", list.length > 0);
  const welcome = firstRun && isCur && !list.length;
  $("welcome").classList.toggle("hidden", !welcome);
  if (welcome) {
    $("empty-title").textContent = "Willkommen";
    $("empty-text").textContent = "Wie viel Geld hast du im Monat? Jede Ausgabe zieht davon ab.";
  } else if (!list.length) {
    $("empty-title").textContent = isCur ? "Noch nichts ausgegeben" : isPast ? "Keine Ausgaben" : "Noch nicht begonnen";
    $("empty-text").textContent = isCur ? `${formatEuro(allowance)} warten auf dich. Tippe auf +, wenn du etwas ausgibst.`
      : isPast ? "In diesem Monat wurde nichts eingetragen." : "Dieser Monat liegt noch in der Zukunft.";
  }
}

function expenseRow(e) {
  const li = el("li", "row press");
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  let lead;
  if (e.receiptId) {
    lead = el("img", "thumb");
    lead.alt = "Beleg";
    loadPhoto(e.receiptId).then((d) => { if (d) lead.src = d; });
    lead.addEventListener("click", (ev) => { ev.stopPropagation(); openLightbox(e.receiptId); });
  } else {
    lead = el("div", "avatar", e.cat ? [...e.cat][0].toUpperCase() : "€");
    if (e.cat) { const c = catColor(e.cat); lead.style.background = rgba(c, 0.16); lead.style.color = rgba(c); }
  }
  const main = el("div", "row-main");
  main.append(el("div", "row-title", e.text || e.cat || "Ausgabe"));
  if (e.text && e.cat) main.append(el("div", "row-sub", e.cat));
  li.append(lead, main, el("div", "row-amount", formatEuro(e.cents)));
  li.addEventListener("click", () => openExpense(e));
  li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") openExpense(e); });
  return li;
}

// ---------- Verlauf ----------
function renderHistory() {
  const cur = currentMonth();
  const byMonth = new Map([[cur, 0]]);
  for (const e of expenses) byMonth.set(expMonth(e), (byMonth.get(expMonth(e)) || 0) + e.cents);
  const keys = [...byMonth.keys()].sort().reverse();
  const ul = $("months");
  ul.replaceChildren();
  for (const k of keys) {
    const spent = byMonth.get(k), allowance = allowanceFor(k), left = allowance - spent;
    const li = el("li", "row press");
    li.style.setProperty("--inset", "16px");
    li.tabIndex = 0;
    const main = el("div", "row-main");
    main.append(el("div", "row-title", monthLabel(k) + (k === cur ? " · jetzt" : "")),
      el("div", "row-sub", left >= 0 ? `${formatEuro(left)} übrig` : `${formatEuro(-left)} überzogen`));
    const mm = el("div", "mini-meter"), bar = el("span", left < 0 ? "over" : "");
    bar.style.width = (left < 0 ? 100 : allowance ? (left / allowance) * 100 : 0) + "%";
    mm.append(bar); main.append(mm);
    li.append(main, el("div", "row-amount", formatEuro(spent)));
    li.insertAdjacentHTML("beforeend", '<svg class="row-chev" viewBox="0 0 10 16" width="9" height="15" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    const go = () => { viewMonth = k; selectTab("overview"); };
    li.addEventListener("click", go);
    li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
    ul.append(li);
  }
  const year = cur.slice(0, 4);
  const yearSum = expenses.filter((e) => e.date.startsWith(year)).reduce((s, e) => s + e.cents, 0);
  $("year-summary").replaceChildren(document.createTextNode(`${year} bisher: `), el("b", null, formatEuro(yearSum)), document.createTextNode(" ausgegeben"));
  $("history-empty").classList.toggle("hidden", expenses.length > 0);
}

// ---------- Einstellungen ----------
function renderSettings() {
  $("set-allowance").value = formatEuro(settings.allowanceCents);
  $("set-allowance").classList.remove("invalid");
  $("set-name").value = settings.name;
  $("version").textContent = `Monatskasse ${VERSION}`;
}

// ---------- Navigation ----------
function updateScrolled() {
  document.querySelector(`#view-${view} .topbar`)?.classList.toggle("scrolled", window.scrollY > 2);
}
function show(v) {
  view = v;
  for (const id of ["overview", "history", "settings"]) $("view-" + id).classList.toggle("hidden", id !== v);
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === v)));
  $("fab").classList.toggle("away", v !== "overview");
  window.scrollTo(0, 0);
  render();
  updateScrolled();
}
function render() {
  if (view === "overview") renderOverview();
  else if (view === "history") renderHistory();
  else renderSettings();
}
function selectTab(v) {
  if (v === view) {
    if (v === "overview") renderOverview();
    window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" }); // aktiven Tab antippen = nach oben
    return;
  }
  if (v === "overview") dropLayer("tab");
  else if (!layers.some((l) => l.name === "tab")) pushLayer("tab", () => selectTab("overview"));
  show(v);
}
function goMonth(delta) {
  viewMonth = shiftMonth(viewMonth, delta);
  renderOverview(delta);
}
/** "Immer der aktuelle Monat": beim Öffnen, Zurückkehren und Tageswechsel. */
function snapToCurrent() {
  viewMonth = currentMonth();
  if (view === "overview") renderOverview();
}

// ---------- Ausgabe-Sheet ----------
let editing = null;
let photo = { data: null, changed: false };

function openExpense(exp = null) {
  editing = exp;
  $("sheet-title").textContent = exp ? "Ausgabe bearbeiten" : "Neue Ausgabe";
  $("exp-amount").value = exp ? formatCents(exp.cents) : "";
  $("exp-text").value = exp?.text ?? "";
  $("exp-cat").value = exp?.cat ?? "";
  $("exp-date").value = exp?.date ?? todayISO();
  setDateLabel();
  $("amount-hint").textContent = "";
  $("delete-wrap").classList.toggle("hidden", !exp);
  photo = { data: null, changed: false };
  renderPhoto();
  if (exp?.receiptId) loadPhoto(exp.receiptId).then((d) => { if (editing === exp && !photo.changed) { photo.data = d; renderPhoto(); } });
  buildChips(); sizeAmount(); validate();
  sheetExpense.open();
  pushLayer("expense", () => closeExpense(0));
  syncLock();
  $("sheet-expense").querySelector(".sheet-body").scrollTop = 0;
  if (!exp) $("exp-amount").focus({ preventScroll: true }); // Tastatur direkt da — im Tipp-Handler, sonst blockt Android
}
function closeExpense(v = 0) {
  dropLayer("expense");
  sheetExpense.close(v);
  syncLock();
}

function amountCents() {
  const c = parseEuroToCents($("exp-amount").value);
  return c != null && c > 0 && c < 1e8 ? c : null;
}
function sizeAmount() {
  const i = $("exp-amount");
  i.style.width = Math.max(3, (i.value || i.placeholder).length) + 0.4 + "ch";
}
function validate() { $("save-expense").disabled = amountCents() == null; }
function setDateLabel() { $("date-label").textContent = dayLabel(validDate($("exp-date").value), true); }

function renderPhoto() {
  const has = !!photo.data;
  $("receipt").classList.toggle("hidden", !has);
  $("photo-label").textContent = has ? "Anderes Foto wählen" : "Beleg fotografieren";
  if (has) $("receipt-img").src = photo.data;
  $("ocr-btn").classList.toggle("hidden", !!editing); // OCR legt neue Ausgaben an — nur beim Neuanlegen
}

function buildChips() {
  const count = new Map();
  for (const e of expenses) if (e.cat) count.set(e.cat, (count.get(e.cat) || 0) + 1);
  const used = [...count].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const seen = new Set(), cats = [];
  for (const c of [...used, ...DEFAULT_CATS]) { const k = c.toLowerCase(); if (!seen.has(k)) { seen.add(k); cats.push(c); } }
  const box = $("cat-chips");
  box.replaceChildren();
  for (const c of cats.slice(0, 10)) {
    const b = el("button", "chip", c);
    b.type = "button";
    b.onclick = () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      $("exp-cat").value = on ? c : "";
      updateChips();
    };
    box.append(b);
  }
  box.scrollLeft = 0;
  updateChips();
}
function updateChips() {
  const cur = $("exp-cat").value.trim().toLowerCase();
  for (const b of $("cat-chips").children) b.setAttribute("aria-pressed", String(b.textContent.toLowerCase() === cur));
}

// Bild verkleinern: spart Speicher und macht OCR schneller/robuster.
// Liegt der Bon quer im Foto (Handy flach über dem Tisch, Lagesensor rät falsch), gleich geraderücken.
function downscale(file, max = 1600, quality = 0.82) {
  return new Promise((res) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = el("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(rotated(c, textIsSideways(c) ? 90 : 0).toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}

// Bild oder Canvas um 0/90/180/270° im Uhrzeigersinn drehen.
function rotated(src, deg) {
  if (!deg) return src;
  const q = deg % 180, c = el("canvas");
  c.width = q ? src.height : src.width; c.height = q ? src.width : src.height;
  const x = c.getContext("2d");
  x.translate(c.width / 2, c.height / 2); x.rotate((deg * Math.PI) / 180);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function textIsSideways(src) {
  const s = Math.min(1, 400 / Math.max(src.width, src.height));
  const w = Math.round(src.width * s), h = Math.round(src.height * s);
  const c = el("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h);
  return isSideways(x.getImageData(0, 0, w, h).data, w, h);
}
// Typische Wort-Höhe in px (Median), daraus Vergrößerung und Fenster für den zweiten Durchgang.
function wordHeight(data) {
  const hs = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words)
    if (wd.confidence > 50 && wd.text.length > 1) hs.push(wd.bbox.y1 - wd.bbox.y0);
  hs.sort((a, b) => a - b);
  return hs.length >= 5 ? hs[hs.length >> 1] : 0;
}
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function nudge(node) {
  node.classList.remove("shake");
  void node.offsetWidth;
  node.classList.add("shake");
}

async function saveExpense() {
  const cents = amountCents();
  if (cents == null) {
    $("amount-hint").textContent = "Bitte einen Betrag eingeben";
    nudge($("amount-wrap")); haptic("warning");
    return;
  }
  const fields = {
    cents,
    text: $("exp-text").value.trim().slice(0, 80),
    cat: $("exp-cat").value.trim().slice(0, 30),
    date: validDate($("exp-date").value),
  };
  const old = editing?.receiptId ?? null;
  let receiptId = old;
  if (photo.changed) {
    receiptId = null;
    if (photo.data) {
      receiptId = "r_" + uid();
      try { await idbPut(receiptId, photo.data); thumbCache.set(receiptId, photo.data); }
      catch { toast("Foto konnte nicht gespeichert werden."); return; }
    }
  }
  const wasEdit = !!editing;
  if (editing) Object.assign(editing, fields, { receiptId });
  else expenses.push({ id: uid(), ...fields, receiptId, createdAt: Date.now() });
  if (!saveExpenses()) return;
  if (photo.changed && old) gcReceipt(old);
  haptic("success");
  closeExpense(0);
  render();
  announceSaved(fields.date.slice(0, 7), wasEdit ? "Änderung gespeichert" : "Gespeichert");
}
function announceSaved(month, text) {
  if (view === "overview" && month !== viewMonth)
    toast(`In ${monthLabel(month)} gespeichert`, { action: "Anzeigen", onAction: () => { viewMonth = month; renderOverview(); } });
  else toast(text);
}

function deleteEditing() {
  const exp = editing;
  if (!exp) return;
  closeExpense(0);
  const idx = expenses.indexOf(exp);
  if (idx < 0) return;
  expenses.splice(idx, 1);
  saveExpenses(); render(); haptic("warning");
  // Vergeben statt nachfragen: sofort weg, aber 5 s rückgängig machbar
  toast("Ausgabe gelöscht", {
    action: "Rückgängig",
    onAction: () => { expenses.splice(Math.min(idx, expenses.length), 0, exp); saveExpenses(); render(); haptic("light"); },
    onExpire: () => gcReceipt(exp.receiptId),
  });
}

// ---------- OCR-Sheet ----------
let ocrJob = 0;
let lastOcr = { items: [], store: "" };
let tessLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return (tessLoading ??= new Promise((res, rej) => {
    const s = el("script");
    s.src = "vendor/tess/tesseract.min.js";
    s.onload = res;
    s.onerror = () => { tessLoading = null; rej(new Error("Tesseract nicht ladbar")); };
    document.head.append(s);
  }));
}
function setProgress(p) { $("ocr-progress").firstElementChild.style.width = Math.round(p * 100) + "%"; }

async function runOcr() {
  if (!photo.data) return;
  const job = ++ocrJob;
  $("ocr-status").textContent = "Texterkennung startet …";
  $("ocr-progress").classList.remove("hidden"); setProgress(0.04);
  for (const id of ["ocr-box", "ocr-total", "ocr-actions"]) $(id).classList.add("hidden");
  $("ocr-add").disabled = true; $("ocr-add").textContent = "Hinzufügen";
  sheetOcr.open();
  pushLayer("ocr", () => closeOcr(0));
  syncLock();
  const src = photo.data;
  let worker = null;
  try {
    await loadTesseract();
    // Absolute Pfade (relativ bricht im Worker); gzip:false, weil AGP die .gz-Sprachdatei beim
    // Bauen entpackt; cacheMethod none, sonst legt Tesseract 15 MB doppelt in IndexedDB ab.
    const base = location.origin + "/vendor/tess";
    let label = "Lese Bon";
    worker = await window.Tesseract.createWorker("deu", 1, {
      workerPath: base + "/worker.min.js", corePath: base + "/", langPath: base + "/",
      gzip: false, cacheMethod: "none",
      logger: (m) => {
        if (job !== ocrJob) return;
        if (m.status === "recognizing text") {
          setProgress(0.12 + m.progress * 0.88);
          $("ocr-status").textContent = `${label} … ${Math.round(m.progress * 100)} %`;
        }
      },
    });
    // Ein Textblock: im Standardmodus liest Tesseract Namen- und Preisspalte getrennt, dann fehlen alle Preise.
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    // Falsch herum gelesen liegt die Konfidenz bei 15–35, gerade bei 40–85 (echte Bon-Fotos): dann gedreht nochmal.
    const img = await loadImg(src);
    let best = null;
    for (const deg of [0, 180, 90, 270]) {
      const { data } = await worker.recognize(rotated(img, deg), {}, { blocks: true });
      if (job !== ocrJob) return;
      if (!best || data.confidence > best.confidence) best = { ...data, deg };
      if (best.confidence >= 40) break;
      label = "Foto steht schief, lese gedreht";
    }
    if (best.deg && photo.data === src) { photo.data = rotated(img, best.deg).toDataURL("image/jpeg", 0.82); renderPhoto(); }
    // Zweiter Durchgang, doppelt so groß und schwarz/weiß mit lokaler Schwelle: rettet Schatten, blasses
    // Thermopapier und kleine Kommas. Bei sauberen Scans liest der erste besser. Es gewinnt, wer mehr Posten findet.
    label = "Lese genauer";
    const h = wordHeight(best) || 15, straight = rotated(img, best.deg);
    const s = Math.min(2.5, Math.max(2, 30 / h), Math.sqrt(1e7 / (straight.width * straight.height)));
    const c = el("canvas"); c.width = Math.round(straight.width * s); c.height = Math.round(straight.height * s);
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(straight, 0, 0, c.width, c.height);
    const px = x.getImageData(0, 0, c.width, c.height);
    binarize(px.data, c.width, c.height, Math.round(2 * h * s));
    x.putImageData(px, 0, 0);
    const { data: fine } = await worker.recognize(c);
    if (job !== ocrJob) return;
    let text = best.text, items = parseReceiptItems(text);
    const fineItems = parseReceiptItems(fine.text);
    if (fineItems.length > items.length || (fineItems.length === items.length && fine.confidence > best.confidence)) {
      text = fine.text; items = fineItems;
    }
    lastOcr = { items, store: guessStore(text) };
    showOcrItems();
  } catch (err) {
    if (job !== ocrJob) return;
    console.error(err);
    $("ocr-progress").classList.add("hidden");
    $("ocr-status").textContent = "Texterkennung hat nicht geklappt. Trag die Ausgabe einfach von Hand ein.";
  } finally {
    worker?.terminate(); // gibt ~40 MB Sprachdaten + WASM frei
  }
}
function closeOcr(v = 0) {
  ocrJob++; // laufende Erkennung verwerfen
  dropLayer("ocr");
  sheetOcr.close(v);
  syncLock();
}
function showOcrItems() {
  const { items } = lastOcr;
  $("ocr-progress").classList.add("hidden");
  if (!items.length) {
    $("ocr-status").textContent = "Keine Posten erkannt. Ein schärferes, gerades Foto hilft – oder trag die Ausgabe von Hand ein.";
    return;
  }
  $("ocr-status").textContent = `${items.length} Posten erkannt. Prüf kurz Namen und Preise.`;
  const ul = $("ocr-items");
  ul.replaceChildren();
  for (const it of items) {
    const li = el("li", "row ocr-row");
    const cb = el("input", "check"); cb.type = "checkbox"; cb.checked = true; cb.setAttribute("aria-label", "Übernehmen");
    const name = el("input", "oi-name"); name.type = "text"; name.value = it.name; name.setAttribute("aria-label", "Name");
    const price = el("input", "oi-price"); price.type = "text"; price.inputMode = "decimal"; price.value = formatCents(it.cents); price.setAttribute("aria-label", "Preis");
    for (const n of [cb, name, price]) n.addEventListener("input", updateOcrTotal);
    li.append(cb, name, price);
    ul.append(li);
  }
  for (const id of ["ocr-box", "ocr-total", "ocr-actions"]) $(id).classList.remove("hidden");
  updateOcrTotal();
}
function selectedOcr() {
  return [...$("ocr-items").children].map((li) => {
    const [cb, name, price] = li.querySelectorAll("input");
    return { on: cb.checked, name: name.value.trim(), cents: parseEuroToCents(price.value) };
  }).filter((x) => x.on && x.cents > 0 && x.cents < 1e8);
}
function updateOcrTotal() {
  const sel = selectedOcr(), sum = sel.reduce((s, x) => s + x.cents, 0);
  $("ocr-total").replaceChildren(el("span", null, `${sel.length} ausgewählt`), el("b", null, formatEuro(sum)));
  $("ocr-add").disabled = !sel.length;
  $("ocr-add").textContent = sel.length ? `Hinzufügen (${sel.length})` : "Hinzufügen";
  $("ocr-single").disabled = !sel.length;
}
async function addOcrItems() {
  const sel = selectedOcr();
  if (!sel.length) return;
  const date = validDate($("exp-date").value), cat = $("exp-cat").value.trim().slice(0, 30);
  let receiptId = null;
  if (photo.data) {
    receiptId = "r_" + uid();
    try { await idbPut(receiptId, photo.data); thumbCache.set(receiptId, photo.data); } catch { receiptId = null; }
  }
  const now = Date.now();
  sel.forEach((x, i) => expenses.push({ id: uid(), cents: x.cents, text: x.name.slice(0, 80), cat, date, receiptId, createdAt: now + i }));
  if (!saveExpenses()) return;
  haptic("success");
  closeOcr(0); closeExpense(0);
  render();
  announceSaved(date.slice(0, 7), `${sel.length} Posten hinzugefügt`);
}
function takeOcrAsOne() {
  const sel = selectedOcr();
  if (!sel.length) return;
  $("exp-amount").value = formatCents(sel.reduce((s, x) => s + x.cents, 0));
  if (!$("exp-text").value.trim()) $("exp-text").value = lastOcr.store || "Einkauf";
  sizeAmount(); validate();
  haptic("light");
  closeOcr(0);
}

// ---------- Bildansicht ----------
async function openLightbox(receiptId, data) {
  const d = data || (await loadPhoto(receiptId));
  if (!d) return;
  $("lightbox-img").src = d;
  $("lightbox").classList.add("is-open");
  lightboxOpen = true;
  pushLayer("lightbox", closeLightbox);
  syncLock();
}
function closeLightbox() {
  dropLayer("lightbox");
  $("lightbox").classList.remove("is-open");
  lightboxOpen = false;
  syncLock();
}

// ---------- Dateien: Excel, Backup ----------
function fileStem() {
  return (settings.name || "").trim().replace(/[^\p{L}\p{N}_-]/gu, "") || "Monatskasse";
}
/** Schreibt eine Datei und öffnet das Teilen-Menü (Handy) bzw. lädt sie herunter (Browser). */
async function saveFile(name, data, { base64 = false, mime }) {
  if (isNative && P.Filesystem && P.Share) {
    await P.Filesystem.writeFile({ path: name, data, directory: "CACHE", ...(base64 ? {} : { encoding: "utf8" }) });
    const { uri } = await P.Filesystem.getUri({ path: name, directory: "CACHE" });
    try { await P.Share.share({ title: name, url: uri, dialogTitle: name }); }
    catch (e) { if (/cancel/i.test(String(e?.message ?? e))) return false; throw e; }
    return true;
  }
  const blob = base64 ? await (await fetch(`data:${mime};base64,${data}`)).blob() : new Blob([data], { type: mime });
  const a = el("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

const EURO_FMT = '#,##0.00 "€"';
function excelDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); } // Mittag UTC: kein Tagesversatz durch Zeitzonen
function formatColumn(ws, col, z) {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = 1; r <= range.e.r; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: col })]; if (c) c.z = z; }
}
async function exportExcel() {
  if (!window.XLSX) return toast("Excel-Modul lädt noch …");
  if (!expenses.length) return toast("Noch nichts zu exportieren.");
  const sorted = [...expenses].sort((a, b) => byNewest(b, a));
  const rows = sorted.map((e) => ({
    Monat: monthLabel(expMonth(e)), Datum: excelDate(e.date), "Wofür": e.text, Kategorie: e.cat,
    "Betrag (€)": e.cents / 100, Beleg: e.receiptId ? "ja" : "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true, dateNF: "dd.mm.yyyy" });
  ws["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 7 }];
  formatColumn(ws, 1, "dd.mm.yyyy");
  formatColumn(ws, 4, EURO_FMT);

  const months = [...new Set(sorted.map(expMonth))];
  const summary = months.map((m) => {
    const spent = expenses.filter((e) => expMonth(e) === m).reduce((s, e) => s + e.cents, 0), budget = allowanceFor(m);
    return { Monat: monthLabel(m), "Budget (€)": budget / 100, "Ausgegeben (€)": spent / 100, "Übrig (€)": (budget - spent) / 100 };
  });
  const ws2 = XLSX.utils.json_to_sheet(summary);
  ws2["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 15 }, { wch: 12 }];
  for (const c of [1, 2, 3]) formatColumn(ws2, c, EURO_FMT);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ausgaben");
  XLSX.utils.book_append_sheet(wb, ws2, "Monate");
  try {
    const ok = await saveFile(`Monatskasse_${fileStem()}_${todayISO()}.xlsx`, XLSX.write(wb, { type: "base64", bookType: "xlsx" }),
      { base64: true, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (ok) toast("Excel erstellt");
  } catch (err) { console.error(err); toast("Export fehlgeschlagen."); }
}

async function exportBackup() {
  try {
    const receipts = {};
    for (const id of new Set(expenses.map((e) => e.receiptId).filter(Boolean))) { const d = await loadPhoto(id); if (d) receipts[id] = d; }
    const json = JSON.stringify({ app: "monatskasse", version: 1, exportedAt: new Date().toISOString(), settings, expenses, receipts });
    const ok = await saveFile(`Monatskasse_Backup_${fileStem()}_${todayISO()}.json`, json, { mime: "application/json" });
    if (ok) toast("Backup erstellt");
  } catch (err) { console.error(err); toast("Backup fehlgeschlagen."); }
}

async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("Das ist keine gültige Backup-Datei."); }
  if (data?.app !== "monatskasse" || !Array.isArray(data.expenses)) return toast("Das ist kein Monatskasse-Backup.");
  // Vertrauensgrenze: fremde Datei — alles prüfen, nur Bilder als data:-URL übernehmen
  const list = data.expenses.map(sanitizeExpense).filter(Boolean);
  const receipts = Object.entries(data.receipts && typeof data.receipts === "object" ? data.receipts : {})
    .filter(([k, v]) => typeof k === "string" && typeof v === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v));
  const when = typeof data.exportedAt === "string" ? new Date(data.exportedAt).toLocaleDateString("de-DE") : "unbekannt";
  if (!confirm(`Backup vom ${when} mit ${list.length} Ausgaben laden?\n\nDas ersetzt alle Ausgaben auf diesem Handy.`)) return;
  try {
    const keep = new Set(receipts.map(([k]) => k));
    for (const [k, v] of receipts) await idbPut(k, v); // erst schreiben, dann umschalten: bei Abbruch bleibt alles beim Alten
    expenses = list.map((e) => ({ ...e, receiptId: e.receiptId && keep.has(e.receiptId) ? e.receiptId : null }));
    if (data.settings) settings = sanitizeSettings(data.settings);
    saveSettings(); saveExpenses();
    thumbCache.clear();
    await sweepReceipts();
    viewMonth = currentMonth();
    render(); haptic("success");
    toast(`Backup geladen: ${list.length} Ausgaben`);
  } catch (err) { console.error(err); toast("Laden fehlgeschlagen – deine bisherigen Daten sind unverändert."); }
}

async function wipeAll() {
  if (!confirm("Wirklich alle Ausgaben und Belegfotos auf diesem Handy löschen?\n\nDas lässt sich nicht rückgängig machen.")) return;
  expenses = []; saveExpenses();
  await idbClear().catch(() => {});
  thumbCache.clear();
  render(); haptic("warning");
  toast("Alle Ausgaben gelöscht");
}

// ---------- Verdrahtung ----------
function wire() {
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => selectTab(t.dataset.view)));
  $("prev-month").onclick = () => goMonth(-1);
  $("next-month").onclick = () => goMonth(1);
  $("back-current").onclick = () => { const dir = viewMonth < currentMonth() ? 1 : -1; viewMonth = currentMonth(); renderOverview(dir); };
  $("fab").onclick = () => openExpense();
  addEventListener("scroll", updateScrolled, { passive: true });

  // Ausgabe-Sheet
  $("sheet-expense").querySelector("[data-cancel]").onclick = () => closeExpense(0);
  $("save-expense").onclick = saveExpense;
  $("exp-amount").addEventListener("input", (e) => {
    const cleaned = e.target.value.replace(/[^\d.,]/g, "");
    if (cleaned !== e.target.value) e.target.value = cleaned;
    $("amount-hint").textContent = "";
    sizeAmount(); validate();
  });
  $("exp-amount").addEventListener("keydown", (e) => { if (e.key === "Enter") $("exp-text").focus(); });
  for (const id of ["exp-text", "exp-cat"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  $("exp-cat").addEventListener("input", updateChips);
  $("exp-date").addEventListener("change", setDateLabel);
  $("exp-date").addEventListener("input", setDateLabel);
  $("exp-photo").onchange = async (ev) => {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    const d = await downscale(f);
    if (!d) return toast("Foto konnte nicht geladen werden.");
    photo = { data: d, changed: true };
    renderPhoto();
  };
  $("photo-remove").onclick = () => { photo = { data: null, changed: true }; renderPhoto(); };
  $("receipt-img").onclick = () => photo.data && openLightbox(null, photo.data);
  $("ocr-btn").onclick = runOcr;
  $("delete-expense").onclick = deleteEditing;

  // OCR-Sheet
  $("sheet-ocr").querySelector("[data-cancel]").onclick = () => closeOcr(0);
  $("ocr-add").onclick = addOcrItems;
  $("ocr-single").onclick = takeOcrAsOne;

  // Bildansicht
  $("lightbox").onclick = closeLightbox;

  // Verlauf + Einstellungen
  $("export-top").onclick = exportExcel;
  $("export-btn").onclick = exportExcel;
  $("backup-btn").onclick = exportBackup;
  $("restore-btn").onclick = () => $("restore-file").click();
  $("restore-file").onchange = (ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) restoreBackup(f); };
  $("wipe-btn").onclick = wipeAll;

  const allowanceInput = $("set-allowance");
  allowanceInput.addEventListener("focus", () => {
    allowanceInput.value = formatCents(settings.allowanceCents);
    allowanceInput.select();
  });
  allowanceInput.addEventListener("keydown", (e) => { if (e.key === "Enter") allowanceInput.blur(); });
  allowanceInput.addEventListener("blur", () => {
    const c = parseEuroToCents(allowanceInput.value);
    if (c == null || c >= 1e8) {
      allowanceInput.classList.add("invalid");
      haptic("warning");
      toast("Budget bitte als Zahl, z. B. 225,00");
      setTimeout(renderSettings, 900);
      return;
    }
    allowanceInput.classList.remove("invalid");
    if (c !== settings.allowanceCents) {
      setAllowance(c);
      haptic("success");
      toast(`Ab ${monthName(currentMonth())}: ${formatEuro(c)} pro Monat`);
    }
    allowanceInput.value = formatEuro(settings.allowanceCents);
  });
  const welcomeInput = $("welcome-budget");
  const startBudget = () => {
    const c = parseEuroToCents(welcomeInput.value);
    if (c == null || c <= 0 || c >= 1e8) { haptic("warning"); welcomeInput.focus(); return toast("Betrag bitte als Zahl, z. B. 50,00"); }
    welcomeInput.blur();
    settings.allowanceCents = c;
    saveSettings();
    haptic("success");
    render();
  };
  $("welcome-go").onclick = startBudget;
  welcomeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startBudget(); });

  const nameInput = $("set-name");
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });
  nameInput.addEventListener("blur", () => {
    const n = nameInput.value.trim().slice(0, 40);
    if (n !== settings.name) { settings.name = n; saveSettings(); toast("Name gespeichert"); }
  });

  // Zurück-Taste (Android) und Escape (Browser): oberste Ebene schließen
  P.App?.addListener?.("backButton", () => { if (!dismissTop()) (P.App.minimizeApp ?? P.App.exitApp)?.call(P.App); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") dismissTop(); });

  // Immer aktueller Monat
  P.App?.addListener?.("resume", snapToCurrent);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) snapToCurrent(); });
  let lastDay = todayISO();
  setInterval(() => { const t = todayISO(); if (t !== lastDay) { lastDay = t; snapToCurrent(); } }, 30_000);
  reduceMotion.addEventListener?.("change", () => render());
}

loadState();
wire();
show("overview");
sweepReceipts();

// Web app: works offline and installs to the home screen. The Android app updates itself instead (Updater.java).
if (!isNative && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
