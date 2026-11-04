#!/usr/bin/env python3
"""Builds the GitHub Pages site (brickystudios.github.io/monatskasse) into _site/.

One home page plus one page per search intent. The web app is www/, copied to _site/app/ by the
Pages workflow. Run: python3 tools/build_site.py  (then: cp -r www _site/app for a local preview)
"""
import html
import json
import re
import shutil
from pathlib import Path

BASE = "https://brickystudios.github.io/monatskasse/"
REPO = "https://github.com/BrickyStudios/monatskasse"
APK = REPO + "/releases/latest/download/Monatskasse.apk"  # same name in every release
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
IMG = BASE + "bilder/social-preview.png"
DJI = "https://www.dji.de/themen/jugend/taschengeld.html"
DJI_PDF = "https://www.dji.de/fileadmin/user_upload/dasdji/publikationen/Broschueren_2025/Expertise_Taschengeld_ChaburskyLangmeyer2025_aktualisiert.pdf"


def page(slug, title, desc, body, schema):
    """slug '' = home. Relative paths keep the site working under any sub-path."""
    assert len(title) <= 62 and len(desc) <= 160, (slug, len(title), len(desc))
    root = "../" * slug.count("/") if slug else ""
    url = BASE + slug
    out = f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:locale" content="de_DE">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:image" content="{IMG}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<link rel="icon" href="{root}app/icons/icon-192.png">
<link rel="apple-touch-icon" href="{root}app/icons/apple-touch-icon.png">
<link rel="stylesheet" href="{root}style.css">
<script type="application/ld+json">{json.dumps(schema, ensure_ascii=False)}</script>
</head>
<body>
<header class="top"><a class="brand" href="{root or './'}"><img src="{root}app/icons/icon-192.png" alt="" width="32" height="32">Monatskasse</a>
<nav><a href="{root}taschengeld-tabelle/">Taschengeld-Tabelle</a><a href="{root}app/">Web-App</a><a href="{REPO}">GitHub</a></nav></header>
<main>
{body}
</main>
<footer><p>Monatskasse ist freie Software unter GPL-3.0, ohne Werbung und ohne Tracking.</p>
<p><a href="{REPO}">Quellcode</a> · <a href="{REPO}/blob/main/LICENSE">GPL-3.0</a> · <a href="{root}sitemap.xml">Sitemap</a></p></footer>
</body>
</html>
"""
    target = OUT / slug / "index.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(out)
    return slug


def strip(s):
    return re.sub(r"<[^>]+>", "", s)


def app_schema(desc):
    return {
        "@context": "https://schema.org", "@type": "SoftwareApplication",
        "name": "Monatskasse", "operatingSystem": "Android 6.0+, Web", "applicationCategory": "FinanceApplication",
        "description": desc, "inLanguage": "de", "license": "https://www.gnu.org/licenses/gpl-3.0.html",
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "EUR"},
        "downloadUrl": APK, "image": IMG, "url": BASE,
    }


def howto_schema(name, steps):
    return {"@context": "https://schema.org", "@type": "HowTo", "name": name,
            "step": [{"@type": "HowToStep", "position": i + 1, "text": strip(s)} for i, s in enumerate(steps)]}


def faq(items):
    """Visible FAQ + matching FAQPage schema."""
    blocks = "".join(f"<details><summary>{html.escape(q)}</summary><p>{a}</p></details>" for q, a in items)
    schema = {"@context": "https://schema.org", "@type": "FAQPage",
              "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": strip(a)}} for q, a in items]}
    return f'<section class="faq"><h2>Häufige Fragen</h2>{blocks}</section>', schema


def steps_html(steps):
    return '<ol class="steps">' + "".join(f"<li><span>{s}</span></li>" for s in steps) + "</ol>"


def cta(root):
    return (f'<p class="cta"><a class="btn" href="{APK}">APK für Android laden</a>'
            f'<a class="btn ghost" href="{root}app/">Im Browser öffnen</a></p>'
            '<p class="small">Android 6.0 oder neuer, kein Konto. Die Android-App holt sich Updates selbst von GitHub. '
            'Die Web-App läuft auf iPhone, Android und am Rechner und lässt sich zum Home-Bildschirm hinzufügen.</p>')


def gallery(root, names=("1-monat", "4-kassenbon", "2-verlauf")):
    alts = {"1-monat": "Monatsübersicht: 33,27 € übrig von 120 €, Ausgaben nach Kategorie",
            "2-verlauf": "Verlauf: Rest oder Überziehung pro Monat",
            "3-ausgabe": "Neue Ausgabe mit Betrag, Kategorie und Foto vom Kassenbon",
            "4-kassenbon": "Vom Kassenbon erkannte Posten mit Preisen zum Abhaken",
            "5-monat-dunkel": "Monatsübersicht im dunklen Modus"}
    imgs = "".join(f'<img src="{root}bilder/{n}.webp" alt="{alts[n]}" width="780" height="1688" loading="lazy">' for n in names)
    return f'<div class="gallery">{imgs}</div>'


def links(root, skip=""):
    cards = [("taschengeld-tabelle/", "Taschengeld-Tabelle 2026", "Wie viel nach Alter, mit Rechner"),
             ("haushaltsbuch-app/", "Haushaltsbuch-App ohne Konto", "Für ein festes Budget pro Monat"),
             ("kassenbon-scannen/", "Kassenbon scannen", "Posten und Preise vom Foto"),
             ("haushaltsbuch-excel/", "Haushaltsbuch mit Excel-Export", "Am Handy eintragen, in Excel auswerten")]
    return '<div class="links">' + "".join(
        f'<a class="card" href="{root}{s}"><b>{t}</b><span>{d}</span></a>' for s, t, d in cards if s != skip) + "</div>"


if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir()
for f in ("style.css",):
    shutil.copy(ROOT / "site" / f, OUT / f)
shutil.copytree(ROOT / "site" / "bilder", OUT / "bilder")
for f in (ROOT / "site").glob("google*.html"):  # Search Console verification, never delete
    shutil.copy(f, OUT / f.name)

slugs = []

# ------------------------------------------------------------------ home

HOME_DESC = "Taschengeld und Monatsbudget im Blick: Ausgaben eintragen, Kassenbons scannen, Excel-Export. Kostenlos, ohne Konto und ohne Werbung."
home_faq, home_faq_schema = faq([
    ("Was kostet Monatskasse?", "Nichts. Die App ist Open Source unter GPL-3.0, ohne Werbung, ohne Abo und ohne In-App-Käufe."),
    ("Brauche ich ein Konto oder eine Bankverbindung?", "Nein. Du trägst deine Ausgaben selbst ein oder fotografierst den Bon. Die App kennt dein Bankkonto nicht."),
    ("Wo liegen meine Daten?", "Auf deinem Handy, im Speicher der App. Es gibt keinen Server. Mit „Backup sichern“ bekommst du eine Datei mit allen Ausgaben und Belegfotos, die du auf ein neues Handy mitnehmen kannst."),
    ("Gibt es Monatskasse für das iPhone?", 'Ja, als <a href="app/">Web-App</a> im Browser. In Safari auf Teilen und „Zum Home-Bildschirm“ tippen, dann startet sie wie eine App und geht auch offline.'),
    ("Wie bekomme ich Updates?", "Die Android-App fragt beim Start bei GitHub, ob es eine neue Version gibt, und installiert sie mit einem Tipp. Deine Ausgaben bleiben dabei erhalten. Die Web-App ist immer auf dem neuesten Stand."),
    ("Wie viel Taschengeld ist normal?", 'Das Deutsche Jugendinstitut empfiehlt zum Beispiel 20 bis 30 € im Monat mit 12 und 40 bis 60 € mit 16. Alle Altersstufen stehen in der <a href="taschengeld-tabelle/">Taschengeld-Tabelle</a>.'),
])
HOME_STEPS = [
    "Beim ersten Start trägst du ein, wie viel Geld du im Monat hast.",
    "Gibst du etwas aus, tippst du auf <b>+</b>: Betrag, wofür, fertig. Kategorie und Foto sind freiwillig.",
    "Oben steht, wie viel noch übrig ist und wie viel pro Tag noch drin ist. Am Monatsersten fängt alles wieder beim vollen Budget an.",
]
slugs.append(page("", "Monatskasse: kostenlose Taschengeld-App ohne Konto", HOME_DESC, f"""
<p class="kicker">Taschengeld-App für Android und Browser</p>
<h1>Wie viel ist diesen Monat noch übrig?</h1>
<p class="lead">Monatskasse fängt jeden Monat bei deinem Budget an und zieht jede Ausgabe ab. Kassenbons fotografierst du, die App liest die Posten heraus. Kein Konto, keine Bankverbindung, keine Werbung.</p>
{cta("")}
{gallery("")}
<h2>So funktioniert es</h2>
{steps_html(HOME_STEPS)}
<div class="grid">
<div class="card"><h3>Kassenbon scannen</h3><p>Foto machen, „Posten erkennen“ tippen. Du hakst ab, was stimmt, und übernimmst die Posten einzeln oder als eine Ausgabe.</p></div>
<div class="card"><h3>Wofür geht das Geld weg?</h3><p>Ein Balken zeigt die Kategorien des Monats. Der Verlauf zeigt jeden Monat mit Rest oder Überziehung.</p></div>
<div class="card"><h3>Excel-Export</h3><p>Alle Ausgaben mit Datum, Kategorie und Betrag, dazu eine Tabelle pro Monat mit Budget, Ausgaben und Rest.</p></div>
<div class="card"><h3>Bleibt auf dem Gerät</h3><p>Ausgaben und Fotos liegen nur im Speicher der App. Die Texterkennung läuft auf dem Handy. Kein Tracking, keine Analyse.</p></div>
<div class="card"><h3>Budget ändern</h3><p>Ein neues Budget gilt ab dem aktuellen Monat. Frühere Monate rechnen weiter mit ihrem alten Betrag.</p></div>
<div class="card"><h3>Backup in einer Datei</h3><p>Alle Ausgaben und Belegfotos in einer Datei. Auf einem neuen Handy lädst du sie wieder.</p></div>
</div>
<h2>Ratgeber</h2>
{links("")}
{home_faq}
""", [app_schema(HOME_DESC), howto_schema("Taschengeld mit Monatskasse im Blick behalten", HOME_STEPS), home_faq_schema]))

# ------------------------------------------------------------------ Taschengeld-Tabelle

# DJI 2025: (label, min, max, unit, from_age, to_age). Source: Chabursky/Langmeyer (2025), p. 9 and 4.2.
TG = [("unter 6 Jahre", 1, 2, "Woche", 0, 5), ("6–7 Jahre", 2, 3, "Woche", 6, 7), ("8–9 Jahre", 3, 4, "Woche", 8, 9),
      ("10–11 Jahre", 15, 25, "Monat", 10, 11), ("12–13 Jahre", 20, 30, "Monat", 12, 13), ("14–15 Jahre", 25, 45, "Monat", 14, 15),
      ("16–17 Jahre", 40, 60, "Monat", 16, 17), ("ab 18 Jahre", 55, 75, "Monat", 18, 99)]
BUDGET = [("Kleidung und Schuhe", 45, 65), ("Essen außer Haus", 25, 40), ("Handy, Internet und Abos", 15, 25),
          ("Schulmaterial", 5, 15), ("Kosmetik und Pflege", 5, 15)]


def eur(x):
    return f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " €"


tg_rows = "".join(f'<tr><td>{a}</td><td class="num">{eur(lo)} – {eur(hi)}</td><td>pro {u}</td></tr>' for a, lo, hi, u, *_ in TG)
bg_rows = "".join(f'<tr><td>{a}</td><td class="num">{eur(lo)} – {eur(hi)}</td></tr>' for a, lo, hi in BUDGET)
bg_lo, bg_hi = sum(b[1] for b in BUDGET), sum(b[2] for b in BUDGET)
calc_data = json.dumps([[f, t, lo, hi, u] for _, lo, hi, u, f, t in TG])
tg_faq, tg_faq_schema = faq([
    ("Wie viel Taschengeld bekommt ein 12-Jähriger?", "Das DJI empfiehlt mit 12 und 13 Jahren 20 bis 30 € im Monat."),
    ("Wie viel Taschengeld mit 14?", "Mit 14 und 15 Jahren empfiehlt das DJI 25 bis 45 € im Monat."),
    ("Wie viel Taschengeld mit 16?", "Mit 16 und 17 Jahren sind es 40 bis 60 € im Monat, für Jugendliche, die noch ganz von den Eltern leben, etwa Schülerinnen und Schüler."),
    ("Ab wann Taschengeld monatlich statt wöchentlich?", "Ab etwa 10 Jahren. Jüngere Kinder können einen ganzen Monat noch schwer überblicken, deshalb gibt es bis 9 Jahre einen Wochenbetrag."),
    ("Gibt es einen gesetzlichen Anspruch auf Taschengeld?", "Ein Gesetz, das eine Höhe festlegt, gibt es nicht. Die Tabelle ist eine Empfehlung, und jede Familie passt sie an das an, was sie sich leisten kann."),
    ("Was ist Budgetgeld?", "Geld mit festem Zweck, zusätzlich zum Taschengeld, etwa für Kleidung oder das Handy. Das DJI empfiehlt es ab etwa 12 Jahren, damit Jugendliche lernen, ein Budget einzuteilen."),
])
slugs.append(page("taschengeld-tabelle/", "Taschengeld-Tabelle 2026: Wie viel Taschengeld nach Alter?",
     "Taschengeld-Tabelle nach Alter mit der aktuellen DJI-Empfehlung, Budgetgeld ab 12 Jahren und Rechner. Wochen- und Monatsbeträge auf einen Blick.", f"""
<article>
<p class="kicker">Taschengeld-Tabelle</p>
<h1>Taschengeld-Tabelle 2026</h1>
<p class="lead">Wie viel Taschengeld passt zu welchem Alter? Das Deutsche Jugendinstitut (DJI) hat seine Empfehlung im September 2025 neu berechnet. Bis 9 Jahre gilt sie pro Woche, ab 10 Jahren pro Monat.</p>
<div class="card calc">
<label for="age">Alter des Kindes</label>
<input id="age" type="number" inputmode="numeric" min="3" max="25" value="12">
<output id="result" for="age" aria-live="polite"></output>
</div>
<script>
const TG = {calc_data};
const fmt = (x) => x.toLocaleString("de-DE", {{ style: "currency", currency: "EUR" }});
function show() {{
  const a = Number(document.getElementById("age").value);
  const r = TG.find(([f, t]) => a >= f && a <= t);
  const out = document.getElementById("result");
  if (!r || !a) {{ out.textContent = "Bitte ein Alter eintragen."; return; }}
  const [, , lo, hi, u] = r;
  out.innerHTML = fmt(lo) + " bis " + fmt(hi) + " pro " + u + (u === "Woche"
    ? "<small>Das sind etwa " + fmt(lo * 52 / 12) + " bis " + fmt(hi * 52 / 12) + " im Monat.</small>"
    : "<small>Empfehlung des DJI, Stand September 2025.</small>");
}}
document.getElementById("age").addEventListener("input", show);
show();
</script>
<h2>Taschengeld nach Alter</h2>
<table><thead><tr><th>Alter</th><th>Betrag</th><th>Rhythmus</th></tr></thead><tbody>{tg_rows}</tbody></table>
<p class="small">Ab 16 Jahren gelten die Beträge für Jugendliche, die wirtschaftlich noch ganz von den Eltern abhängen, zum Beispiel Schülerinnen und Schüler.</p>
<h2>Budgetgeld ab 12 Jahren</h2>
<p>Zusätzlich zum Taschengeld empfiehlt das DJI ab etwa 12 Jahren Budgetgeld. Das ist Geld mit festem Zweck: Kleidung, Essen unterwegs, das Handy. Jugendliche lernen damit, ein Budget über einen Monat einzuteilen.</p>
<table><thead><tr><th>Bereich</th><th>Pro Monat</th></tr></thead><tbody>{bg_rows}
<tr><td><b>Alle Bereiche zusammen</b></td><td class="num"><b>{eur(bg_lo)} – {eur(bg_hi)}</b></td></tr></tbody></table>
<p>Wer Taschengeld und Budgetgeld bekommt, hat mit 16 schnell 150 € oder mehr im Monat zu verwalten. Familien vereinbaren meist nur einige dieser Bereiche, nicht alle auf einmal.</p>
<h2>Die Grundregeln</h2>
<ul>
<li><b>Regelmäßig und pünktlich:</b> immer am selben Tag, ohne dass das Kind fragen muss.</li>
<li><b>Unabhängig vom Verhalten:</b> kein Abzug für schlechte Noten oder Streit. Sonst lernt das Kind Druck statt Umgang mit Geld.</li>
<li><b>Frei verfügbar:</b> Eltern reden mit, bewerten aber nicht, wofür das Geld ausgegeben wird.</li>
<li><b>Offen über Geld reden:</b> was die Familie sich leisten kann und warum der Betrag so hoch ist, wie er ist.</li>
</ul>
<p>Rechtlich sind Kinder ab 7 Jahren beschränkt geschäftsfähig. Kaufen sie etwas und bezahlen es sofort mit Geld, das ihnen dafür oder zur freien Verfügung überlassen wurde, ist der Kauf wirksam (§ 110 BGB, „Taschengeldparagraph“).</p>
<h2>Den Überblick behalten</h2>
<p>Mit dem Monatsbetrag wird es schwieriger. Am 20. ist das Geld weg, und keiner weiß, wofür. Monatskasse zeigt, wie viel noch übrig ist und wie viel pro Tag noch drin ist. Kassenbons fotografiert man, die App liest die Posten heraus. Ohne Konto und ohne Bankverbindung, also auch für Kinder ohne eigenes Konto.</p>
{gallery("../", ("1-monat", "2-verlauf"))}
{cta("../")}
{tg_faq}
<p class="small">Quelle: Chabursky, Sophia / Langmeyer, Alexandra (2025): <a href="{DJI_PDF}">Taschengeld und Gelderziehung</a>. Expertise, Deutsches Jugendinstitut, aktualisiert September 2025. Übersicht auf <a href="{DJI}">dji.de</a>.</p>
</article>
""", [tg_faq_schema, {"@context": "https://schema.org", "@type": "Article", "headline": "Taschengeld-Tabelle 2026", "inLanguage": "de",
                      "dateModified": "2026-11-04", "citation": DJI_PDF, "url": BASE + "taschengeld-tabelle/"}]))

# ------------------------------------------------------------------ Haushaltsbuch-App

HB_DESC = "Kostenlose Haushaltsbuch-App für ein festes Monatsbudget: Ausgaben in Sekunden eintragen, Bons scannen, Excel-Export. Ohne Konto und ohne Bank."
hb_faq, hb_faq_schema = faq([
    ("Kann Monatskasse mein Bankkonto auslesen?", "Nein, absichtlich nicht. Du trägst Ausgaben selbst ein oder fotografierst den Bon. Dafür muss die App keine Bankdaten kennen."),
    ("Kann ich Einnahmen eintragen?", "Nein. Monatskasse rechnet mit einem festen Betrag pro Monat, von dem die Ausgaben abgehen. Für ein Haushaltsbuch mit Gehalt, Miete und mehreren Konten ist eine andere App besser."),
    ("Kann ich mit mehreren Personen ein Budget teilen?", "Nein. Jedes Handy hat sein eigenes Budget, es gibt keinen Abgleich zwischen Geräten."),
    ("Ist Monatskasse wirklich kostenlos?", "Ja. Keine Werbung, kein Abo, keine Premium-Version. Der Quellcode liegt offen auf GitHub."),
])
slugs.append(page("haushaltsbuch-app/", "Haushaltsbuch-App kostenlos: ohne Konto und ohne Bank", HB_DESC, f"""
<article>
<p class="kicker">Haushaltsbuch-App</p>
<h1>Haushaltsbuch-App ohne Konto und ohne Bankverbindung</h1>
<p class="lead">Monatskasse ist ein Haushaltsbuch für ein festes Budget pro Monat: Taschengeld, Budgetgeld, Haushaltsgeld oder der Betrag, den du dir für Freizeit vornimmst. Eine Ausgabe einzutragen dauert drei Sekunden.</p>
{gallery("../", ("1-monat", "3-ausgabe", "2-verlauf"))}
<h2>Was sie kann</h2>
<ul>
<li>Rest des Monats und Betrag pro Tag auf einen Blick</li>
<li>Kategorien mit Balken, Verlauf aller Monate mit Rest oder Überziehung</li>
<li>Kassenbon fotografieren und Posten erkennen lassen, offline auf dem Handy</li>
<li>Excel-Export und Backup in einer Datei</li>
<li>Hell und dunkel, je nach Einstellung des Handys</li>
</ul>
<h2>Was sie nicht kann</h2>
<ul>
<li>Kein Bankabgleich, keine Konten, keine Einnahmen-Liste</li>
<li>Kein Sync zwischen Handys, keine gemeinsamen Budgets</li>
</ul>
<p>Wer Gehalt, Miete und Daueraufträge planen will, braucht ein volles Haushaltsbuch. Wer wissen will, ob das Geld bis zum Monatsende reicht, ist mit Monatskasse schneller fertig.</p>
{cta("../")}
{hb_faq}
<h2>Mehr dazu</h2>
{links("../", "haushaltsbuch-app/")}
</article>
""", [app_schema(HB_DESC), hb_faq_schema]))

# ------------------------------------------------------------------ Excel

XL_STEPS = [
    "Ausgaben im Laufe des Monats in Monatskasse eintragen, am Handy oder im Browser.",
    "In <b>Einstellungen</b> oder oben im <b>Verlauf</b> auf <b>Excel</b> tippen.",
    "Die Datei teilen, per Mail schicken oder speichern. Sie öffnet sich in Excel, LibreOffice, Numbers und Google Tabellen.",
]
xl_faq, xl_faq_schema = faq([
    ("Was steht in der Excel-Datei?", "Zwei Tabellen. „Ausgaben“: Monat, Datum, wofür, Kategorie, Betrag und ob ein Belegfoto dabei ist. „Monate“: Budget, Ausgaben und Rest pro Monat."),
    ("Kann ich die Datei wieder in die App laden?", "Nein, die Excel-Datei ist zum Auswerten. Zum Umziehen auf ein neues Handy gibt es das Backup, das auch die Belegfotos enthält."),
    ("Brauche ich Excel?", "Nein. LibreOffice, Numbers und Google Tabellen öffnen die Datei genauso."),
])
slugs.append(page("haushaltsbuch-excel/", "Haushaltsbuch mit Excel-Export: am Handy eintragen",
     "Ausgaben am Handy eintragen und als Excel-Datei exportieren: jede Ausgabe mit Datum, Kategorie und Betrag, dazu eine Monatsübersicht. Kostenlos.", f"""
<article>
<p class="kicker">Excel-Export</p>
<h1>Haushaltsbuch am Handy, Auswertung in Excel</h1>
<p class="lead">Eine Excel-Vorlage füllt man abends am Rechner aus, wenn man sich an die Hälfte der Ausgaben nicht mehr erinnert. Mit Monatskasse trägst du die Ausgabe an der Kasse ein und exportierst am Monatsende eine fertige Tabelle.</p>
{steps_html(XL_STEPS)}
<h2>Die zwei Tabellen</h2>
<table><thead><tr><th>Tabelle</th><th>Spalten</th></tr></thead><tbody>
<tr><td>Ausgaben</td><td>Monat, Datum, Wofür, Kategorie, Betrag (€), Beleg</td></tr>
<tr><td>Monate</td><td>Monat, Budget (€), Ausgegeben (€), Übrig (€)</td></tr>
</tbody></table>
<p>Datum und Beträge sind als echte Zahlen formatiert. Summen, Pivot-Tabellen und Diagramme gehen also sofort.</p>
{cta("../")}
{xl_faq}
<h2>Mehr dazu</h2>
{links("../", "haushaltsbuch-excel/")}
</article>
""", [howto_schema("Haushaltsbuch als Excel-Datei exportieren", XL_STEPS), xl_faq_schema]))

# ------------------------------------------------------------------ Kassenbon

KB_STEPS = [
    "Auf <b>+</b> tippen, dann <b>Beleg fotografieren</b>.",
    "<b>Posten erkennen</b> tippen. Die Android-App bringt die Texterkennung mit, die Web-App lädt sie beim ersten Mal und geht danach offline.",
    "Die erkannten Posten prüfen, falsche abhaken oder korrigieren.",
    "Als einzelne Ausgaben übernehmen oder alles zusammen als eine Ausgabe.",
]
kb_faq, kb_faq_schema = faq([
    ("Wird das Foto hochgeladen?", "Nein. Die Texterkennung (Tesseract) läuft auf dem Handy. Das Foto bleibt im Speicher der App und landet nur im Backup, wenn du eins machst."),
    ("Welche Bons klappen?", "Gedruckte Bons von Supermarkt, Drogerie, Bäcker oder Imbiss. Handschrift und stark verblasstes Thermopapier erkennt die App schlecht."),
    ("Was, wenn ein Posten fehlt?", "Dann trägst du ihn von Hand nach. Vor dem Übernehmen siehst du jeden Posten mit Preis und die Summe der ausgewählten."),
])
slugs.append(page("kassenbon-scannen/", "Kassenbon scannen: Posten automatisch als Ausgaben",
     "Kassenbon fotografieren, Monatskasse liest Posten und Preise heraus. Die Texterkennung läuft auf dem Handy, das Foto wird nirgends hochgeladen.", f"""
<article>
<p class="kicker">Kassenbon scannen</p>
<h1>Kassenbon fotografieren, Posten übernehmen</h1>
<p class="lead">Monatskasse liest Posten und Preise vom Foto eines Kassenbons. Du prüfst kurz und übernimmst sie als einzelne Ausgaben oder als eine. Die Erkennung läuft auf dem Handy, ohne Upload.</p>
{steps_html(KB_STEPS)}
{gallery("../", ("3-ausgabe", "4-kassenbon"))}
<h2>Tipps für ein gutes Foto</h2>
<ul>
<li>Bon flach hinlegen, ganzen Bon ins Bild</li>
<li>Helles Licht, kein Schatten vom Handy</li>
<li>Gerade von oben fotografieren</li>
</ul>
<p>Zeilen wie Summe, Kartenzahlung oder Mehrwertsteuer sortiert die App aus. Übrig bleiben die Posten mit Preis.</p>
{cta("../")}
{kb_faq}
<h2>Mehr dazu</h2>
{links("../", "kassenbon-scannen/")}
</article>
""", [howto_schema("Kassenbon mit Monatskasse scannen", KB_STEPS), kb_faq_schema]))

# ------------------------------------------------------------------ crawl files

slugs.append("app/")
(OUT / "sitemap.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "".join(f"  <url><loc>{BASE + s}</loc></url>\n" for s in slugs) + "</urlset>\n")
# no robots.txt: crawlers only read it at the domain root; submit the sitemap in Search Console instead
(OUT / ".nojekyll").write_text("")
print("built", len(slugs), "pages")
